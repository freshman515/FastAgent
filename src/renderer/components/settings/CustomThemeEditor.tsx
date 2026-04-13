import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { GhosttyTheme, ThemeUI, XtermTheme } from '@/lib/ghosttyTheme'
import { ghosttyToXterm } from '@/lib/ghosttyTheme'

// ─── Section definitions ───────────────────────────────────────────────────

interface ColorField {
  label: string
  description: string
  get: (t: GhosttyTheme) => string
  set: (t: GhosttyTheme, v: string) => GhosttyTheme
}

interface ColorSection {
  title: string
  fields: ColorField[]
}

function setUI(t: GhosttyTheme, patch: Partial<ThemeUI>): GhosttyTheme {
  return { ...t, ui: { ...defaultUI(t), ...patch } }
}

function defaultUI(t: GhosttyTheme): ThemeUI {
  return t.ui ?? {
    titleBarBg: t.background,
    panelBg: t.background,
    contentBg: t.background,
    textPrimary: t.foreground,
    textSecondary: t.palette[8],
    textTertiary: t.palette[8],
    border: t.palette[0],
    borderHover: t.palette[8],
    accent: t.palette[12],
    accentHover: t.palette[4],
    success: t.palette[2],
    warning: t.palette[3],
    error: t.palette[1],
  }
}

function setPalette(t: GhosttyTheme, idx: number, color: string): GhosttyTheme {
  const palette = [...t.palette]
  palette[idx] = color
  return { ...t, palette }
}

