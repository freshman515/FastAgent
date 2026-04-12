// Ghostty theme utilities - uses pre-generated themes JSON

import terminalThemes from '@/data/terminal-themes.json'

// ─── Explicit UI color overrides per theme area ────────────────────────────

export interface ThemeUI {
  titleBarBg: string   // 标题栏背景
  panelBg: string      // 侧边栏/面板背景
  contentBg: string    // 主内容区背景（编辑器底色）
  textPrimary: string
  textSecondary: string
  textTertiary: string
  border: string
  borderHover: string
  accent: string
  accentHover: string
  success: string
  warning: string
  error: string
}

export interface GhosttyTheme {
  name: string
  palette: string[] // 16 colors (0-15)
  background: string
  foreground: string
  cursorColor: string
  cursorText: string
  selectionBackground: string
  selectionForeground: string
  /** Explicitly declares whether this is a dark theme. When present, takes priority over luminance detection. */
  dark?: boolean
  /** Explicit per-area UI colors; when present, used directly instead of being derived */
  ui?: ThemeUI
}

export interface XtermTheme {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  selectionForeground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

const builtinThemes = terminalThemes as Record<string, GhosttyTheme>

// Runtime registry for user-created custom themes
const customThemeRegistry = new Map<string, GhosttyTheme>()

export function registerCustomThemes(themes: Record<string, GhosttyTheme>): void {
  customThemeRegistry.clear()
  for (const [name, theme] of Object.entries(themes)) {
    customThemeRegistry.set(name, theme)
  }
}

export function getThemeNames(): string[] {
  const custom = [...customThemeRegistry.keys()].sort((a, b) => a.localeCompare(b))
  const builtin = Object.keys(builtinThemes).sort((a, b) => a.localeCompare(b))
  return [...custom, ...builtin]
}

export function getAllCustomThemeNames(): string[] {
  return [...customThemeRegistry.keys()].sort((a, b) => a.localeCompare(b))
}

export function getTheme(name: string): GhosttyTheme | undefined {
  return customThemeRegistry.get(name) ?? builtinThemes[name]
}

export function ghosttyToXterm(theme: GhosttyTheme): XtermTheme {
  return {
    background: theme.background,
    foreground: theme.foreground,
    cursor: theme.cursorColor,
    cursorAccent: theme.cursorText,
    selectionBackground: theme.selectionBackground,
    selectionForeground: theme.selectionForeground,
    black: theme.palette[0],
    red: theme.palette[1],
    green: theme.palette[2],
    yellow: theme.palette[3],
    blue: theme.palette[4],
    magenta: theme.palette[5],
    cyan: theme.palette[6],
    white: theme.palette[7],
    brightBlack: theme.palette[8],
    brightRed: theme.palette[9],
    brightGreen: theme.palette[10],
    brightYellow: theme.palette[11],
    brightBlue: theme.palette[12],
    brightMagenta: theme.palette[13],
    brightCyan: theme.palette[14],
    brightWhite: theme.palette[15],
  }
}

export function getXtermTheme(name: string): XtermTheme | undefined {
  const theme = getTheme(name)
  return theme ? ghosttyToXterm(theme) : undefined
}

export const defaultDarkTheme: XtermTheme = {
  background: '#1a1a1e',
  foreground: '#e8e8ec',
  cursor: '#7c6aef',
  cursorAccent: '#1a1a1e',
  selectionBackground: '#7c6aef40',
  selectionForeground: '#ffffff',
  black: '#000000',
  red: '#ef5757',
  green: '#3ecf7b',
  yellow: '#f0a23b',
  blue: '#5fa0f5',
  magenta: '#c084fc',
  cyan: '#45c8c8',
  white: '#e8e8ec',
  brightBlack: '#5e5e66',
  brightRed: '#f47070',
  brightGreen: '#5ddfa0',
  brightYellow: '#f5c070',
  brightBlue: '#7c6aef',
  brightMagenta: '#d4a0ff',
  brightCyan: '#6adada',
  brightWhite: '#ffffff',
}

interface RGBA {
  r: number
  g: number
  b: number
  a: number
}

function parseColorWithAlpha(color: string): RGBA | null {
  const c = color.trim()
  if (c === 'transparent') return null

  const hex6 = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(c)
  if (hex6) {
    return {
      r: Number.parseInt(hex6[1], 16),
      g: Number.parseInt(hex6[2], 16),
      b: Number.parseInt(hex6[3], 16),
      a: 1,
    }
  }

  const hex3 = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(c)
  if (hex3) {
    return {
      r: Number.parseInt(hex3[1] + hex3[1], 16),
      g: Number.parseInt(hex3[2] + hex3[2], 16),
      b: Number.parseInt(hex3[3] + hex3[3], 16),
      a: 1,
    }
  }

  const hex8 = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(c)
  if (hex8) {
    return {
      r: Number.parseInt(hex8[1], 16),
      g: Number.parseInt(hex8[2], 16),
      b: Number.parseInt(hex8[3], 16),
      a: Number.parseInt(hex8[4], 16) / 255,
    }
  }

  const rgbaMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/.exec(c)
  if (rgbaMatch) {
    return {
      r: Number.parseInt(rgbaMatch[1], 10),
      g: Number.parseInt(rgbaMatch[2], 10),
      b: Number.parseInt(rgbaMatch[3], 10),
      a: rgbaMatch[4] ? Number.parseFloat(rgbaMatch[4]) : 1,
    }
  }

  return null
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const rgba = parseColorWithAlpha(hex)
  return rgba ? { r: rgba.r, g: rgba.g, b: rgba.b } : null
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`
}

function mixColors(color1: string, color2: string, weight: number): string {
  const c1 = hexToRgb(color1)
  const c2 = hexToRgb(color2)
  if (!c1 || !c2) return color1
  const w = Math.max(0, Math.min(1, weight))
  return rgbToHex(
    c1.r * (1 - w) + c2.r * w,
    c1.g * (1 - w) + c2.g * w,
    c1.b * (1 - w) + c2.b * w,
  )
}

export function hexToRgba(color: string, opacity: number): string {
  const rgba = parseColorWithAlpha(color)
  if (!rgba) return color
  const newAlpha = Math.max(0, Math.min(1, opacity / 100))
  const finalAlpha = rgba.a * newAlpha
  return `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${finalAlpha})`
}

function getLuminance(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function isTerminalThemeDark(themeName: string): boolean {
  const theme = getTheme(themeName)
  if (!theme) return true
  if (theme.dark !== undefined) return theme.dark
  return getLuminance(ghosttyToXterm(theme).background) < 0.5
}

export function applyTerminalThemeToApp(themeName: string): void {
  const ghosttyTheme = getTheme(themeName)
  const xterm = ghosttyTheme ? ghosttyToXterm(ghosttyTheme) : defaultDarkTheme
  const root = document.documentElement
  const isDark = ghosttyTheme?.dark !== undefined
    ? ghosttyTheme.dark
    : getLuminance(xterm.background) < 0.5

  root.classList.toggle('theme-dark', isDark)
  root.classList.toggle('theme-light', !isDark)

  // Always sync terminal bg — used by tabs and other elements that must match the terminal
  root.style.setProperty('--color-terminal-bg', xterm.background)

  if (ghosttyTheme?.ui) {
    // Use explicit per-area colors defined in the theme
    const ui = ghosttyTheme.ui
    root.style.setProperty('--color-titlebar-bg', ui.titleBarBg)
    root.style.setProperty('--color-bg-primary', ui.contentBg)
    root.style.setProperty('--color-bg-secondary', ui.panelBg)
    root.style.setProperty('--color-bg-tertiary', mixColors(ui.panelBg, ui.border, 0.5))
    root.style.setProperty('--color-bg-surface', mixColors(ui.panelBg, ui.border, 0.85))
    root.style.setProperty('--color-text-primary', ui.textPrimary)
    root.style.setProperty('--color-text-secondary', ui.textSecondary)
    root.style.setProperty('--color-text-tertiary', ui.textTertiary)
    root.style.setProperty('--color-border', ui.border)
    root.style.setProperty('--color-border-hover', ui.borderHover)
    root.style.setProperty('--color-accent', ui.accent)
    root.style.setProperty('--color-accent-hover', ui.accentHover)
    root.style.setProperty('--color-accent-muted', hexToRgba(ui.accent, 15))
    root.style.setProperty('--color-success', ui.success)
    root.style.setProperty('--color-warning', ui.warning)
    root.style.setProperty('--color-error', ui.error)
    root.style.setProperty('--color-info', xterm.blue)
  } else {
    // Fallback: derive from terminal palette (for imported/legacy themes without ui)
    const titleBarBg = isDark
      ? mixColors(xterm.background, xterm.brightBlack, 0.25)
      : mixColors(xterm.background, xterm.black, 0.05)
    root.style.setProperty('--color-titlebar-bg', titleBarBg)
    root.style.setProperty('--color-bg-primary', xterm.background)
    root.style.setProperty('--color-bg-secondary', isDark
      ? mixColors(xterm.background, xterm.brightBlack, 0.4)
      : mixColors(xterm.background, xterm.black, 0.06))
    root.style.setProperty('--color-bg-tertiary', isDark
      ? mixColors(xterm.background, xterm.brightBlack, 0.55)
      : mixColors(xterm.background, xterm.black, 0.09))
    root.style.setProperty('--color-bg-surface', isDark
      ? mixColors(xterm.background, xterm.brightBlack, 0.7)
      : mixColors(xterm.background, xterm.black, 0.13))
    root.style.setProperty('--color-text-primary', xterm.foreground)
    root.style.setProperty('--color-text-secondary', isDark
      ? mixColors(xterm.foreground, xterm.background, 0.45)
      : mixColors(xterm.foreground, xterm.background, 0.35))
    root.style.setProperty('--color-text-tertiary', isDark
      ? mixColors(xterm.foreground, xterm.background, 0.65)
      : mixColors(xterm.foreground, xterm.background, 0.55))
    const borderColor = isDark
      ? mixColors(xterm.background, xterm.foreground, 0.14)
      : mixColors(xterm.background, xterm.foreground, 0.11)
    root.style.setProperty('--color-border', borderColor)
    root.style.setProperty('--color-border-hover', isDark
      ? mixColors(xterm.background, xterm.foreground, 0.25)
      : mixColors(xterm.background, xterm.foreground, 0.2))
    const accentBase = isDark ? xterm.brightBlue : xterm.blue
    root.style.setProperty('--color-accent', accentBase)
    root.style.setProperty('--color-accent-hover', isDark ? xterm.blue : mixColors(xterm.blue, '#000000', 0.1))
    root.style.setProperty('--color-accent-muted', hexToRgba(accentBase, 15))
    root.style.setProperty('--color-success', xterm.green)
    root.style.setProperty('--color-warning', xterm.yellow)
    root.style.setProperty('--color-error', xterm.red)
    root.style.setProperty('--color-info', xterm.blue)
  }
}

export function clearTerminalThemeFromApp(): void {
  const root = document.documentElement
  root.classList.remove('theme-dark', 'theme-light')
  const vars = [
    '--color-titlebar-bg',
    '--color-terminal-bg',
    '--color-bg-primary', '--color-bg-secondary', '--color-bg-tertiary', '--color-bg-surface',
    '--color-text-primary', '--color-text-secondary', '--color-text-tertiary',
    '--color-border', '--color-border-hover',
    '--color-accent', '--color-accent-hover', '--color-accent-muted',
    '--color-success', '--color-warning', '--color-error', '--color-info',
  ]
  for (const v of vars) root.style.removeProperty(v)
}
