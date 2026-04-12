import type { GhosttyTheme } from './ghosttyTheme'

// ─── VSCode Theme JSON → GhosttyTheme ───────────────────────────────────────
//
// VSCode themes use "terminal.ansiXxx" for the 16-color palette
// and "editor.background / editor.foreground" for base colors.

const VSCODE_ANSI_KEYS: Array<keyof typeof VSCODE_ANSI_MAP> = []

const VSCODE_ANSI_MAP = {
  'terminal.ansiBlack':         0,
  'terminal.ansiRed':           1,
  'terminal.ansiGreen':         2,
  'terminal.ansiYellow':        3,
  'terminal.ansiBlue':          4,
  'terminal.ansiMagenta':       5,
  'terminal.ansiCyan':          6,
  'terminal.ansiWhite':         7,
  'terminal.ansiBrightBlack':   8,
  'terminal.ansiBrightRed':     9,
  'terminal.ansiBrightGreen':   10,
  'terminal.ansiBrightYellow':  11,
  'terminal.ansiBrightBlue':    12,
  'terminal.ansiBrightMagenta': 13,
  'terminal.ansiBrightCyan':    14,
  'terminal.ansiBrightWhite':   15,
} as const

// Fallback palette when a VSCode theme doesn't define terminal colors —
// derived from its tokenColors instead.
const DEFAULT_PALETTE: string[] = [
  '#000000', '#cd3131', '#0dbc79', '#e5e510',
  '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
  '#666666', '#f14c4c', '#23d18b', '#f5f543',
  '#3b8eea', '#d670d6', '#29b8db', '#ffffff',
]

function normalizeHex(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const s = raw.trim()
  // Strip alpha from 8-char hex (#rrggbbaa → #rrggbb) for palette entries
  if (/^#[0-9a-f]{8}$/i.test(s)) return s.slice(0, 7)
  if (/^#[0-9a-f]{6}$/i.test(s)) return s
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    const [, r, g, b] = s
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return undefined
}

function normalizeHexWithAlpha(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const s = raw.trim()
  if (/^#[0-9a-f]{8}$/i.test(s)) return s
  return normalizeHex(s)
}

export interface ImportError {
  message: string
}

export type ImportResult =
  | { ok: true; theme: GhosttyTheme }
  | { ok: false; error: string }

export function parseVSCodeTheme(jsonText: string, themeName: string): ImportResult {
  let raw: Record<string, unknown>
  try {
    // VSCode theme JSONs sometimes have comments — strip them
    const stripped = jsonText.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    raw = JSON.parse(stripped)
  } catch {
    return { ok: false, error: '无法解析 JSON，请确认文件格式正确。' }
  }

  const colors = (raw.colors ?? {}) as Record<string, string>
  const type = typeof raw.type === 'string' ? raw.type : 'dark'

  const bg =
    normalizeHex(colors['terminal.background']) ??
    normalizeHex(colors['editor.background']) ??
    (type === 'light' ? '#ffffff' : '#1e1e1e')

  const fg =
    normalizeHex(colors['terminal.foreground']) ??
    normalizeHex(colors['editor.foreground']) ??
    (type === 'light' ? '#000000' : '#d4d4d4')

  const cursor =
    normalizeHex(colors['terminalCursor.foreground']) ??
    normalizeHex(colors['editorCursor.foreground']) ??
    fg

  const selBg =
    normalizeHexWithAlpha(colors['terminal.selectionBackground']) ??
    normalizeHexWithAlpha(colors['editor.selectionBackground']) ??
    '#264f78'

  // Build 16-color palette
  const palette = [...DEFAULT_PALETTE]
  for (const [key, index] of Object.entries(VSCODE_ANSI_MAP)) {
    const hex = normalizeHex(colors[key])
    if (hex) palette[index] = hex
  }

  const theme: GhosttyTheme = {
    name: themeName,
    palette,
    background: bg,
    foreground: fg,
    cursorColor: cursor,
    cursorText: bg,
    selectionBackground: selBg,
    selectionForeground: fg,
  }

  return { ok: true, theme }
}

// ─── Ghostty Theme File → GhosttyTheme ──────────────────────────────────────
//
// Ghostty theme format:
//   background = 1a1a1e
//   foreground = e8e8ec
//   palette = 0=#000000
//   cursor-color = 7c6aef
//   selection-background = 7c6aef40
//   selection-foreground = ffffff

function ghosttyColor(raw: string, preserveAlpha = false): string {
  const s = raw.trim().replace(/^#/, '')
  if (/^[0-9a-f]{6}$/i.test(s)) return `#${s}`
  if (/^[0-9a-f]{3}$/i.test(s)) {
    const [r, g, b] = s
    return `#${r}${r}${g}${g}${b}${b}`
  }
  if (/^[0-9a-f]{8}$/i.test(s)) return preserveAlpha ? `#${s}` : `#${s.slice(0, 6)}`
  return `#${s.slice(0, 6)}`
}

export function parseGhosttyTheme(text: string, themeName: string): ImportResult {
  const palette = [...DEFAULT_PALETTE]
  let background = '#1e1e1e'
  let foreground = '#d4d4d4'
  let cursorColor = '#d4d4d4'
  let selectionBackground = '#264f78'
  let selectionForeground = '#ffffff'
  let foundAny = false

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const eqIdx = line.indexOf('=')
    if (eqIdx === -1) continue

    const key = line.slice(0, eqIdx).trim().toLowerCase()
    const val = line.slice(eqIdx + 1).trim()

    if (key === 'background') { background = ghosttyColor(val); foundAny = true }
    else if (key === 'foreground') { foreground = ghosttyColor(val); foundAny = true }
    else if (key === 'cursor-color') { cursorColor = ghosttyColor(val) }
    else if (key === 'cursor-text') { /* ignored */ }
    else if (key === 'selection-background') { selectionBackground = ghosttyColor(val, true) }
    else if (key === 'selection-foreground') { selectionForeground = ghosttyColor(val) }
    else if (key === 'palette') {
      // palette = N=#rrggbb
      const match = /^(\d+)\s*=\s*(.+)$/.exec(val)
      if (match) {
        const idx = Number(match[1])
        if (idx >= 0 && idx <= 15) {
          palette[idx] = ghosttyColor(match[2])
          foundAny = true
        }
      }
    }
  }

  if (!foundAny) {
    return { ok: false, error: '未识别为 Ghostty 主题格式，请确认文件内容包含 background / palette 等配置项。' }
  }

  return {
    ok: true,
    theme: {
      name: themeName,
      palette,
      background,
      foreground,
      cursorColor,
      cursorText: background,
      selectionBackground,
      selectionForeground,
    },
  }
}

// ─── Auto-detect format and parse ───────────────────────────────────────────

export function parseThemeAuto(content: string, themeName: string): ImportResult {
  const trimmed = content.trim()
  // VSCode themes always start with { (JSON object)
  if (trimmed.startsWith('{')) {
    return parseVSCodeTheme(content, themeName)
  }
  return parseGhosttyTheme(content, themeName)
}