function stripAlpha(hex: string): string {
  if (/^#[0-9a-f]{8}$/i.test(hex)) return hex.slice(0, 7)
  return hex
}

const COLOR_SECTIONS: ColorSection[] = [
  {
    title: '界面布局',
    fields: [
      {
        label: '标题栏背景',
        description: '顶部标题栏/菜单栏的背景色',
        get: (t) => defaultUI(t).titleBarBg,
        set: (t, v) => setUI(t, { titleBarBg: v }),
      },
      {
        label: '面板背景',
        description: '侧边栏、项目面板、状态栏的背景色',
        get: (t) => defaultUI(t).panelBg,
        set: (t, v) => setUI(t, { panelBg: v }),
      },
      {
        label: '内容区背景',
        description: '主编辑器/会话区域的背景色',
        get: (t) => defaultUI(t).contentBg,
        set: (t, v) => setUI(t, { contentBg: v }),
      },
    ],
  },
  {
    title: '文字与边框',
    fields: [
      {
        label: '主要文字',
        description: '标题、主要内容文字颜色',
        get: (t) => defaultUI(t).textPrimary,
        set: (t, v) => setUI(t, { textPrimary: v }),
      },
      {
        label: '次要文字',
        description: '描述、说明等次要文字颜色',
        get: (t) => defaultUI(t).textSecondary,
        set: (t, v) => setUI(t, { textSecondary: v }),
      },
      {
        label: '三级文字',
        description: '占位符、时间戳等弱化文字颜色',
        get: (t) => defaultUI(t).textTertiary,
        set: (t, v) => setUI(t, { textTertiary: v }),
      },
      {
        label: '边框',
        description: '分割线、卡片、输入框边框颜色',
        get: (t) => defaultUI(t).border,
        set: (t, v) => setUI(t, { border: v }),
      },
      {
        label: '边框（悬停）',
        description: '鼠标悬停时边框颜色',
        get: (t) => defaultUI(t).borderHover,
        set: (t, v) => setUI(t, { borderHover: v }),
      },
    ],
  },
  {
    title: '强调与状态色',
    fields: [
      {
        label: '强调色',
        description: '按钮、链接、选中项等主色调',
        get: (t) => defaultUI(t).accent,
        set: (t, v) => setUI(t, { accent: v }),
      },
      {
        label: '强调色（悬停）',
        description: '强调色在悬停时的变化',
        get: (t) => defaultUI(t).accentHover,
        set: (t, v) => setUI(t, { accentHover: v }),
      },
      {
        label: '成功色',
        description: '成功提示、完成状态',
        get: (t) => defaultUI(t).success,
        set: (t, v) => setUI(t, { success: v }),
      },
      {
        label: '警告色',
        description: '警告提示',
        get: (t) => defaultUI(t).warning,
        set: (t, v) => setUI(t, { warning: v }),
      },
      {
        label: '错误色',
        description: '错误提示、危险操作',
        get: (t) => defaultUI(t).error,
        set: (t, v) => setUI(t, { error: v }),
      },
    ],
  },
  {
    title: '终端',
    fields: [
      {
        label: '终端背景',
        description: '终端/命令行的底色',
        get: (t) => t.background,
        set: (t, v) => ({ ...t, background: v }),
      },
      {
        label: '终端前景',
        description: '终端默认文字颜色',
        get: (t) => t.foreground,
        set: (t, v) => ({ ...t, foreground: v }),
      },
      {
        label: '光标色',
        description: '终端光标颜色',
        get: (t) => t.cursorColor,
        set: (t, v) => ({ ...t, cursorColor: v }),
      },
      {
        label: '选区背景',
        description: '文字选中时的背景色',
        get: (t) => stripAlpha(t.selectionBackground),
        set: (t, v) => ({ ...t, selectionBackground: v }),
      },
    ],
  },
  {
    title: '语法高亮',
    fields: [
      {
        label: '关键字',
        description: 'if / const / function 等关键字',
        get: (t) => t.palette[5],
        set: (t, v) => setPalette(t, 5, v),
      },
      {
        label: '字符串',
        description: '"hello" 字符串字面量',
        get: (t) => t.palette[2],
        set: (t, v) => setPalette(t, 2, v),
      },
      {
        label: '数字',
        description: '42 / 3.14 数字字面量',
        get: (t) => t.palette[3],
        set: (t, v) => setPalette(t, 3, v),
      },
      {
        label: '类型名',
        description: 'string / number 类型注解',
        get: (t) => t.palette[6],
        set: (t, v) => setPalette(t, 6, v),
      },
      {
        label: '函数名',
        description: '函数名和方法调用',
        get: (t) => t.palette[4],
        set: (t, v) => setPalette(t, 4, v),
      },
      {
        label: '注释',
        description: '// 注释文字',
        get: (t) => t.palette[8],
        set: (t, v) => setPalette(t, 8, v),
      },
      {
        label: '运算符 / 错误',
        description: '= + - 等运算符，也用于错误标记',
        get: (t) => t.palette[1],
        set: (t, v) => setPalette(t, 1, v),
      },
    ],
  },
]

// ─── UI Preview ────────────────────────────────────────────────────────────

function UIPreview({ theme }: { theme: GhosttyTheme }): JSX.Element {
  const ui = defaultUI(theme)
  const xterm = ghosttyToXterm(theme)

  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] text-[10px] select-none" style={{ fontFamily: 'monospace' }}>
      {/* Title bar */}
      <div className="flex h-6 items-center gap-2 px-3" style={{ background: ui.titleBarBg, borderBottom: `1px solid ${ui.border}` }}>
        <div className="flex gap-1">
          <span className="block h-2 w-2 rounded-full" style={{ background: ui.error }} />
          <span className="block h-2 w-2 rounded-full" style={{ background: ui.warning }} />
          <span className="block h-2 w-2 rounded-full" style={{ background: ui.success }} />
        </div>
        <span style={{ color: ui.textSecondary }}>FastAgents</span>
      </div>
      <div className="flex" style={{ minHeight: 80 }}>
        {/* Side panel */}
        <div className="flex w-24 flex-col gap-0.5 p-1.5" style={{ background: ui.panelBg, borderRight: `1px solid ${ui.border}` }}>
          <div className="rounded px-1.5 py-0.5" style={{ background: ui.accent, color: '#fff' }}>会话 1</div>
          <div className="rounded px-1.5 py-0.5" style={{ color: ui.textSecondary }}>会话 2</div>
          <div className="rounded px-1.5 py-0.5" style={{ color: ui.textTertiary }}>会话 3</div>
        </div>
        {/* Content */}
        <div className="flex-1 p-2" style={{ background: ui.contentBg }}>
          {/* Editor */}
          <div className="mb-1.5 rounded p-1.5" style={{ background: xterm.background }}>
            <div>
              <span style={{ color: xterm.brightBlack }}>{'// 代码预览'}</span>
            </div>
            <div>
              <span style={{ color: xterm.magenta }}>const </span>
              <span style={{ color: xterm.blue }}>fn </span>
              <span style={{ color: xterm.red }}>= </span>
              <span style={{ color: xterm.green }}>"hello"</span>
            </div>
            <div>
              <span style={{ color: xterm.magenta }}>const </span>
              <span style={{ color: ui.textPrimary }}>n </span>
              <span style={{ color: xterm.red }}>= </span>
              <span style={{ color: xterm.yellow }}>42</span>
            </div>
          </div>
          {/* Button row */}
          <div className="flex gap-1">
            <span className="rounded px-2 py-0.5 text-white" style={{ background: ui.accent }}>确认</span>
            <span className="rounded px-2 py-0.5" style={{ border: `1px solid ${ui.border}`, color: ui.textSecondary }}>取消</span>
            <span className="rounded px-2 py-0.5" style={{ color: ui.error }}>删除</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Color picker row ──────────────────────────────────────────────────────

function ColorRow({ field, theme, onChange }: {
  field: ColorField
  theme: GhosttyTheme
  onChange: (t: GhosttyTheme) => void
}): JSX.Element {
  const value = field.get(theme)

  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-md)] px-2 py-1.5 hover:bg-[var(--color-bg-tertiary)] transition-colors group">
      {/* Swatch */}
      <label className="relative flex-shrink-0 cursor-pointer" title="点击选择颜色">
        <span
          className="block h-10 w-10 rounded-[var(--radius-md)] shadow-md ring-2 ring-[var(--color-border)] group-hover:ring-[var(--color-accent)] transition-all"
          style={{ background: value }}
        />
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[var(--radius-md)] bg-black/0 group-hover:bg-black/25 transition-colors">
          <svg className="opacity-0 group-hover:opacity-100 transition-opacity" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
          </svg>
        </span>
        <input
          type="color"
          value={value.slice(0, 7)}
          onChange={(e) => onChange(field.set(theme, e.target.value))}
          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
        />
      </label>

      <div className="flex-1 min-w-0">
        <div className="text-[var(--ui-font-sm)] text-[var(--color-text-primary)]">{field.label}</div>
        <div className="text-[var(--ui-font-2xs)] text-[var(--color-text-tertiary)] truncate">{field.description}</div>
      </div>

      <input
        type="text"
        value={value.slice(0, 7)}
        onChange={(e) => {
          const v = e.target.value.trim()
          if (/^#[0-9a-f]{6}$/i.test(v)) onChange(field.set(theme, v))
        }}
        maxLength={7}
        spellCheck={false}
        className={cn(
          'w-24 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)]',
          'px-2 py-1.5 text-center font-mono text-[var(--ui-font-xs)] text-[var(--color-text-primary)]',
          'outline-none focus:border-[var(--color-accent)] transition-colors',
        )}
      />
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────

interface CustomThemeEditorProps {
  initialTheme?: GhosttyTheme
  /** 定义时 = 编辑已有自定义主题（名称锁定）；undefined = 新建 */
  initialName?: string
  /** 新建时预填名称（可修改） */
  suggestedName?: string
  existingNames: string[]
  onSave: (name: string, theme: GhosttyTheme) => void
  onCancel: () => void
}

const BLANK_THEME: GhosttyTheme = {
  name: '',
  palette: [
    '#1a1a1e', '#ef5757', '#3ecf7b', '#f0a23b',
    '#5fa0f5', '#c084fc', '#45c8c8', '#e8e8ec',
    '#5e5e66', '#f47070', '#5ddfa0', '#f5c070',
    '#7c6aef', '#d4a0ff', '#6adada', '#ffffff',
  ],
  background: '#1a1a1e',
  foreground: '#e8e8ec',
  cursorColor: '#7c6aef',
  cursorText: '#1a1a1e',
  selectionBackground: '#7c6aef40',
  selectionForeground: '#ffffff',
  ui: {
    titleBarBg: '#111114',
    panelBg: '#16161a',
    contentBg: '#1a1a1e',
    textPrimary: '#e8e8ec',
    textSecondary: '#9090a0',
    textTertiary: '#5e5e66',
    border: '#2c2c34',
    borderHover: '#3e3e4a',
    accent: '#7c6aef',
    accentHover: '#6a5adf',
    success: '#3ecf7b',
    warning: '#f0a23b',
    error: '#ef5757',
  },
}

export function CustomThemeEditor({
  initialTheme,
  initialName,
  suggestedName,
  existingNames,
  onSave,
  onCancel,
}: CustomThemeEditorProps): JSX.Element {
  const [theme, setTheme] = useState<GhosttyTheme>(initialTheme ?? BLANK_THEME)
  const [name, setName] = useState(initialName ?? suggestedName ?? '')
  const [nameError, setNameError] = useState('')
  const [openSection, setOpenSection] = useState<string | null>('界面布局')

  const isEditing = initialName !== undefined

  function handleSave(): void {
    const trimmed = name.trim()
    if (!trimmed) { setNameError('请输入主题名称'); return }
    if (!isEditing && existingNames.includes(trimmed)) {
      setNameError('该名称已存在，请换一个')
      return
    }
    onSave(trimmed, { ...theme, name: trimmed })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Name */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]">
          主题名称
          {!isEditing && suggestedName && (
            <span className="ml-1 text-[var(--color-text-tertiary)]">（基于「{suggestedName}」）</span>
          )}
        </span>
        <input
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setNameError('') }}
          placeholder="我的自定义主题"
          disabled={isEditing}
          className={cn(
            'rounded-[var(--radius-md)] border bg-[var(--color-bg-secondary)]',
            'px-3 py-1.5 text-[var(--ui-font-sm)] text-[var(--color-text-primary)]',
            'outline-none focus:border-[var(--color-accent)]',
            nameError ? 'border-[var(--color-error)]' : 'border-[var(--color-border)]',
            isEditing && 'opacity-50 cursor-not-allowed',
          )}
        />
        {nameError && (
          <span className="text-[var(--ui-font-2xs)] text-[var(--color-error)]">{nameError}</span>
        )}
      </div>

      {/* Preview */}
      <UIPreview theme={theme} />

      {/* Sections */}
      <div className="flex flex-col gap-1">
        {COLOR_SECTIONS.map((section) => (
          <div key={section.title} className="rounded-[var(--radius-md)] border border-[var(--color-border)] overflow-hidden">
            {/* Section header */}
            <button
              type="button"
              onClick={() => setOpenSection(openSection === section.title ? null : section.title)}
              className="flex w-full items-center justify-between px-3 py-2 bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
            >
              <span className="text-[var(--ui-font-xs)] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
                {section.title}
              </span>
              <svg
                width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className={cn('text-[var(--color-text-tertiary)] transition-transform', openSection === section.title && 'rotate-180')}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {/* Section fields */}
            {openSection === section.title && (
              <div className="flex flex-col px-1 py-1">
                {section.fields.map((field) => (
                  <ColorRow key={field.label} field={field} theme={theme} onChange={setTheme} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          className={cn(
            'flex-1 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-4 py-2',
            'text-[var(--ui-font-sm)] font-medium text-white',
            'hover:opacity-90 transition-opacity',
          )}
        >
          {isEditing ? '保存更改' : '创建主题'}
        </button>
        <button
          onClick={onCancel}
          className={cn(
            'rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 py-2',
            'text-[var(--ui-font-sm)] text-[var(--color-text-secondary)]',
            'hover:border-[var(--color-border-hover)] transition-colors',
          )}
        >
          取消
        </button>
      </div>
    </div>
  )
}
