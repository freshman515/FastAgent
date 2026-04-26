import { useState } from 'react'
import { Layers, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTemplatesStore } from '@/stores/templates'
import type { SessionType, SessionTemplateItem } from '@shared/types'
import { BUILT_IN_WORKER_TEMPLATES } from '@shared/workerTemplates'

const SESSION_TYPES: Array<{ value: SessionType; label: string }> = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'claude-code-yolo', label: 'Claude Code YOLO' },
  { value: 'claude-gui', label: 'Claude GUI' },
  { value: 'codex', label: 'Codex' },
  { value: 'codex-yolo', label: 'Codex YOLO' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'gemini-yolo', label: 'Gemini YOLO' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'terminal', label: '终端' },
]

function TemplateItemRow({
  item,
  onUpdate,
  onRemove,
}: {
  item: SessionTemplateItem
  onUpdate: (updates: Partial<SessionTemplateItem>) => void
  onRemove: () => void
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-2">
      <div className="flex items-center gap-2">
        <select
          value={item.type}
          onChange={(e) => onUpdate({ type: e.target.value as SessionType })}
          className="bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded-[var(--radius-sm)] px-2 py-1 text-[var(--ui-font-sm)] text-[var(--color-text-primary)] outline-none"
        >
          {SESSION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <input
          type="text"
          value={item.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="会话名称"
          className="flex-1 bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded-[var(--radius-sm)] px-2 py-1 text-[var(--ui-font-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none"
        />
        <button
          onClick={onRemove}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-danger)]"
        >
          <Trash2 size={12} />
        </button>
      </div>
      <textarea
        value={item.prompt ?? ''}
        onChange={(e) => onUpdate({ prompt: e.target.value || undefined })}
        placeholder="提示词（可选）"
        rows={2}
        className="bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded-[var(--radius-sm)] px-2 py-1 text-[var(--ui-font-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none resize-none"
      />
    </div>
  )
}

function TemplateCard({
  id,
  name,
  projectId,
  items,
}: {
  id: string
  name: string
  projectId: string | null
  items: SessionTemplateItem[]
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const updateTemplate = useTemplatesStore((s) => s.updateTemplate)
  const removeTemplate = useTemplatesStore((s) => s.removeTemplate)

  const handleNameChange = (newName: string): void => {
    updateTemplate(id, { name: newName })
  }

  const handleUpdateItem = (index: number, updates: Partial<SessionTemplateItem>): void => {
    const newItems = items.map((item, i) =>
      i === index ? { ...item, ...updates } : item,
    )
    updateTemplate(id, { items: newItems })
  }

  const handleRemoveItem = (index: number): void => {
    const newItems = items.filter((_, i) => i !== index)
    if (newItems.length === 0) {
      removeTemplate(id)
      return
    }
    updateTemplate(id, { items: newItems })
  }

  const handleAddItem = (): void => {
    const newItem: SessionTemplateItem = { type: 'claude-code', name: '新会话' }
    updateTemplate(id, { items: [...items, newItem] })
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex h-5 w-5 items-center justify-center text-[var(--color-text-tertiary)]"
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <input
          type="text"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          className="flex-1 bg-transparent text-[var(--ui-font-sm)] text-[var(--color-text-primary)] outline-none"
        />
        <span className={cn(
          'rounded-full px-2 py-0.5 text-[var(--ui-font-2xs)]',
          projectId
            ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
            : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)]',
        )}>
          {projectId ? '项目级' : '全局'}
        </span>
        <span className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)]">
          {items.length} 项
        </span>
        <button
          onClick={() => removeTemplate(id)}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-danger)]"
        >
          <Trash2 size={12} />
        </button>
      </div>
      {expanded && (
        <div className="flex flex-col gap-2 border-t border-[var(--color-border)] px-3 py-2">
          {items.map((item, i) => (
            <TemplateItemRow
              key={i}
              item={item}
              onUpdate={(updates) => handleUpdateItem(i, updates)}
              onRemove={() => handleRemoveItem(i)}
            />
          ))}
          <button
            onClick={handleAddItem}
            className="flex items-center gap-1.5 self-start rounded-[var(--radius-sm)] px-2 py-1 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]"
          >
            <Plus size={12} />
            添加条目
          </button>
        </div>
      )}
    </div>
  )
}

export function TemplatesPage(): JSX.Element {
  const templates = useTemplatesStore((s) => s.templates)
  const addTemplate = useTemplatesStore((s) => s.addTemplate)

  const handleAddTemplate = (): void => {
    addTemplate('新模板', null, [{ type: 'claude-code', name: '会话 1' }])
  }

  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-col gap-5 pb-8">
      <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-accent)_12%,var(--color-bg-primary)),var(--color-bg-primary))] px-5 py-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-tertiary)]">会话模板</div>
        <h3 className="mt-2 text-[22px] font-semibold tracking-tight text-[var(--color-text-primary)]">模板设置</h3>
        <p className="mt-2 text-[var(--ui-font-sm)] leading-6 text-[var(--color-text-secondary)]">
          把常用会话组合保存成模板，后续可以一次性快速拉起。
        </p>
      </div>
      <div className="flex items-center gap-2 mb-1">
        <Layers size={14} className="text-[var(--color-accent)]" />
        <span className="text-[var(--ui-font-sm)] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          模板列表
        </span>
      </div>
      <p className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">
        创建可复用模板，用来一次性快速启动多个会话。
      </p>

      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
        <div className="mb-2 text-[var(--ui-font-sm)] font-semibold text-[var(--color-text-primary)]">内置 Worker 模板库</div>
        <div className="grid gap-2 md:grid-cols-2">
          {BUILT_IN_WORKER_TEMPLATES.map((template) => (
            <div key={template.id} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-2">
              <div className="flex items-center gap-2">
                <span className="text-[var(--ui-font-xs)] font-medium text-[var(--color-text-primary)]">{template.name}</span>
                <span className="ml-auto rounded-full bg-[var(--color-bg-tertiary)] px-2 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">{template.type}</span>
              </div>
              <div className="mt-1 text-[10px] leading-4 text-[var(--color-text-tertiary)]">{template.description}</div>
              <div className="mt-2 text-[10px] text-[var(--color-text-secondary)]">
                {template.isolatedWorktree ? '默认隔离 worktree' : '默认共享当前 worktree'}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {templates.map((t) => (
          <TemplateCard
            key={t.id}
            id={t.id}
            name={t.name}
            projectId={t.projectId}
            items={t.items}
          />
        ))}
      </div>

      <button
        onClick={handleAddTemplate}
        className="flex items-center gap-1.5 self-start rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-tertiary)] hover:border-[var(--color-border-hover)] hover:text-[var(--color-text-secondary)]"
      >
        <Plus size={13} />
        新建模板
      </button>
    </div>
  )
}
