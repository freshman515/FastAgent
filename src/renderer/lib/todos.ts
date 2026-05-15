import { BUILT_IN_WORKER_TEMPLATES } from '@shared/workerTemplates'
import type { AgentSessionType, Session, SessionType, TaskGraphNode } from '@shared/types'
import { createSessionWithPrompt } from '@/lib/createSession'
import { focusSessionTarget } from '@/lib/focusSessionTarget'
import { getDefaultWorktreeIdForProject } from '@/lib/project-context'
import { generateId } from '@/lib/utils'
import { focusTerminalInputSoon } from '@/hooks/useXterm'
import { usePanesStore } from '@/stores/panes'
import { useSessionsStore } from '@/stores/sessions'
import { useTasksStore } from '@/stores/tasks'
import { type TodoItem, useUIStore } from '@/stores/ui'

const TODO_AGENT_TYPES = new Set<AgentSessionType>([
  'claude-code',
  'claude-code-yolo',
  'claude-code-wsl',
  'claude-code-yolo-wsl',
  'codex',
  'codex-yolo',
  'codex-wsl',
  'codex-yolo-wsl',
  'gemini',
  'gemini-yolo',
  'opencode',
])

export function createTodoItem(text: string, linkedSessionId?: string): TodoItem {
  const now = Date.now()
  const linkedSessionIds = linkedSessionId ? [linkedSessionId] : undefined

  return {
    id: `todo-${generateId()}`,
    text,
    completed: false,
    status: 'todo',
    createdAt: now,
    updatedAt: now,
    priority: 'medium',
    linkedSessionIds,
  }
}

export function getTodoItemsForProject(projectId: string): TodoItem[] {
  const settings = useUIStore.getState().settings
  const hasProjectTodoLists = Object.keys(settings.todoItemsByProject).length > 0
  return settings.todoItemsByProject[projectId] ?? (hasProjectTodoLists ? [] : settings.todoItems)
}

export function saveTodoItemsForProject(projectId: string, items: TodoItem[]): void {
  const ui = useUIStore.getState()
  ui.updateSettings({
    todoItemsByProject: {
      ...ui.settings.todoItemsByProject,
      [projectId]: items,
    },
  })
}

export function addTodoForProject(projectId: string, text: string, linkedSessionId?: string): TodoItem | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const todo = createTodoItem(trimmed, linkedSessionId)
  saveTodoItemsForProject(projectId, [todo, ...getTodoItemsForProject(projectId)])
  return todo
}

export function buildTodoPrompt(todo: TodoItem): string {
  const existing = todo.promptDraft?.trim()
  if (existing) return existing

  return [
    `任务：${todo.text}`,
    '',
    '请完成这个 Todo 对应的工作。',
    '',
    '完成后请简短说明：改了什么、如何验证、是否还有阻塞。',
  ].join('\n')
}

export function getDefaultTodoAgentType(defaultSessionType: SessionType): AgentSessionType {
  return TODO_AGENT_TYPES.has(defaultSessionType as AgentSessionType)
    ? defaultSessionType as AgentSessionType
    : 'claude-code'
}

export function updateTodoForProject(
  projectId: string,
  todoId: string,
  updater: (todo: TodoItem) => TodoItem,
): TodoItem | null {
  let updated: TodoItem | null = null
  const nextItems = getTodoItemsForProject(projectId).map((item) => {
    if (item.id !== todoId) return item
    updated = updater(item)
    return updated
  })
  saveTodoItemsForProject(projectId, nextItems)
  return updated
}

export function linkSessionToTodo(projectId: string, todoId: string, sessionId: string): TodoItem | null {
  return updateTodoForProject(projectId, todoId, (todo) => ({
    ...todo,
    linkedSessionIds: Array.from(new Set([...(todo.linkedSessionIds ?? []), sessionId])),
    updatedAt: Date.now(),
  }))
}

export function getTodosLinkedToSession(projectId: string, sessionId: string): TodoItem[] {
  return getTodoItemsForProject(projectId).filter((todo) => (todo.linkedSessionIds ?? []).includes(sessionId))
}

export function completeTodosForSession(projectId: string, sessionId: string): TodoItem[] {
  const now = Date.now()
  const completed: TodoItem[] = []
  const nextItems = getTodoItemsForProject(projectId).map((todo) => {
    if (!(todo.linkedSessionIds ?? []).includes(sessionId) || todo.completed) return todo
    const nextTodo = {
      ...todo,
      completed: true,
      status: 'done' as const,
      updatedAt: now,
      runs: todo.runs?.map((run) => run.sessionId === sessionId && !run.completedAt
        ? { ...run, completedAt: now }
        : run),
    }
    completed.push(nextTodo)
    return nextTodo
  })
  saveTodoItemsForProject(projectId, nextItems)
  return completed
}

function waitForPty(sessionId: string, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const tick = (): void => {
      const session = useSessionsStore.getState().sessions.find((item) => item.id === sessionId)
      if (session?.ptyId) {
        resolve(session.ptyId)
        return
      }

      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('会话 PTY 启动超时'))
        return
      }

      window.setTimeout(tick, 400)
    }
    tick()
  })
}

function activateSession(sessionId: string): void {
  const paneStore = usePanesStore.getState()
  const targetPaneId = paneStore.findPaneForSession(sessionId) ?? paneStore.activePaneId
  paneStore.addSessionToPane(targetPaneId, sessionId)
  paneStore.setActivePaneId(targetPaneId)
  paneStore.setPaneActiveSession(targetPaneId, sessionId)
  useSessionsStore.getState().setActive(sessionId)
  focusSessionTarget(sessionId)
}

