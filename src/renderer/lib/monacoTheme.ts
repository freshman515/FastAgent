import * as monaco from 'monaco-editor'
import { getXtermTheme, isTerminalThemeDark, defaultDarkTheme } from '@/lib/ghosttyTheme'

export const MONACO_THEME_NAME = 'fastagents-theme'

export function defineMonacoTheme(terminalThemeName: string): void {
  const xtermTheme = getXtermTheme(terminalThemeName) ?? defaultDarkTheme
  const isDark = isTerminalThemeDark(terminalThemeName)
  const selectionBackground = ensureAlpha(xtermTheme.selectionBackground, '66')
  const inactiveSelectionBackground = withAlpha(selectionBackground, '3d')
  const selectionHighlightBackground = withAlpha(selectionBackground, '28')
  const widgetBackground = isDark
    ? mixHex(xtermTheme.background, xtermTheme.brightBlack, 0.4)
    : mixHex(xtermTheme.background, xtermTheme.black, 0.06)
  const widgetBorder = isDark
    ? mixHex(xtermTheme.background, xtermTheme.foreground, 0.14)
    : mixHex(xtermTheme.background, xtermTheme.foreground, 0.11)
  const listSelectionBackground = withAlpha(xtermTheme.blue, isDark ? '40' : '26')
  const listHoverBackground = withAlpha(xtermTheme.blue, isDark ? '24' : '18')
  const suggestHighlightForeground = isDark ? xtermTheme.brightBlue : xtermTheme.blue
  const classForeground = isDark ? xtermTheme.brightCyan : mixHex(xtermTheme.cyan, '#000000', 0.24)
  const interfaceForeground = isDark ? xtermTheme.brightGreen : mixHex(xtermTheme.green, '#000000', 0.26)
  const structForeground = isDark ? xtermTheme.cyan : mixHex(xtermTheme.cyan, '#000000', 0.12)
  const enumForeground = isDark ? xtermTheme.brightYellow : mixHex(xtermTheme.yellow, '#000000', 0.35)
  const recordForeground = isDark ? xtermTheme.brightMagenta : mixHex(xtermTheme.magenta, '#000000', 0.14)
  const typeForeground = classForeground
  const functionForeground = isDark ? xtermTheme.blue : mixHex(xtermTheme.blue, '#000000', 0.22)
  const propertyForeground = isDark ? xtermTheme.brightBlue : mixHex(xtermTheme.blue, '#000000', 0.08)
  const fieldForeground = isDark
    ? mixHex(xtermTheme.foreground, xtermTheme.magenta, 0.45)
    : mixHex(xtermTheme.foreground, xtermTheme.magenta, 0.38)
  const attributeForeground = isDark ? xtermTheme.yellow : mixHex(xtermTheme.yellow, '#000000', 0.28)
  const directiveForeground = isDark ? xtermTheme.magenta : mixHex(xtermTheme.magenta, '#000000', 0.18)

  monaco.editor.defineTheme(MONACO_THEME_NAME, {
    base: isDark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      // Basic tokens
      { token: 'comment', foreground: xtermTheme.brightBlack.replace('#', ''), fontStyle: 'italic' },
      { token: 'directive', foreground: directiveForeground.replace('#', '') },
      { token: 'directive.csx', foreground: directiveForeground.replace('#', '') },
      { token: 'keyword', foreground: xtermTheme.magenta.replace('#', '') },
      { token: 'keyword.bool', foreground: typeForeground.replace('#', '') },
      { token: 'keyword.byte', foreground: typeForeground.replace('#', '') },
      { token: 'keyword.char', foreground: typeForeground.replace('#', '') },
      { token: 'keyword.decimal', foreground: typeForeground.replace('#', '') },
      { token: 'keyword.double', foreground: typeForeground.replace('#', '') },
      { token: 'keyword.dynamic', foreground: typeForeground.replace('#', '') },
      { token: 'keyword.float', foreground: typeForeground.replace('#', '') },
      { token: 'keyword.int', foreground: typeForeground.replace('#', '') },
      { token: 'keyword.long', foreground: typeForeground.replace('#', '') },
      { token: 'keyword.object', foreground: typeForeground.replace('#', '') },
      { token: 'keyword.sbyte', foreground: typeForeground.replace('#', '') },
      { token: 'keyword.short', foreground: typeForeground.replace('#', '') },
      { token: 'keyword.string', foreground: typeForeground.replace('#', '') },
      { token: 'keyword.uint', foreground: typeForeground.replace('#', '') },
      { token: 'keyword.ulong', foreground: typeForeground.replace('#', '') },
      { token: 'keyword.ushort', foreground: typeForeground.replace('#', '') },
      { token: 'keyword.var', foreground: typeForeground.replace('#', '') },
      { token: 'keyword.void', foreground: typeForeground.replace('#', '') },
      { token: 'string', foreground: xtermTheme.green.replace('#', '') },
      { token: 'string.escape', foreground: xtermTheme.brightYellow.replace('#', '') },
      { token: 'string.quote', foreground: xtermTheme.green.replace('#', '') },
      { token: 'number', foreground: xtermTheme.yellow.replace('#', '') },
      { token: 'type', foreground: xtermTheme.cyan.replace('#', '') },
      { token: 'type.identifier', foreground: typeForeground.replace('#', '') },
      { token: 'class.name', foreground: classForeground.replace('#', '') },
      { token: 'interface.name', foreground: interfaceForeground.replace('#', '') },
      { token: 'struct.name', foreground: structForeground.replace('#', '') },
      { token: 'enum.name', foreground: enumForeground.replace('#', '') },
      { token: 'record.name', foreground: recordForeground.replace('#', '') },
      { token: 'constructor.name', foreground: classForeground.replace('#', '') },
      { token: 'function', foreground: functionForeground.replace('#', '') },
      { token: 'property.name', foreground: propertyForeground.replace('#', '') },
      { token: 'field.name', foreground: fieldForeground.replace('#', '') },
      { token: 'variable', foreground: xtermTheme.foreground.replace('#', '') },
      { token: 'identifier', foreground: xtermTheme.foreground.replace('#', '') },
      { token: 'constant', foreground: xtermTheme.brightYellow.replace('#', '') },
      { token: 'operator', foreground: xtermTheme.red.replace('#', '') },
      { token: 'attribute.name', foreground: attributeForeground.replace('#', '') },
      { token: 'namespace', foreground: typeForeground.replace('#', '') },
      { token: 'namespace.cpp', foreground: directiveForeground.replace('#', '') },
      // TextMate tokens
      { token: 'keyword.control', foreground: xtermTheme.magenta.replace('#', '') },
      { token: 'keyword.operator', foreground: xtermTheme.magenta.replace('#', '') },
      { token: 'storage.type', foreground: xtermTheme.magenta.replace('#', '') },
      { token: 'storage.modifier', foreground: xtermTheme.magenta.replace('#', '') },
      { token: 'entity.name.function', foreground: xtermTheme.blue.replace('#', '') },
      { token: 'entity.name.type', foreground: xtermTheme.cyan.replace('#', '') },
      { token: 'entity.name.tag', foreground: xtermTheme.red.replace('#', '') },
      { token: 'entity.other.attribute-name', foreground: xtermTheme.yellow.replace('#', '') },
      { token: 'variable.other', foreground: xtermTheme.foreground.replace('#', '') },
      { token: 'variable.parameter', foreground: xtermTheme.red.replace('#', '') },
      { token: 'support.function', foreground: xtermTheme.blue.replace('#', '') },
      { token: 'support.type', foreground: xtermTheme.cyan.replace('#', '') },
      { token: 'constant.language', foreground: xtermTheme.brightYellow.replace('#', '') },
      { token: 'constant.numeric', foreground: xtermTheme.yellow.replace('#', '') },
      { token: 'punctuation', foreground: xtermTheme.foreground.replace('#', '') },
      { token: 'punctuation.definition.tag', foreground: xtermTheme.brightBlack.replace('#', '') },
      { token: 'meta.brace', foreground: xtermTheme.foreground.replace('#', '') },
    ],
    colors: {
      'editor.background': xtermTheme.background,
      'editor.foreground': xtermTheme.foreground,
      'editor.selectionBackground': selectionBackground,
      'editor.inactiveSelectionBackground': inactiveSelectionBackground,
      'editor.lineHighlightBackground': isDark
        ? `${xtermTheme.brightBlack}30`
        : `${xtermTheme.black}10`,
      'editor.selectionHighlightBackground': selectionHighlightBackground,
      'editorCursor.foreground': xtermTheme.cursor,
      'editorLineNumber.foreground': xtermTheme.brightBlack,
      'editorLineNumber.activeForeground': xtermTheme.foreground,
      'editorIndentGuide.background1': isDark
        ? `${xtermTheme.brightBlack}40`
        : `${xtermTheme.black}20`,
      'editorIndentGuide.activeBackground1': isDark
        ? `${xtermTheme.brightBlack}80`
        : `${xtermTheme.black}40`,
      'editorBracketMatch.background': `${xtermTheme.blue}25`,
      'editorBracketMatch.border': `${xtermTheme.blue}60`,
      'scrollbarSlider.background': `${xtermTheme.brightBlack}4d`,
      'scrollbarSlider.hoverBackground': `${xtermTheme.brightBlack}66`,
      'scrollbarSlider.activeBackground': `${xtermTheme.brightBlack}80`,
      'editorWidget.background': widgetBackground,
      'editorWidget.foreground': xtermTheme.foreground,
      'editorWidget.border': widgetBorder,
      'editorSuggestWidget.background': widgetBackground,
      'editorSuggestWidget.foreground': xtermTheme.foreground,
      'editorSuggestWidget.border': widgetBorder,
      'editorSuggestWidget.selectedBackground': listSelectionBackground,
      'editorSuggestWidget.selectedForeground': xtermTheme.foreground,
      'editorSuggestWidget.highlightForeground': suggestHighlightForeground,
      'editorSuggestWidget.focusHighlightForeground': suggestHighlightForeground,
      'list.hoverBackground': listHoverBackground,
      'list.hoverForeground': xtermTheme.foreground,
      'list.focusBackground': listSelectionBackground,
      'list.focusForeground': xtermTheme.foreground,
      'list.activeSelectionBackground': listSelectionBackground,
      'list.activeSelectionForeground': xtermTheme.foreground,
      'list.inactiveSelectionBackground': listHoverBackground,
      'list.inactiveSelectionForeground': xtermTheme.foreground,
      'editorGutter.background': xtermTheme.background,
      'minimap.background': xtermTheme.background,
      'diffEditor.insertedTextBackground': `${xtermTheme.green}18`,
      'diffEditor.removedTextBackground': `${xtermTheme.red}18`,
    },
  })
  monaco.editor.setTheme(MONACO_THEME_NAME)
}

