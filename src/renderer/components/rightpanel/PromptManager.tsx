import { Check, Copy, Plus, Save, Search, Star, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { cn, generateId } from '@/lib/utils'
import { type PromptItem, useUIStore } from '@/stores/ui'

const INPUT =
  'h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 text-[var(--ui-font-xs)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none transition-colors focus:border-[var(--color-accent)]'
const TEXTAREA =
  'w-full resize-none rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-2 text-[var(--ui-font-xs)] leading-relaxed text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none transition-colors focus:border-[var(--color-accent)]'
const TOOL_BUTTON =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 text-[10px] font-medium text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40'

function parseTags(value: string): string[] {
  return Array.from(new Set(value
    .split(/[,\s，]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)))
}

function preview(content: string): string {
  return content.replace(/\s+/g, ' ').trim() || '空提示词'
}

function formatDate(timestamp: number): string {
  return timestamp ? new Date(timestamp).toLocaleDateString() : ''
}

export function PromptManager(): JSX.Element {
  const promptItems = useUIStore((state) => state.settings.promptItems)
  const updateSettings = useUIStore((state) => state.updateSettings)
  const addToast = useUIStore((state) => state.addToast)

  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(promptItems[0]?.id ?? null)
  const [titleDraft, setTitleDraft] = useState('')
  const [contentDraft, setContentDraft] = useState('')
  const [tagsDraft, setTagsDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const selectedPrompt = promptItems.find((item) => item.id === selectedId) ?? null
  const selectedPromptKey = selectedPrompt?.id ?? null

  useEffect(() => {
    if (selectedId && promptItems.some((item) => item.id === selectedId)) return
    setSelectedId(promptItems[0]?.id ?? null)
  }, [promptItems, selectedId])

  useEffect(() => {
    if (!selectedPrompt) {
      setTitleDraft('')
      setContentDraft('')
      setTagsDraft('')
      return
    }
    setTitleDraft(selectedPrompt.title)
    setContentDraft(selectedPrompt.content)
    setTagsDraft(selectedPrompt.tags.join(', '))
    setError(null)
  }, [selectedPromptKey])

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    const sorted = [...promptItems].sort((a, b) => {
      if (a.favorite !== b.favorite) return Number(b.favorite) - Number(a.favorite)
      return b.updatedAt - a.updatedAt
    })
    if (!q) return sorted
    return sorted.filter((item) => (
      item.title.toLowerCase().includes(q)
      || item.content.toLowerCase().includes(q)
      || item.tags.some((tag) => tag.toLowerCase().includes(q))
    ))
  }, [promptItems, query])

  const saveItems = useCallback((items: PromptItem[]) => {
    updateSettings({ promptItems: items })
  }, [updateSettings])

  const createPrompt = useCallback(() => {
    const now = Date.now()
    const item: PromptItem = {
      id: `prompt-${generateId()}`,
      title: 'Untitled Prompt',
      content: '在这里编写提示词...',
      tags: [],
      createdAt: now,
      updatedAt: now,
      favorite: false,
    }
    saveItems([item, ...promptItems])
    setSelectedId(item.id)
  }, [promptItems, saveItems])

  const saveCurrent = useCallback(() => {
    if (!selectedPrompt) return
    const title = titleDraft.trim()
    const content = contentDraft.trim()
    if (!title || !content) {
      setError('标题和提示词内容不能为空。')
      return
    }

    const now = Date.now()
    saveItems(promptItems.map((item) => (
      item.id === selectedPrompt.id
        ? { ...item, title, content, tags: parseTags(tagsDraft), updatedAt: now }
        : item
    )))
    setError(null)
    addToast({ type: 'success', title: '提示词已保存', body: title, duration: 2200 })
  }, [addToast, contentDraft, promptItems, saveItems, selectedPrompt, tagsDraft, titleDraft])

  const deleteCurrent = useCallback(() => {
    if (!selectedPrompt) return
    if (!window.confirm(`删除提示词 "${selectedPrompt.title}"？`)) return
    const next = promptItems.filter((item) => item.id !== selectedPrompt.id)
    saveItems(next)
    setSelectedId(next[0]?.id ?? null)
  }, [promptItems, saveItems, selectedPrompt])

  const toggleFavorite = useCallback(() => {
    if (!selectedPrompt) return
    const now = Date.now()
    saveItems(promptItems.map((item) => (
      item.id === selectedPrompt.id ? { ...item, favorite: !item.favorite, updatedAt: now } : item
    )))
  }, [promptItems, saveItems, selectedPrompt])

  const copyCurrent = useCallback(async () => {
    if (!contentDraft.trim()) return
    await navigator.clipboard.writeText(contentDraft)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }, [contentDraft])

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]">
      <div className="shrink-0 border-b border-[var(--color-border)] px-3 py-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <div className="text-[var(--ui-font-sm)] font-semibold">提示词管理</div>
            <div className="text-[10px] text-[var(--color-text-tertiary)]">{promptItems.length} prompts</div>
          </div>
          <button
            type="button"
            onClick={createPrompt}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent)] text-white transition-opacity hover:opacity-90"
            title="新建提示词"
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题、内容、标签..."
            className={cn(INPUT, 'pl-8')}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="border-b border-[var(--color-border)] p-2">
          {filteredItems.length === 0 ? (
            <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-3 py-5 text-center text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
              {promptItems.length === 0 ? '还没有提示词，点击右上角新建。' : '没有匹配的提示词。'}
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={cn(
                    'w-full rounded-[var(--radius-md)] border px-2.5 py-2 text-left transition-colors',
                    selectedId === item.id
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)]'
                      : 'border-[var(--color-border)] bg-[var(--color-bg-primary)] hover:border-[var(--color-border-hover)]',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[var(--ui-font-xs)] font-semibold">{item.title}</span>
                    {item.favorite && <Star size={13} className="shrink-0 text-[var(--color-warning)]" fill="currentColor" />}
                  </div>
                  <div className="mt-1 truncate text-[10px] text-[var(--color-text-secondary)]">{preview(item.content)}</div>
                  <div className="mt-1.5 flex items-center gap-1.5 overflow-hidden text-[9px] text-[var(--color-text-tertiary)]">
                    <span className="shrink-0">{formatDate(item.updatedAt)}</span>
                    {item.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="truncate rounded-full bg-[var(--color-bg-tertiary)] px-1.5 py-0.5">{tag}</span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3 p-3">
          {selectedPrompt ? (
            <section className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[var(--ui-font-xs)] font-semibold">提示词内容</div>
                <div className="flex gap-1.5">
                  <button type="button" onClick={copyCurrent} className={TOOL_BUTTON}>
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    复制
                  </button>
                  <button type="button" onClick={saveCurrent} className={TOOL_BUTTON}>
                    <Save size={13} />
                    保存
                  </button>
                </div>
              </div>
              <input value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} placeholder="标题" className={INPUT} />
              <input value={tagsDraft} onChange={(event) => setTagsDraft(event.target.value)} placeholder="标签，用逗号或空格分隔" className={INPUT} />
              <textarea value={contentDraft} onChange={(event) => setContentDraft(event.target.value)} placeholder="输入提示词..." className={cn(TEXTAREA, 'min-h-[220px]')} />
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={toggleFavorite} className={TOOL_BUTTON}>
                  <Star size={13} fill={selectedPrompt.favorite ? 'currentColor' : 'none'} />
                  {selectedPrompt.favorite ? '取消收藏' : '收藏'}
                </button>
                <button type="button" onClick={deleteCurrent} className={cn(TOOL_BUTTON, 'hover:border-[var(--color-error)] hover:text-[var(--color-error)]')}>
                  <Trash2 size={13} />
                  删除
                </button>
              </div>
            </section>
          ) : (
            <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-8 text-center">
              <div className="text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-secondary)]">选择或新建一个提示词</div>
              <button type="button" onClick={createPrompt} className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-3 text-[10px] font-semibold text-white">
                <Plus size={13} />
                新建提示词
              </button>
            </div>
          )}

          {error && (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-error)]/40 bg-[var(--color-error)]/10 px-3 py-2 text-[var(--ui-font-xs)] text-[var(--color-error)]">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
