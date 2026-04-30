import { CheckCircle2, FilePlus2, Infinity as InfinityIcon, Play, RefreshCw, Settings2, Square, Trash2, XCircle } from 'lucide-react'
import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import type { AgentSessionType, StructuredWorkerReport } from '@shared/types'
import { parseStructuredWorkerReport } from '@/lib/worker-report'
import { cn } from '@/lib/utils'
import { createAgentWorktree } from '@/lib/agent-worktrees'
import { useInfiniteTasksStore, type InfiniteTaskItem, type InfiniteTaskStatus } from '@/stores/infiniteTasks'
import { usePanesStore } from '@/stores/panes'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useWorktreesStore } from '@/stores/worktrees'

const INPUT = 'w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-2 text-[var(--ui-font-xs)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none transition-colors focus:border-[var(--color-accent)]'
const BUTTON = 'inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-1.5 text-[10px] font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40'

const AGENT_OPTIONS: Array<{ id: AgentSessionType; label: string }> = [
  { id: 'codex-yolo', label: 'Codex YOLO' },
  { id: 'codex', label: 'Codex' },
  { id: 'claude-code-yolo', label: 'Claude YOLO' },
  { id: 'claude-code', label: 'Claude' },
  { id: 'gemini-yolo', label: 'Gemini YOLO' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'opencode', label: 'OpenCode' },
]

const STATUS_LABEL: Record<InfiniteTaskStatus, string> = {
  queued: '等待',
  running: '执行',
  reviewing: '审查',
  revising: '修复',
  verifying: '复核',
  completed: '完成',
  failed: '失败',
  cancelled: '取消',
}

const STATUS_CLASS: Record<InfiniteTaskStatus, string> = {
  queued: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)]',
  running: 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]',
  reviewing: 'bg-sky-500/15 text-sky-300',
  revising: 'bg-amber-500/15 text-amber-300',
  verifying: 'bg-violet-500/15 text-violet-300',
  completed: 'bg-[var(--color-success)]/15 text-[var(--color-success)]',
  failed: 'bg-[var(--color-error)]/15 text-[var(--color-error)]',
  cancelled: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)]',
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function waitForPty(sessionId: string, timeoutMs = 20_000): Promise<string> {
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
      window.setTimeout(tick, 350)
    }
    tick()
  })
}