function normalizeHexColor(color: string): string | null {
  const c = color.trim()
  const hex8 = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(c)
  if (hex8) return `#${hex8[1]}${hex8[2]}${hex8[3]}${hex8[4]}`

  const hex6 = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(c)
  if (hex6) return `#${hex6[1]}${hex6[2]}${hex6[3]}`

  const hex3 = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(c)
  if (hex3) return `#${hex3[1]}${hex3[1]}${hex3[2]}${hex3[2]}${hex3[3]}${hex3[3]}`

  return null
}

function ensureAlpha(color: string, fallbackAlpha: string): string {
  const normalized = normalizeHexColor(color)
  if (!normalized) return color
  return normalized.length === 9 ? normalized : `${normalized}${fallbackAlpha}`
}

function withAlpha(color: string, alpha: string): string {
  const normalized = normalizeHexColor(color)
  if (!normalized) return color
  return `${normalized.slice(0, 7)}${alpha}`
}

function mixHex(color1: string, color2: string, weight: number): string {
  const c1 = hexToRgb(color1)
  const c2 = hexToRgb(color2)
  if (!c1 || !c2) return color1
  const w = Math.max(0, Math.min(1, weight))
  const r = Math.round(c1.r * (1 - w) + c2.r * w)
  const g = Math.round(c1.g * (1 - w) + c2.g * w)
  const b = Math.round(c1.b * (1 - w) + c2.b * w)
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})/i.exec(hex.trim())
  return result
    ? {
        r: Number.parseInt(result[1], 16),
        g: Number.parseInt(result[2], 16),
        b: Number.parseInt(result[3], 16),
      }
    : null
}
