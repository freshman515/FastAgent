import { GitBranch, Network, Play, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { BUILT_IN_WORKER_TEMPLATES } from '@shared/workerTemplates'
import type { TaskGraphNode, WorkerTemplate } from '@shared/types'
import { createAgentWorktree } from '@/lib/agent-worktrees'
import { parseStructuredWorkerReport } from '@/lib/worker-report'
import { cn, generateId } from '@/lib/utils'
import { usePanesStore } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useTasksStore } from '@/stores/tasks'
import { useWorktreesStore } from '@/stores/worktrees'

const INPUT = 'w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-2 text-[var(--ui-font-xs)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none'
const BUTTON = 'inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-1.5 text-[10px] font-medium text-[var(--color-text-secondary)] hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40'

interface DraftNode {
  template: WorkerTemplate
  enabled: boolean
  ownership: string
  isolatedWorktree: boolean
}

function applyTemplate(template: WorkerTemplate, task: string, ownership: string): string {
  return template.prompt
    .replaceAll('{{task}}', task.trim() || '按当前任务目标执行。')
    .replaceAll('{{ownership}}', ownership.trim() || template.ownershipHint || '按任务需要自行判断，避免无关改动。')
}

function waitForPty(sessionId: string, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const tick = () => {
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

function getRunnableNodes(nodes: TaskGraphNode[]): TaskGraphNode[] {
  const completed = new Set(nodes.filter((node) => node.status === 'completed').map((node) => node.id))
  return nodes.filter((node) =>
    node.status === 'pending'
    && node.dependsOn.every((dependency) => completed.has(dependency)),
  )
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleTimeString()
}

function StatusBadge({ status }: { status: TaskGraphNode['status'] }): JSX.Element {
  const className = status === 'completed'
    ? 'bg-[var(--color-success)]/15 text-[var(--color-success)]'
    : status === 'running'
      ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
      : status === 'blocked' || status === 'failed'
        ? 'bg-[var(--color-error)]/15 text-[var(--color-error)]'
        : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)]'
  return <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', className)}>{status}</span>
}

