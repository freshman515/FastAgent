import { Check, Copy, Save, Sparkles, Trash2, Wand2, X } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { cn, generateId } from '@/lib/utils'
import { useProjectsStore } from '@/stores/projects'
import { usePromptOptimizerStore } from '@/stores/promptOptimizer'
import { type PromptItem, useUIStore } from '@/stores/ui'
import { useWorktreesStore } from '@/stores/worktrees'

const INPUT =
  'h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 text-[var(--ui-font-xs)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none transition-colors focus:border-[var(--color-accent)]'
const TEXTAREA =
  'w-full resize-none rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-2 text-[var(--ui-font-xs)] leading-relaxed text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none transition-colors focus:border-[var(--color-accent)]'
const TOOL_BUTTON =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 text-[10px] font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40'

function inferTitle(prompt: string): string {
  const line = prompt.split(/\r?\n/).map((item) => item.trim()).find(Boolean)
  if (!line) return 'Optimized Prompt'
  return line.length > 28 ? `${line.slice(0, 28)}...` : line
}

export function PromptOptimizerPanel(): JSX.Element {
  const promptItems = useUIStore((state) => state.settings.promptItems)
  const updateSettings = useUIStore((state) => state.updateSettings)
  const addToast = useUIStore((state) => state.addToast)
  const projects = useProjectsStore((state) => state.projects)
  const selectedProjectId = useProjectsStore((state) => state.selectedProjectId)
  const worktrees = useWorktreesStore((state) => state.worktrees)
  const selectedWorktreeId = useWorktreesStore((state) => state.selectedWorktreeId)

  const rootPath = useMemo(() => {
    const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null
    const selectedWorktree = selectedWorktreeId
      ? worktrees.find((worktree) => worktree.id === selectedWorktreeId && worktree.projectId === selectedProjectId) ?? null
      : null
    return selectedWorktree?.path ?? selectedProject?.path ?? null
  }, [projects, selectedProjectId, selectedWorktreeId, worktrees])

  const sourcePrompt = usePromptOptimizerStore((state) => state.sourcePrompt)
  const instruction = usePromptOptimizerStore((state) => state.instruction)
  const optimizedPrompt = usePromptOptimizerStore((state) => state.optimizedPrompt)
  const optimizing = usePromptOptimizerStore((state) => state.optimizing)
  const error = usePromptOptimizerStore((state) => state.error)
  const setSourcePrompt = usePromptOptimizerStore((state) => state.setSourcePrompt)
  const setInstruction = usePromptOptimizerStore((state) => state.setInstruction)
  const setOptimizedPrompt = usePromptOptimizerStore((state) => state.setOptimizedPrompt)
  const setOptimizing = usePromptOptimizerStore((state) => state.setOptimizing)
  const setError = usePromptOptimizerStore((state) => state.setError)
  const clearOptimizer = usePromptOptimizerStore((state) => state.clear)
  const [copied, setCopied] = useState(false)

  const optimizePrompt = useCallback(async () => {
    const prompt = sourcePrompt.trim()
    if (!prompt) {
      setError('先输入要优化的提示词。')
      return
    }

    setOptimizing(true)
    setError(null)
    setOptimizedPrompt('')
    try {
      const result = await window.api.claudeGui.optimizePrompt({
        prompt,
        instruction,
        cwd: rootPath,
      })
      setOptimizedPrompt(result.content)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setOptimizing(false)
    }
  }, [instruction, rootPath, sourcePrompt])

  const copyOptimized = useCallback(async () => {
    if (!optimizedPrompt.trim()) return
    await navigator.clipboard.writeText(optimizedPrompt)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }, [optimizedPrompt])

  const saveToPromptLibrary = useCallback(() => {
    const content = optimizedPrompt.trim()
    if (!content) return
    const now = Date.now()
    const item: PromptItem = {
      id: `prompt-${generateId()}`,
      title: inferTitle(content),
      content,
      tags: ['optimized'],
      createdAt: now,
      updatedAt: now,
      favorite: false,
    }
    updateSettings({ promptItems: [item, ...promptItems] })
    addToast({ type: 'success', title: '已保存到提示词库', body: item.title, duration: 2200 })
  }, [addToast, optimizedPrompt, promptItems, updateSettings])

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]">
      <div className="shrink-0 border-b border-[var(--color-border)] px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[var(--ui-font-sm)] font-semibold">
              <Sparkles size={15} className="text-[var(--color-accent)]" />
              Prompt Lab
            </div>
            <div className="mt-0.5 truncate text-[10px] text-[var(--color-text-tertiary)]" title={rootPath ?? undefined}>
              Haiku prompt optimizer · {rootPath ?? '未选择项目'}
            </div>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={clearOptimizer}
              disabled={optimizing || (!sourcePrompt.trim() && !instruction.trim() && !optimizedPrompt.trim() && !error)}
              className={TOOL_BUTTON}
              title="清除当前优化记录"
            >
              <Trash2 size={13} />
              清除
            </button>
            <button
              type="button"
              onClick={optimizePrompt}
              disabled={optimizing || !sourcePrompt.trim()}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-2.5 text-[10px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Wand2 size={13} />
              {optimizing ? '优化中...' : '优化'}
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <section className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3">
          <div className="text-[var(--ui-font-xs)] font-semibold">原始提示词</div>
          <textarea
            value={sourcePrompt}
            onChange={(event) => setSourcePrompt(event.target.value)}
            placeholder="把需要优化的提示词粘贴到这里..."
            className={cn(TEXTAREA, 'min-h-[180px]')}
          />
          <input
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="优化要求（可选）：更结构化、更适合代码审查、减少歧义..."
            className={INPUT}
          />
        </section>

        {optimizedPrompt && (
          <section className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-accent)]/40 bg-[var(--color-accent-muted)] p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">Optimized Prompt</div>
              <button type="button" onClick={() => setOptimizedPrompt('')} className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]" title="清空结果">
                <X size={13} />
              </button>
            </div>
            <pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap rounded-[var(--radius-sm)] bg-[var(--color-bg-primary)] p-2 text-[var(--ui-font-xs)] leading-relaxed text-[var(--color-text-primary)]">{optimizedPrompt}</pre>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setSourcePrompt(optimizedPrompt.trim())} className={TOOL_BUTTON}>放回输入</button>
              <button type="button" onClick={copyOptimized} className={TOOL_BUTTON}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
                复制结果
              </button>
              <button type="button" onClick={saveToPromptLibrary} className={TOOL_BUTTON}>
                <Save size={13} />
                保存到提示词库
              </button>
            </div>
          </section>
        )}

        {error && (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-error)]/40 bg-[var(--color-error)]/10 px-3 py-2 text-[var(--ui-font-xs)] text-[var(--color-error)]">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