function parseTaskFile(content: string, sourceFileName: string): Array<{ prompt: string; sourceFileName: string }> {
  const normalized = content.trim()
  if (!normalized) return []

  const headingSections = normalized
    .split(/(?=^#{1,3}\s+)/m)
    .map((section) => section.trim())
    .filter(Boolean)
  if (headingSections.length > 1) {
    return headingSections.map((prompt) => ({ prompt, sourceFileName }))
  }

  const dividerSections = normalized
    .split(/^\s*---+\s*$/m)
    .map((section) => section.trim())
    .filter(Boolean)
  return (dividerSections.length > 1 ? dividerSections : [normalized])
    .map((prompt) => ({ prompt, sourceFileName }))
}

function composeWorkerPrompt(task: InfiniteTaskItem): string {
  return `你是 FastAgents 无限任务 worker。你不是代码库里的唯一会话，不能回滚用户或其他会话的改动。

任务：
${task.prompt}

执行要求：
1. 自己完整理解任务，必要时先读取相关文件。
2. 可以直接修改代码、补测试、跑验证，不要中途停下来问主控“要不要继续”。
3. 如果发现需要更大范围改动，先做最小可行修改，并在最终报告说明。
4. 如果遇到阻塞，明确写出阻塞原因和建议下一步。
5. 最终必须输出结构化报告：第一行写英文 RESULT 和冒号，后面逐行写这些字段：

- 状态：completed / blocked
- 修改文件：
- 验证：
- 风险：
- 阻塞：
- 建议下一步：`
}

function composeReviewPrompt(task: InfiniteTaskItem, workerReport: string): string {
  return `你是 FastAgents 无限任务 reviewer。只读审查，不要修改文件。

原始任务：
${task.prompt}

worker 报告：
${workerReport}

审查要求：
1. 审查当前工作区改动是否真的满足任务。
2. 重点找 bug、回归、漏测、状态同步、边界条件、用户体验问题。
3. 如果没有明确问题，状态写 pass，阻塞写“无”。
4. 如果需要修改，状态写 needs_changes，并把必须修改的点写进“阻塞”。

- 状态：pass / needs_changes
- 修改文件：无
- 验证：
- 风险：
- 阻塞：
- 建议下一步：`
}

function composeRevisionPrompt(task: InfiniteTaskItem, reviewReport: string): string {
  return `继续这个无限任务，不要重新开题。

原始任务：
${task.prompt}

审查意见：
${reviewReport}

请根据审查意见继续修改并验证。完成后必须重新输出结构化报告：第一行写英文 RESULT 和冒号，后面逐行写这些字段：

- 状态：completed / blocked
- 修改文件：
- 验证：
- 风险：
- 阻塞：
- 建议下一步：`
}

function reviewNeedsChanges(report: StructuredWorkerReport): boolean {
  const status = report.status.toLowerCase()
  const blockers = report.blockers.trim()
  if (status.includes('pass') || status.includes('通过')) return false
  if (!blockers || /^(无|没有|未发现|none|n\/a)$/i.test(blockers)) return false
  return true
}

async function waitForReport(
  taskId: string,
  sessionId: string,
  label: string,
  minOutputLength: number,
  shouldContinue: () => boolean,
): Promise<StructuredWorkerReport> {
  const { appendTaskEvent } = useInfiniteTasksStore.getState()
  let lastOutputLength = 0
  let lastProgressAt = Date.now()

  while (shouldContinue()) {
    const session = useSessionsStore.getState().sessions.find((item) => item.id === sessionId)
    if (!session?.ptyId) {
      throw new Error(`${label} 会话已经停止`)
    }

    const replay = await window.api.session.getReplay(session.ptyId)
    if (replay.data.length !== lastOutputLength) {
      lastOutputLength = replay.data.length
      lastProgressAt = Date.now()
    }

    const report = parseStructuredWorkerReport(replay.data.slice(Math.max(0, minOutputLength)))
    if (report) return report

    if (Date.now() - lastProgressAt > 10 * 60 * 1000) {
      appendTaskEvent(taskId, 'warning', `${label} 10 分钟没有新输出，仍继续等待`)
      lastProgressAt = Date.now()
    }
    await sleep(5000)
  }

  throw new Error('任务运行已停止')
}

function StatusBadge({ status }: { status: InfiniteTaskStatus }): JSX.Element {
  return <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', STATUS_CLASS[status])}>{STATUS_LABEL[status]}</span>
}

function EventList({ task }: { task: InfiniteTaskItem }): JSX.Element {
  const recent = task.events.slice(-4).reverse()
  if (recent.length === 0) return <div className="text-[10px] text-[var(--color-text-tertiary)]">暂无运行记录</div>
  return (
    <div className="mt-2 flex flex-col gap-1">
      {recent.map((event) => (
        <div key={event.id} className="flex gap-2 text-[10px] leading-4 text-[var(--color-text-tertiary)]">
          <span className="shrink-0 font-mono">{new Date(event.ts).toLocaleTimeString()}</span>
          <span className={cn(
            'min-w-0 flex-1',
            event.level === 'success' && 'text-[var(--color-success)]',
            event.level === 'warning' && 'text-amber-300',
            event.level === 'error' && 'text-[var(--color-error)]',
          )}>
            {event.message}
          </span>
        </div>
      ))}
    </div>
  )
}

export function InfiniteTaskPanel(): JSX.Element {
  const projects = useProjectsStore((state) => state.projects)
  const selectedProjectId = useProjectsStore((state) => state.selectedProjectId)
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null
  const selectedWorktreeId = useWorktreesStore((state) => state.selectedWorktreeId)
  const tasks = useInfiniteTasksStore((state) => state.tasks)
  const settings = useInfiniteTasksStore((state) => state.settings)
  const running = useInfiniteTasksStore((state) => state.running)
  const activeTaskId = useInfiniteTasksStore((state) => state.activeTaskId)
  const setSettings = useInfiniteTasksStore((state) => state.setSettings)
  const addTask = useInfiniteTasksStore((state) => state.addTask)
  const addTasks = useInfiniteTasksStore((state) => state.addTasks)
  const updateTask = useInfiniteTasksStore((state) => state.updateTask)
  const appendTaskEvent = useInfiniteTasksStore((state) => state.appendTaskEvent)
  const removeTask = useInfiniteTasksStore((state) => state.removeTask)
  const clearFinished = useInfiniteTasksStore((state) => state.clearFinished)
  const setRunning = useInfiniteTasksStore((state) => state.setRunning)
  const [draft, setDraft] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const runTokenRef = useRef(0)

  const projectTasks = useMemo(
    () => tasks
      .filter((task) => !selectedProjectId || task.projectId === selectedProjectId)
      .sort((a, b) => b.createdAt - a.createdAt),
    [tasks, selectedProjectId],
  )

  const queueCount = projectTasks.filter((task) => task.status === 'queued' || task.status === 'failed').length

  const createSessionForTask = async (task: InfiniteTaskItem, role: 'worker' | 'reviewer'): Promise<string> => {
    const project = projects.find((item) => item.id === task.projectId)
    if (!project) throw new Error('任务所属项目不存在')

    let worktreeId = selectedWorktreeId ?? useWorktreesStore.getState().getMainWorktree(project.id)?.id
    if (task.isolateWorktree && role === 'worker') {
      const created = await createAgentWorktree({
        projectId: project.id,
        projectPath: project.path,
        label: `infinite-${task.id}`,
      })
      if (created.worktreeId) worktreeId = created.worktreeId
      if (created.fallback && created.error) {
        appendTaskEvent(task.id, 'warning', `worktree 创建失败，回退当前工作区：${created.error}`)
      }
    }

    const type = task.allowedSessionTypes[0] ?? 'codex-yolo'
    const sessionId = useSessionsStore.getState().addSession(project.id, type, worktreeId)
    useSessionsStore.getState().updateSession(sessionId, {
      name: `${role === 'worker' ? '无限任务' : '无限审查'} · ${task.title}`,
      label: role === 'worker' ? '执行' : '审查',
      color: role === 'worker' ? '#8b5cf6' : '#38bdf8',
    })

    const paneId = usePanesStore.getState().activePaneId
    usePanesStore.getState().addSessionToPane(paneId, sessionId)
    usePanesStore.getState().setPaneActiveSession(paneId, sessionId)
    useSessionsStore.getState().setActive(sessionId)

    return sessionId
  }

  const submitToSession = async (sessionId: string, prompt: string): Promise<number> => {
    const ptyId = await waitForPty(sessionId)
    const before = await window.api.session.getReplay(ptyId).catch(() => ({ data: '', seq: 0 }))
    await window.api.session.submit(ptyId, prompt, true)
    return before.data.length
  }

  const runOneTask = async (taskId: string, token: number): Promise<void> => {
    const shouldContinue = () => runTokenRef.current === token
    const latest = () => useInfiniteTasksStore.getState().tasks.find((task) => task.id === taskId)
    const task = latest()
    if (!task || !selectedProject) return

    updateTask(taskId, {
      status: 'running',
      stage: '创建执行会话',
      startedAt: Date.now(),
      completedAt: undefined,
      error: undefined,
      reviewRound: 0,
    })
    setRunning(true, taskId)
    appendTaskEvent(taskId, 'info', '开始无限任务')

    try {
      let currentTask = latest()
      if (!currentTask) throw new Error('任务不存在')
      let workerSessionId = currentTask.workerSessionId
      if (!workerSessionId) {
        workerSessionId = await createSessionForTask(currentTask, 'worker')
        updateTask(taskId, { workerSessionId })
      }

      let workerOutputStart = await submitToSession(workerSessionId, composeWorkerPrompt(currentTask))
      appendTaskEvent(taskId, 'info', '已发送执行任务')

      for (let round = 0; round <= currentTask.maxReviewRounds && shouldContinue(); round += 1) {
        updateTask(taskId, { status: round === 0 ? 'running' : 'revising', stage: round === 0 ? '等待执行报告' : '等待修复报告', reviewRound: round })
        const workerReport = await waitForReport(taskId, workerSessionId, '执行', workerOutputStart, shouldContinue)
        updateTask(taskId, { lastReport: workerReport.raw, status: 'reviewing', stage: '创建审查会话' })
        appendTaskEvent(taskId, 'success', `收到执行报告，第 ${round + 1} 轮`)

        currentTask = latest()
        if (!currentTask) throw new Error('任务不存在')
        let reviewSessionId = currentTask.reviewSessionId
        if (!reviewSessionId) {
          reviewSessionId = await createSessionForTask(currentTask, 'reviewer')
          updateTask(taskId, { reviewSessionId })
        }

        updateTask(taskId, { stage: '等待审查报告' })
        const reviewOutputStart = await submitToSession(reviewSessionId, composeReviewPrompt(currentTask, workerReport.raw))
        const reviewReport = await waitForReport(taskId, reviewSessionId, '审查', reviewOutputStart, shouldContinue)
        updateTask(taskId, { lastReview: reviewReport.raw, status: 'verifying', stage: '核对审查结果' })
        appendTaskEvent(taskId, reviewNeedsChanges(reviewReport) ? 'warning' : 'success', reviewNeedsChanges(reviewReport) ? '审查要求继续修改' : '审查通过')

        if (!reviewNeedsChanges(reviewReport)) {
          updateTask(taskId, {
            status: 'completed',
            stage: '已完成',
            completedAt: Date.now(),
            error: undefined,
          })
          appendTaskEvent(taskId, 'success', '任务完成，自动进入下一个任务')
          return
        }

        if (round >= currentTask.maxReviewRounds) {
          updateTask(taskId, {
            status: 'failed',
            stage: '达到复核轮次上限',
            completedAt: Date.now(),
            error: '审查仍要求修改，已达到轮次上限',
          })
          appendTaskEvent(taskId, 'error', '达到复核轮次上限')
          return
        }

        updateTask(taskId, { status: 'revising', stage: '回发审查意见' })
        workerOutputStart = await submitToSession(workerSessionId, composeRevisionPrompt(currentTask, reviewReport.raw))
        appendTaskEvent(taskId, 'info', '已把审查意见回发给执行会话')
        await sleep(3000)
      }
    } catch (error) {
      updateTask(taskId, {
        status: shouldContinue() ? 'failed' : 'cancelled',
        stage: shouldContinue() ? '运行失败' : '已停止',
        error: error instanceof Error ? error.message : String(error),
        completedAt: Date.now(),
      })
      appendTaskEvent(taskId, shouldContinue() ? 'error' : 'warning', error instanceof Error ? error.message : String(error))
    }
  }

  const startTasks = async (taskIds: string[]): Promise<void> => {
    if (!selectedProject || running) return
    const token = runTokenRef.current + 1
    runTokenRef.current = token
    setRunning(true, null)

    try {
      for (const taskId of taskIds) {
        if (runTokenRef.current !== token) break
        const task = useInfiniteTasksStore.getState().tasks.find((item) => item.id === taskId)
        if (!task || task.status === 'completed' || task.status === 'cancelled') continue
        await runOneTask(taskId, token)
      }
    } finally {
      if (runTokenRef.current === token) {
        setRunning(false, null)
      }
    }
  }

  const stopRunning = (): void => {
    runTokenRef.current += 1
    setRunning(false, null)
  }

  const handleAddTask = (): void => {
    if (!selectedProject || !draft.trim()) return
    addTask(selectedProject.id, draft)
    setDraft('')
  }

  const importFiles = async (files: File[]): Promise<void> => {
    if (!selectedProject || files.length === 0) return
    const imported: Array<{ prompt: string; sourceFileName?: string }> = []
    for (const file of files) {
      if (!/\.(md|txt|task)$/i.test(file.name)) continue
      const text = await file.text()
      imported.push(...parseTaskFile(text, file.name))
    }
    addTasks(selectedProject.id, imported)
  }

  const handleFilesSelected = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    await importFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  const handleDrop = async (event: DragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault()
    event.stopPropagation()
    setDragActive(false)
    await importFiles(Array.from(event.dataTransfer.files ?? []))
  }

  const toggleAgentType = (type: AgentSessionType): void => {
    const current = new Set(settings.allowedSessionTypes)
    if (current.has(type)) current.delete(type)
    else current.add(type)
    setSettings({ allowedSessionTypes: current.size > 0 ? Array.from(current) : ['codex-yolo'] })
  }

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg-secondary)]">
      <div className="shrink-0 border-b border-[var(--color-border)] p-3">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <InfinityIcon size={16} className="shrink-0 text-[var(--color-accent)]" />
            <div className="min-w-0">
              <div className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">无限任务</div>
              <div className="truncate text-[10px] text-[var(--color-text-tertiary)]">{selectedProject ? selectedProject.name : '先选择项目'}</div>
            </div>
          </div>
          <button type="button" className={BUTTON} onClick={() => setShowSettings((value) => !value)} title="任务设置">
            <Settings2 size={12} />
          </button>
        </div>

        {showSettings && (
          <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-2">
            <div className="mb-2 text-[10px] text-[var(--color-text-tertiary)]">允许使用的会话</div>
            <div className="grid grid-cols-2 gap-1.5">
              {AGENT_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => toggleAgentType(option.id)}
                  className={cn(
                    BUTTON,
                    settings.allowedSessionTypes.includes(option.id) && 'border-[var(--color-accent)]/50 bg-[var(--color-accent-muted)] text-[var(--color-accent)]',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <label className="mt-2 flex items-center gap-2 text-[10px] text-[var(--color-text-secondary)]">
              <input
                type="checkbox"
                checked={settings.isolateWorktree}
                onChange={(event) => setSettings({ isolateWorktree: event.target.checked })}
              />
              新任务优先创建独立 worktree
            </label>
            <label className="mt-2 flex items-center justify-between gap-2 text-[10px] text-[var(--color-text-secondary)]">
              <span>最大复核轮次</span>
              <input
                type="number"
                min={0}
                max={5}
                value={settings.maxReviewRounds}
                onChange={(event) => setSettings({ maxReviewRounds: Number(event.target.value) })}
                className="w-16 rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1 text-right text-[10px] text-[var(--color-text-primary)] outline-none"
              />
            </label>
          </div>
        )}

        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="输入一个任务。启动后会自动执行、审查、回发修改意见、复核，然后继续下一个任务。"
          rows={4}
          className={cn(INPUT, 'resize-none')}
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" onClick={handleAddTask} disabled={!selectedProject || !draft.trim()} className={BUTTON}>
            <FilePlus2 size={12} />
            加入队列
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!selectedProject} className={BUTTON}>
            <FilePlus2 size={12} />
            任务文件
          </button>
        </div>
        <input ref={fileInputRef} type="file" multiple accept=".md,.txt,.task" className="hidden" onChange={(event) => void handleFilesSelected(event)} />
        <div className="mt-2 grid grid-cols-2 gap-2">
          {running ? (
            <button type="button" onClick={stopRunning} className={cn(BUTTON, 'border-[var(--color-error)]/50 text-[var(--color-error)]')}>
              <Square size={12} />
              停止
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void startTasks(projectTasks.map((task) => task.id))}
              disabled={!selectedProject || queueCount === 0}
              className={cn(BUTTON, 'border-[var(--color-accent)]/50 bg-[var(--color-accent-muted)] text-[var(--color-accent)]')}
            >
              <Play size={12} />
              启动全部 {queueCount > 0 ? queueCount : ''}
            </button>
          )}
          <button type="button" onClick={clearFinished} className={BUTTON}>
            <Trash2 size={12} />
            清理完成
          </button>
        </div>
      </div>

      <div
        className="relative flex-1 overflow-y-auto p-3"
        onDragEnter={(event) => {
          event.preventDefault()
          if (event.dataTransfer.types.includes('Files')) setDragActive(true)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          if (event.dataTransfer.types.includes('Files')) {
            event.dataTransfer.dropEffect = selectedProject ? 'copy' : 'none'
            setDragActive(true)
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragActive(false)
          }
        }}
        onDrop={(event) => void handleDrop(event)}
      >
        {dragActive && (
          <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-accent)]/60 bg-[var(--color-accent-muted)]/80 text-center text-[var(--ui-font-xs)] font-medium leading-5 text-[var(--color-accent)] shadow-[0_0_0_1px_var(--color-accent-muted)] backdrop-blur-sm">
            {selectedProject ? '松开导入任务文件' : '先选择项目'}
          </div>
        )}
        {projectTasks.length === 0 ? (
          <div
            className={cn(
              'flex h-full min-h-56 flex-col items-center justify-center rounded-[var(--radius-md)] border border-dashed px-4 text-center text-[var(--ui-font-xs)] leading-5 transition-colors',
              dragActive
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                : 'border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)]',
            )}
          >
            <InfinityIcon size={24} className="mb-2 text-[var(--color-text-tertiary)]" />
            添加任务、点击任务文件，或把任务文件拖到这里。
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {projectTasks.map((task) => (
              <div
                key={task.id}
                className={cn(
                  'rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-2.5',
                  activeTaskId === task.id && 'border-[var(--color-accent)]/55 bg-[var(--color-accent-muted)]/30',
                )}
              >
                <div className="flex items-start gap-2">
                  <StatusBadge status={task.status} />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-[var(--ui-font-xs)] font-medium leading-5 text-[var(--color-text-primary)]">{task.title}</div>
                    <div className="mt-0.5 truncate text-[10px] text-[var(--color-text-tertiary)]">{task.stage || '等待'} · 第 {task.reviewRound}/{task.maxReviewRounds} 轮</div>
                  </div>
                  {task.status === 'completed' ? <CheckCircle2 size={14} className="text-[var(--color-success)]" /> : null}
                  {task.status === 'failed' ? <XCircle size={14} className="text-[var(--color-error)]" /> : null}
                </div>
                {task.sourceFileName && <div className="mt-1 truncate text-[10px] text-[var(--color-text-tertiary)]">来源：{task.sourceFileName}</div>}
                {task.error && <div className="mt-2 rounded bg-[var(--color-error)]/10 px-2 py-1 text-[10px] text-[var(--color-error)]">{task.error}</div>}
                <EventList task={task} />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    disabled={running || !selectedProject || task.status === 'completed' || task.status === 'cancelled'}
                    onClick={() => void startTasks([task.id])}
                    className={BUTTON}
                  >
                    <Play size={12} />
                    启动
                  </button>
                  <button
                    type="button"
                    disabled={running}
                    onClick={() => {
                      updateTask(task.id, { status: 'queued', stage: '等待重新启动', error: undefined, completedAt: undefined })
                      useInfiniteTasksStore.getState().appendTaskEvent(task.id, 'info', '已重置为等待状态')
                    }}
                    className={BUTTON}
                  >
                    <RefreshCw size={12} />
                    重置
                  </button>
                  <button
                    type="button"
                    disabled={running && activeTaskId === task.id}
                    onClick={() => removeTask(task.id)}
                    className={BUTTON}
                  >
                    <Trash2 size={12} />
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