export function TaskOrchestrator(): JSX.Element {
  const projects = useProjectsStore((state) => state.projects)
  const selectedProjectId = useProjectsStore((state) => state.selectedProjectId)
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null
  const selectedWorktreeId = useWorktreesStore((state) => state.selectedWorktreeId)
  const activeTasks = useTasksStore((state) => state.activeTasks)
  const startGraphTask = useTasksStore((state) => state.startGraphTask)
  const attachNodeSession = useTasksStore((state) => state.attachNodeSession)
  const updateTaskNode = useTasksStore((state) => state.updateTaskNode)
  const setNodeReport = useTasksStore((state) => state.setNodeReport)
  const completeTask = useTasksStore((state) => state.completeTask)

  const [description, setDescription] = useState('')
  const [draftNodes, setDraftNodes] = useState<DraftNode[]>(() =>
    BUILT_IN_WORKER_TEMPLATES.map((template) => ({
      template,
      enabled: template.id === 'code-worker' || template.id === 'review-worker',
      ownership: template.ownershipHint ?? '',
      isolatedWorktree: template.isolatedWorktree,
    })),
  )
  const [busyNodeId, setBusyNodeId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => {
      const tasks = useTasksStore.getState().activeTasks
      for (const task of tasks) {
        if (task.status !== 'active') continue
        for (const node of task.graphNodes ?? []) {
          if (node.status !== 'running' || !node.sessionId) continue
          const session = useSessionsStore.getState().sessions.find((item) => item.id === node.sessionId)
          if (!session?.ptyId) {
            updateTaskNode(task.id, node.id, { status: 'failed' })
            continue
          }
          void window.api.session.getReplay(session.ptyId)
            .then((replay) => {
              const report = parseStructuredWorkerReport(replay.data)
              if (report) {
                setNodeReport(task.id, node.id, report)
              }
            })
            .catch(() => {
              // Leave the node running; transient replay failures should not
              // mark useful worker sessions failed.
            })
        }
      }
    }, 15_000)

    return () => window.clearInterval(timer)
  }, [setNodeReport, updateTaskNode])

  const projectTasks = useMemo(
    () => activeTasks
      .filter((task) => !selectedProjectId || task.projectId === selectedProjectId)
      .sort((a, b) => b.createdAt - a.createdAt),
    [activeTasks, selectedProjectId],
  )

  const handleCreateTask = (): void => {
    if (!selectedProject || !description.trim()) return
    const enabled = draftNodes.filter((node) => node.enabled)
    if (enabled.length === 0) return

    const graphNodes: TaskGraphNode[] = enabled.map((draft) => {
      const id = `node-${generateId()}`
      return {
        id,
        templateId: draft.template.id,
        name: draft.template.defaultName,
        type: draft.template.type,
        prompt: applyTemplate(draft.template, description, draft.ownership),
        dependsOn: [],
        ownership: draft.ownership.split(/\r?\n|[,，]/).map((item) => item.trim()).filter(Boolean),
        isolatedWorktree: draft.isolatedWorktree,
        status: 'pending',
      }
    })

    const normalized = graphNodes.map((node) => ({
      ...node,
      dependsOn: node.templateId === 'review-worker'
        ? graphNodes.filter((candidate) => candidate.id !== node.id && candidate.templateId !== 'readonly-explorer').map((candidate) => candidate.id)
        : [],
    }))

    startGraphTask(selectedProject.id, description.trim(), normalized)
    setDescription('')
  }

  const launchNode = async (taskId: string, node: TaskGraphNode): Promise<void> => {
    if (!selectedProject) return
    const task = useTasksStore.getState().activeTasks.find((item) => item.id === taskId)
    setBusyNodeId(node.id)
    setError(null)
    try {
      let worktreeId = selectedWorktreeId ?? useWorktreesStore.getState().getMainWorktree(selectedProject.id)?.id
      if (node.isolatedWorktree) {
        const created = await createAgentWorktree({
          projectId: selectedProject.id,
          projectPath: selectedProject.path,
          label: `${taskId}-${node.name}`,
        })
        if (created.worktreeId) {
          worktreeId = created.worktreeId
        }
        if (created.fallback && created.error) {
          setError(created.error)
        }
      }

      const sessionId = useSessionsStore.getState().addSession(selectedProject.id, node.type, worktreeId ?? undefined)
      useSessionsStore.getState().updateSession(sessionId, {
        name: `${node.name} · ${task?.description ?? 'DAG'}`,
        label: node.name,
        color: node.isolatedWorktree ? '#34d399' : '#60a5fa',
      })
      const paneId = usePanesStore.getState().activePaneId
      usePanesStore.getState().addSessionToPane(paneId, sessionId)
      usePanesStore.getState().setPaneActiveSession(paneId, sessionId)
      useSessionsStore.getState().setActive(sessionId)
      attachNodeSession(taskId, node.id, sessionId, worktreeId ?? undefined)

      const ptyId = await waitForPty(sessionId)
      await window.api.session.submit(ptyId, node.prompt, true)
    } catch (err) {
      updateTaskNode(taskId, node.id, { status: 'failed' })
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyNodeId(null)
    }
  }

  const launchRunnableNodes = async (taskId: string, nodes: TaskGraphNode[]): Promise<void> => {
    for (const node of getRunnableNodes(nodes)) {
      await launchNode(taskId, node)
    }
  }

  const syncReport = async (taskId: string, node: TaskGraphNode): Promise<void> => {
    if (!node.sessionId) return
    const session = useSessionsStore.getState().sessions.find((item) => item.id === node.sessionId)
    if (!session?.ptyId) {
      setError('只能从当前仍在运行的会话同步报告。')
      return
    }
    const replay = await window.api.session.getReplay(session.ptyId)
    const report = parseStructuredWorkerReport(replay.data)
    if (!report) {
      setError('没有找到 RESULT: 结构化报告。')
      return
    }
    setNodeReport(taskId, node.id, report)
    setError(null)
  }

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg-secondary)]">
      <div className="shrink-0 border-b border-[var(--color-border)] p-3">
        <div className="mb-2 flex items-center gap-2">
          <Network size={15} className="text-[var(--color-accent)]" />
          <div>
            <div className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">任务 DAG 编排</div>
            <div className="text-[10px] text-[var(--color-text-tertiary)]">模板化 worker、依赖、隔离 worktree、RESULT 报告</div>
          </div>
        </div>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="描述目标，例如：修复 MCP initial_input 并补类型检查..."
          rows={3}
          className={cn(INPUT, 'resize-none')}
        />
        <div className="mt-2 grid gap-2">
          {draftNodes.map((draft, index) => (
            <div key={draft.template.id} className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => {
                    const checked = event.target.checked
                    setDraftNodes((current) => current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, enabled: checked } : item,
                    ))
                  }}
                />
                <span className="text-[var(--ui-font-xs)] font-medium text-[var(--color-text-primary)]">{draft.template.name}</span>
                {draft.isolatedWorktree && <GitBranch size={12} className="ml-auto text-[var(--color-success)]" />}
              </label>
              <div className="mt-1 text-[10px] leading-4 text-[var(--color-text-tertiary)]">{draft.template.description}</div>
              <textarea
                value={draft.ownership}
                onChange={(event) => {
                  const ownership = event.target.value
                  setDraftNodes((current) => current.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, ownership } : item,
                  ))
                }}
                rows={2}
                className={cn(INPUT, 'mt-2 resize-none py-1.5')}
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={handleCreateTask}
          disabled={!selectedProject || !description.trim() || !draftNodes.some((node) => node.enabled)}
          className={cn(BUTTON, 'mt-3 w-full border-[var(--color-accent)]/45 bg-[var(--color-accent-muted)] text-[var(--color-accent)]')}
        >
          <Sparkles size={13} />
          生成 DAG 任务
        </button>
        {error && <div className="mt-2 rounded-[var(--radius-md)] bg-[var(--color-error)]/10 px-2 py-1.5 text-[10px] text-[var(--color-error)]">{error}</div>}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {projectTasks.length === 0 ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-primary)] px-4 text-center text-[var(--ui-font-xs)] text-[var(--color-text-secondary)]">
            还没有 DAG 任务。选择 worker 模板后生成一个任务图。
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {projectTasks.map((task) => {
              const nodes = task.graphNodes ?? []
              const runnable = getRunnableNodes(nodes)
              return (
                <div key={task.id} className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">{task.description}</div>
                      <div className="mt-1 text-[10px] text-[var(--color-text-tertiary)]">创建于 {formatTime(task.createdAt)} · {nodes.length} 节点</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => completeTask(task.id)}
                      className={BUTTON}
                    >
                      <ShieldCheck size={12} />
                      完成
                    </button>
                  </div>
                  {nodes.length > 0 && (
                    <button
                      type="button"
                      disabled={runnable.length === 0 || busyNodeId !== null}
                      onClick={() => void launchRunnableNodes(task.id, nodes)}
                      className={cn(BUTTON, 'mt-3 w-full')}
                    >
                      <Play size={12} />
                      启动可运行节点 ({runnable.length})
                    </button>
                  )}
                  <div className="mt-3 flex flex-col gap-2">
                    {nodes.map((node) => {
                      const report = task.reports?.[node.id]
                      return (
                        <div key={node.id} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2">
                          <div className="flex items-center gap-2">
                            <StatusBadge status={node.status} />
                            <span className="min-w-0 flex-1 truncate text-[var(--ui-font-xs)] font-medium text-[var(--color-text-primary)]">{node.name}</span>
                            {node.isolatedWorktree && <GitBranch size={12} className="text-[var(--color-success)]" />}
                          </div>
                          {node.dependsOn.length > 0 && (
                            <div className="mt-1 text-[10px] text-[var(--color-text-tertiary)]">依赖 {node.dependsOn.length} 个节点</div>
                          )}
                          {node.sessionId && (
                            <div className="mt-1 truncate text-[10px] text-[var(--color-text-tertiary)]">会话 {node.sessionId}</div>
                          )}
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => void launchNode(task.id, node)}
                              disabled={node.status !== 'pending' || busyNodeId !== null || !runnable.some((item) => item.id === node.id)}
                              className={BUTTON}
                            >
                              <Play size={12} />
                              启动
                            </button>
                            <button
                              type="button"
                              onClick={() => void syncReport(task.id, node)}
                              disabled={!node.sessionId}
                              className={BUTTON}
                            >
                              <RefreshCw size={12} />
                              同步 RESULT
                            </button>
                          </div>
                          {report && (
                            <div className="mt-2 rounded-[var(--radius-sm)] bg-[var(--color-bg-primary)] p-2 text-[10px] leading-5 text-[var(--color-text-secondary)]">
                              <div><span className="text-[var(--color-text-tertiary)]">状态：</span>{report.status || '—'}</div>
                              <div><span className="text-[var(--color-text-tertiary)]">验证：</span>{report.verification || '—'}</div>
                              {report.filesChanged.length > 0 && (
                                <div className="truncate"><span className="text-[var(--color-text-tertiary)]">文件：</span>{report.filesChanged.join(', ')}</div>
                              )}
                              {report.blockers && <div className="text-[var(--color-error)]">阻塞：{report.blockers}</div>}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