function createSession(options: {
  projectId: string
  type: AgentSessionType
  worktreeId?: string
  name?: string
}): Promise<string> {
  return new Promise((resolve) => {
    createSessionWithPrompt({
      projectId: options.projectId,
      type: options.type,
      worktreeId: options.worktreeId,
      forceName: options.name,
      skipPrompt: options.name === undefined,
    }, (sessionId) => {
      activateSession(sessionId)
      resolve(sessionId)
    })
  })
}

function getCurrentSession(sessionId: string): Session {
  const session = useSessionsStore.getState().sessions.find((item) => item.id === sessionId)
  if (!session) throw new Error('关联会话不存在')
  return session
}

function buildTodoSessionName(title: string): string {
  return title.trim() || '未命名任务'
}

export async function startTodoInSession(options: {
  projectId: string
  todoId: string
  sessionId: string
  prompt: string
}): Promise<Session> {
  const prompt = options.prompt.trim()
  if (!prompt) throw new Error('提示词不能为空')

  const session = getCurrentSession(options.sessionId)
  if (session.projectId !== options.projectId) throw new Error('只能关联同项目的会话')

  activateSession(session.id)
  const ptyId = session.ptyId ?? await waitForPty(session.id)
  await window.api.session.submit(ptyId, prompt, false)
  focusTerminalInputSoon(session.id)

  updateTodoForProject(options.projectId, options.todoId, (todo) => ({
    ...todo,
    completed: false,
    status: 'active',
    promptDraft: prompt,
    linkedSessionIds: Array.from(new Set([...(todo.linkedSessionIds ?? []), session.id])),
    updatedAt: Date.now(),
    runs: [
      ...(todo.runs ?? []),
      {
        id: `run-${generateId()}`,
        mode: 'session',
        sessionId: session.id,
        promptSnapshot: prompt,
        startedAt: Date.now(),
      },
    ],
  }))

  return session
}

export async function startTodoInNewSession(options: {
  projectId: string
  todoId: string
  title: string
  prompt: string
  type: AgentSessionType
  worktreeId?: string
}): Promise<Session> {
  const prompt = options.prompt.trim()
  if (!prompt) throw new Error('提示词不能为空')

  const sessionId = await createSession({
    projectId: options.projectId,
    type: options.type,
    worktreeId: options.worktreeId ?? getDefaultWorktreeIdForProject(options.projectId),
    name: buildTodoSessionName(options.title),
  })
  useSessionsStore.getState().updateSession(sessionId, {
    label: 'Todo',
    color: '#a78bfa',
  })
  const ptyId = await waitForPty(sessionId)
  await window.api.session.submit(ptyId, prompt, false)
  focusTerminalInputSoon(sessionId)

  updateTodoForProject(options.projectId, options.todoId, (todo) => ({
    ...todo,
    completed: false,
    status: 'active',
    promptDraft: prompt,
    todoLaunchSessionType: options.type,
    linkedSessionIds: Array.from(new Set([...(todo.linkedSessionIds ?? []), sessionId])),
    updatedAt: Date.now(),
    runs: [
      ...(todo.runs ?? []),
      {
        id: `run-${generateId()}`,
        mode: 'session',
        sessionId,
        promptSnapshot: prompt,
        startedAt: Date.now(),
      },
    ],
  }))

  return getCurrentSession(sessionId)
}

function applyWorkerTemplate(templateId: string, task: string): TaskGraphNode | null {
  const template = BUILT_IN_WORKER_TEMPLATES.find((item) => item.id === templateId)
  if (!template) return null

  return {
    id: `node-${generateId()}`,
    templateId: template.id,
    name: template.defaultName,
    type: template.type,
    prompt: template.prompt
      .replaceAll('{{task}}', task)
      .replaceAll('{{ownership}}', template.ownershipHint ?? '按任务需要判断范围。'),
    dependsOn: [],
    ownership: template.ownershipHint ? [template.ownershipHint] : [],
    isolatedWorktree: template.isolatedWorktree,
    status: 'pending',
  }
}

export function startTodoWorkflow(options: {
  projectId: string
  todoId: string
  prompt: string
}): string {
  const prompt = options.prompt.trim()
  if (!prompt) throw new Error('提示词不能为空')

  const planner = applyWorkerTemplate('task-planner', prompt)
  const implementer = applyWorkerTemplate('code-worker', prompt)
  const reviewer = applyWorkerTemplate('review-worker', prompt)
  const graphNodes = [planner, implementer, reviewer].filter((node): node is TaskGraphNode => Boolean(node))

  if (planner && implementer) implementer.dependsOn = [planner.id]
  if (implementer && reviewer) reviewer.dependsOn = [implementer.id]
  if (graphNodes.length === 0) throw new Error('没有可用的工作流模板')

  const task = useTasksStore.getState().startGraphTask(options.projectId, prompt, graphNodes)
  updateTodoForProject(options.projectId, options.todoId, (todo) => ({
    ...todo,
    completed: false,
    status: 'active',
    promptDraft: prompt,
    linkedWorkflowTaskId: task.id,
    updatedAt: Date.now(),
    runs: [
      ...(todo.runs ?? []),
      {
        id: `run-${generateId()}`,
        mode: 'workflow',
        workflowTaskId: task.id,
        promptSnapshot: prompt,
        startedAt: Date.now(),
      },
    ],
  }))
  useUIStore.getState().activateDockPanel('tasks')
  return task.id
}
