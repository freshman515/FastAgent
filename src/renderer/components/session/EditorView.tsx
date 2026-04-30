import { type MutableRefObject, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import * as monaco from 'monaco-editor'
import { Code2, Columns2, Eye } from 'lucide-react'
import { type EditorCursorInfo, useEditorsStore } from '@/stores/editors'
import { useSessionsStore } from '@/stores/sessions'
import { useProjectsStore } from '@/stores/projects'
import { usePanesStore } from '@/stores/panes'
import { useProjectSearchStore } from '@/stores/search'
import { useUIStore } from '@/stores/ui'
import { useWorktreesStore } from '@/stores/worktrees'
import { defineMonacoTheme, MONACO_THEME_NAME } from '@/lib/monacoTheme'
import { registerEnhancedCSharpLanguage } from '@/lib/csharpLanguage'
import { renderMarkdown } from '@/lib/markdown'

// Configure Monaco workers for Vite
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new Worker(new URL('monaco-editor/esm/vs/language/json/json.worker.js', import.meta.url), { type: 'module' })
    if (label === 'css' || label === 'scss' || label === 'less') return new Worker(new URL('monaco-editor/esm/vs/language/css/css.worker.js', import.meta.url), { type: 'module' })
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new Worker(new URL('monaco-editor/esm/vs/language/html/html.worker.js', import.meta.url), { type: 'module' })
    if (label === 'typescript' || label === 'javascript') return new Worker(new URL('monaco-editor/esm/vs/language/typescript/ts.worker.js', import.meta.url), { type: 'module' })
    return new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url), { type: 'module' })
  },
}

// Define theme once per terminal theme name
let lastAppliedTheme = ''
function ensureTheme(terminalThemeName: string): void {
  registerEnhancedCSharpLanguage()
  if (lastAppliedTheme === terminalThemeName) return
  lastAppliedTheme = terminalThemeName
  defineMonacoTheme(terminalThemeName)
}

const BASE_EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  theme: MONACO_THEME_NAME,
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  cursorBlinking: 'smooth',
  cursorSmoothCaretAnimation: 'on',
  bracketPairColorization: { enabled: false },
  guides: { bracketPairs: false, indentation: true },
  renderLineHighlight: 'all',
  automaticLayout: true,
  padding: { top: 12, bottom: 12 },
  roundedSelection: true,
  tabSize: 2,
  contextmenu: false,
}

interface EditorDisplaySettings {
  fontFamily: string
  fontSize: number
  wordWrap: boolean
  minimap: boolean
  lineNumbers: boolean
  stickyScroll: boolean
  fontLigatures: boolean
}

type MarkdownEditorMode = 'source' | 'preview' | 'split'
type PreviewTextPoint = {
  node: Text
  offset: number
}
type PreviewTextIndexEntry = PreviewTextPoint | null

const MARKDOWN_PREVIEW_SELECTION_OVERLAY = 'markdown-preview-selection-overlay'

function buildEditorOptions(settings: EditorDisplaySettings): monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    ...BASE_EDITOR_OPTIONS,
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    fontLigatures: settings.fontLigatures,
    minimap: { enabled: settings.minimap, scale: 1, showSlider: 'mouseover' },
    lineNumbers: settings.lineNumbers ? 'on' : 'off',
    wordWrap: settings.wordWrap ? 'on' : 'off',
    stickyScroll: { enabled: settings.stickyScroll },
  }
}

function updateEditorOptions(
  editor: monaco.editor.IStandaloneCodeEditor | monaco.editor.IStandaloneDiffEditor,
  options: monaco.editor.IStandaloneEditorConstructionOptions,
): void {
  if ('getModifiedEditor' in editor) {
    editor.updateOptions(options as monaco.editor.IDiffEditorConstructionOptions)
    editor.getOriginalEditor().updateOptions(options)
    editor.getModifiedEditor().updateOptions(options)
    return
  }
  editor.updateOptions(options)
}

// Store pending send text for the session picker
let pendingSendText: string | null = null
let pendingSendCallback: ((sessionId: string) => void) | null = null

export function getPendingSend(): { text: string; callback: (sessionId: string) => void } | null {
  if (!pendingSendText || !pendingSendCallback) return null
  return { text: pendingSendText, callback: pendingSendCallback }
}

export function clearPendingSend(): void {
  pendingSendText = null
  pendingSendCallback = null
}

function buildSelectionInfo(
  selection: monaco.Selection | null,
  model: monaco.editor.ITextModel | null,
): EditorCursorInfo['selection'] {
  if (!selection || !model || selection.isEmpty()) return null
  const text = model.getValueInRange(selection)
  return {
    lines: selection.endLineNumber - selection.startLineNumber + 1,
    chars: text.length,
    startLine: selection.startLineNumber,
    startColumn: selection.startColumn,
    endLine: selection.endLineNumber,
    endColumn: selection.endColumn,
    isEmpty: false,
    text,
  }
}

function buildSelectionsInfo(
  selections: monaco.Selection[] | null,
  model: monaco.editor.ITextModel | null,
): NonNullable<EditorCursorInfo['selections']> {
  if (!selections || !model) return []
  return selections
    .map((selection) => buildSelectionInfo(selection, model))
    .filter((selection): selection is NonNullable<EditorCursorInfo['selection']> => selection !== null)
}

function buildSelectionPrompt(
  tab: { filePath: string; language: string },
  selection: NonNullable<ReturnType<typeof buildSelectionInfo>>,
): string {
  return [
    `请帮我修改这个文件中的一段已选代码。`,
    '',
    `文件: ${tab.filePath}`,
    `语言: ${tab.language}`,
    `选区: L${selection.startLine}:C${selection.startColumn} - L${selection.endLine}:C${selection.endColumn}`,
    '',
    '要求:',
    '1. 只针对这段选中代码给出修改建议或修改结果。',
    '2. 不要假设可以改动选区之外的代码。',
    '3. 如果必须改动选区外代码，请先明确说明原因和范围。',
    '4. 返回结果时，优先给出这段选区的替换内容，而不是整文件重写。',
    '',
    `\`\`\`${tab.language}`,
    selection.text,
    '```',
  ].join('\n')
}

function buildSelectedLineRange(
  selection: monaco.Selection | null,
  model: monaco.editor.ITextModel | null,
  position?: monaco.Position | null,
): { startLine: number; endLine: number } | null {
  if (!model) return null
  if (!selection || selection.isEmpty()) {
    const line = position?.lineNumber
    return line ? { startLine: line, endLine: line } : null
  }

  const start = selection.getStartPosition()
  const end = selection.getEndPosition()
  let endLine = end.lineNumber
  const text = model.getValueInRange(selection)

  if (end.column === 1 && endLine > start.lineNumber && (text.endsWith(model.getEOL()) || text.endsWith('\n'))) {
    endLine -= 1
  }

  return {
    startLine: start.lineNumber,
    endLine: Math.max(start.lineNumber, endLine),
  }
}

function formatDetailedCodePath(filePath: string, range: { startLine: number; endLine: number }): string {
  if (range.startLine === range.endLine) return `${filePath}:L${range.startLine}`
  return `${filePath}:L${range.startLine}-L${range.endLine}`
}

function normalizeEditorFilePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function normalizePreviewSearchText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function stripMarkdownSelectionSyntax(text: string): string {
  return text
    .replace(/^```[^\n]*\n?/gm, '')
    .replace(/^```\s*$/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~|]/g, ' ')
}

function getRenderedMarkdownText(markdown: string): string {
  const container = document.createElement('div')
  container.innerHTML = renderMarkdown(markdown)
  return container.textContent ?? ''
}

function getMarkdownSelectionNeedles(selectionText: string): string[] {
  const candidates = [
    getRenderedMarkdownText(selectionText),
    stripMarkdownSelectionSyntax(selectionText),
    selectionText,
  ]

  return Array.from(new Set(
    candidates
      .map(normalizePreviewSearchText)
      .filter((candidate) => candidate.length >= 2),
  )).sort((a, b) => b.length - a.length)
}

function clearMarkdownPreviewSelection(container: HTMLElement): void {
  container.querySelector(`.${MARKDOWN_PREVIEW_SELECTION_OVERLAY}`)?.remove()
}

function buildMarkdownPreviewTextIndex(container: HTMLElement): { text: string; map: PreviewTextIndexEntry[] } {
  const map: PreviewTextIndexEntry[] = []
  let text = ''

  const appendSpace = (): void => {
    if (!text || text.endsWith(' ')) return
    text += ' '
    map.push(null)
  }

  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const element = node.parentElement
        if (
          !element
          || element.closest(`script,style,.${MARKDOWN_PREVIEW_SELECTION_OVERLAY}`)
        ) {
          return NodeFilter.FILTER_REJECT
        }
        return NodeFilter.FILTER_ACCEPT
      },
    },
  )

  let node = walker.nextNode() as Text | null
  while (node) {
    const value = node.data
    for (let index = 0; index < value.length; index += 1) {
      if (/\s/.test(value[index])) {
        appendSpace()
      } else {
        text += value[index]
        map.push({ node, offset: index })
      }
    }
    appendSpace()
    node = walker.nextNode() as Text | null
  }

  while (text.endsWith(' ')) {
    text = text.slice(0, -1)
    map.pop()
  }

  return { text, map }
}

function getPreviewTextPoint(
  map: PreviewTextIndexEntry[],
  startIndex: number,
  endIndex: number,
  direction: 1 | -1,
): PreviewTextPoint | null {
  for (let index = startIndex; direction > 0 ? index <= endIndex : index >= endIndex; index += direction) {
    const point = map[index]
    if (point) return point
  }
  return null
}

function highlightMarkdownPreviewSelection(container: HTMLElement, selectionText: string): void {
  clearMarkdownPreviewSelection(container)
  const needles = getMarkdownSelectionNeedles(selectionText)
  if (needles.length === 0) return

  const { text, map } = buildMarkdownPreviewTextIndex(container)
  const normalizedText = text.toLowerCase()
  const match = needles
    .map((needle) => ({ index: normalizedText.indexOf(needle.toLowerCase()), length: needle.length }))
    .find((candidate) => candidate.index >= 0)
  if (!match) return

  const startPoint = getPreviewTextPoint(map, match.index, match.index + match.length - 1, 1)
  const endPoint = getPreviewTextPoint(map, match.index + match.length - 1, match.index, -1)
  if (!startPoint || !endPoint) return

  const range = document.createRange()
  range.setStart(startPoint.node, startPoint.offset)
  range.setEnd(endPoint.node, endPoint.offset + 1)

  const containerRect = container.getBoundingClientRect()
  const overlay = document.createElement('div')
  overlay.className = MARKDOWN_PREVIEW_SELECTION_OVERLAY

  for (const rect of Array.from(range.getClientRects())) {
    if (rect.width < 1 || rect.height < 1) continue
    const highlight = document.createElement('span')
    highlight.className = 'markdown-preview-selection-highlight'
    highlight.style.left = `${rect.left - containerRect.left + container.scrollLeft}px`
    highlight.style.top = `${rect.top - containerRect.top + container.scrollTop}px`
    highlight.style.width = `${rect.width}px`
    highlight.style.height = `${rect.height}px`
    overlay.appendChild(highlight)
  }

  if (overlay.childElementCount > 0) container.appendChild(overlay)
  range.detach()
}

function getScrollableRatio(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight)
  return maxScrollTop <= 0 ? 0 : scrollTop / maxScrollTop
}

function getSelectionTextWithinElement(element: HTMLElement | null): string {
  if (!element) return ''
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return ''
  const text = selection.toString()
  if (!text) return ''
  return element.contains(selection.anchorNode) || element.contains(selection.focusNode) ? text : ''
}

type AddToast = ReturnType<typeof useUIStore.getState>['addToast']

function registerEditorContextActions(
  editor: monaco.editor.IStandaloneCodeEditor,
  targetRef: MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>,
  setContextMenu: (menu: { x: number; y: number } | null) => void,
): void {
  editor.onContextMenu((event) => {
    event.event.preventDefault()
    event.event.stopPropagation()
    targetRef.current = editor
    editor.focus()
    const selection = editor.getSelection()
    if ((!selection || selection.isEmpty()) && event.target.position) editor.setPosition(event.target.position)
    setContextMenu({ x: event.event.posx, y: event.event.posy })
  })
}

async function copyDetailedCodePath(
  editor: monaco.editor.IStandaloneCodeEditor,
  tab: { filePath: string },
  addToast: AddToast,
): Promise<void> {
  const range = buildSelectedLineRange(editor.getSelection(), editor.getModel(), editor.getPosition())
  if (!range) {
    addToast({ type: 'warning', title: '复制详细代码路径', body: '无法获取当前行' })
    return
  }

  const codePath = formatDetailedCodePath(tab.filePath, range)
  await navigator.clipboard.writeText(codePath)
  addToast({ type: 'success', title: '已复制代码路径', body: codePath })
}

function showSendPickerForSelection(
  editor: monaco.editor.IStandaloneCodeEditor,
  tab: { filePath: string; language: string },
  setSendPicker: (picker: { prompt: string; x: number; y: number } | null) => void,
): void {
  const selection = editor.getSelection()
  const selectionInfo = buildSelectionInfo(selection, editor.getModel())
  if (!selectionInfo) return

  const pos = editor.getScrolledVisiblePosition(selection!.getStartPosition())
  const domNode = editor.getDomNode()
  const rect = domNode?.getBoundingClientRect()
  setSendPicker({
    prompt: buildSelectionPrompt(tab, selectionInfo),
    x: (rect?.left ?? 0) + (pos?.left ?? 100),
    y: (rect?.top ?? 0) + (pos?.top ?? 100) + 20,
  })
}

function selectedTextOrCurrentLine(editor: monaco.editor.IStandaloneCodeEditor): string {
  const model = editor.getModel()
  if (!model) return ''

  const selection = editor.getSelection()
  if (selection && !selection.isEmpty()) return model.getValueInRange(selection)

  const line = editor.getPosition()?.lineNumber
  return line ? model.getLineContent(line) : ''
}

function getSelectedTextOrCurrentWord(editor: monaco.editor.IStandaloneCodeEditor): string {
  const model = editor.getModel()
  if (!model) return ''

  const selection = editor.getSelection()
  if (selection && !selection.isEmpty()) {
    return model.getValueInRange(selection).trim()
  }

  const position = editor.getPosition()
  if (!position) return ''
  return model.getWordAtPosition(position)?.word.trim() ?? ''
}

async function copyEditorText(editor: monaco.editor.IStandaloneCodeEditor): Promise<void> {
  const text = selectedTextOrCurrentLine(editor)
  if (text) await navigator.clipboard.writeText(text)
}

async function cutEditorText(editor: monaco.editor.IStandaloneCodeEditor): Promise<void> {
  const model = editor.getModel()
  if (!model) return

  const selection = editor.getSelection()
  if (selection && !selection.isEmpty()) {
    const text = model.getValueInRange(selection)
    if (text) await navigator.clipboard.writeText(text)
    editor.pushUndoStop()
    editor.executeEdits('fastagents-cut', [{ range: selection, text: '' }])
    editor.pushUndoStop()
    return
  }

  const line = editor.getPosition()?.lineNumber
  if (!line) return

  const lineCount = model.getLineCount()
  const range = line < lineCount
    ? new monaco.Range(line, 1, line + 1, 1)
    : new monaco.Range(line, 1, line, model.getLineMaxColumn(line))
  const text = model.getValueInRange(range)
  if (text) await navigator.clipboard.writeText(text)
  editor.pushUndoStop()
  editor.executeEdits('fastagents-cut-line', [{ range, text: '' }])
  editor.pushUndoStop()
}

async function pasteEditorText(editor: monaco.editor.IStandaloneCodeEditor): Promise<void> {
  const text = await navigator.clipboard.readText()
  if (!text) return

  const selections = editor.getSelections() ?? []
  if (selections.length === 0) {
    editor.trigger('fastagents-menu', 'type', { text })
    return
  }

  editor.pushUndoStop()
  editor.executeEdits('fastagents-paste', selections.map((selection) => ({ range: selection, text })))
  editor.pushUndoStop()
}

interface EditorMenuItemProps {
  label: string
  shortcut?: string
  disabled?: boolean
  onClick: () => void
}

function EditorMenuItem({ label, shortcut, disabled, onClick }: EditorMenuItemProps): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'group relative flex w-full items-center justify-between gap-8 overflow-hidden rounded-[var(--radius-sm)] px-3 py-1.5 text-left text-[12px] text-[var(--color-text-secondary)]',
        'transition-colors duration-100 hover:bg-[var(--color-accent)]/20 hover:text-[var(--color-text-primary)]',
        'focus-visible:bg-[var(--color-accent)]/20 focus-visible:text-[var(--color-text-primary)] focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-35',
      )}
    >
      <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r bg-[var(--color-accent)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      <span className="relative">{label}</span>
      {shortcut && (
        <span className="relative text-[11px] text-[var(--color-text-tertiary)] transition-colors group-hover:text-[var(--color-text-secondary)] group-focus-visible:text-[var(--color-text-secondary)]">
          {shortcut}
        </span>
      )}
    </button>
  )
}

function EditorMenuDivider(): JSX.Element {
  return <div className="my-1 h-px bg-[var(--color-border)]" />
}

interface EditorBinding {
  getContent: () => string
  applyGeneratedCode: (code: string, selection: EditorCursorInfo['selection']) => Promise<void>
}

const editorBindings = new Map<string, EditorBinding>()

export function getOpenEditorContent(editorTabId: string): string | null {
  return editorBindings.get(editorTabId)?.getContent() ?? null
}

export async function applyGeneratedCodeToEditor(
  editorTabId: string,
  code: string,
  selection: EditorCursorInfo['selection'],
): Promise<boolean> {
  const binding = editorBindings.get(editorTabId)
  if (!binding) return false
  await binding.applyGeneratedCode(code, selection)
  return true
}

interface EditorViewProps {
  editorTabId: string
  isActive: boolean
}

export function EditorView({ editorTabId, isActive }: EditorViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const markdownPreviewRef = useRef<HTMLDivElement>(null)
  const markdownScrollSyncRef = useRef<'source' | 'preview' | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | monaco.editor.IStandaloneDiffEditor | null>(null)
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive
  const tab = useEditorsStore((s) => s.tabs.find((t) => t.id === editorTabId))
  const setModified = useEditorsStore((s) => s.setModified)
  const setCursorInfo = useEditorsStore((s) => s.setCursorInfo)
  const setLastFocusedTabId = useEditorsStore((s) => s.setLastFocusedTabId)
  const navigationTarget = useEditorsStore((s) => s.navigationTargets[editorTabId] ?? null)
  const clearNavigationTarget = useEditorsStore((s) => s.clearNavigationTarget)
  const editorFontFamily = useUIStore((s) => s.settings.editorFontFamily)
  const editorFontSize = useUIStore((s) => s.settings.editorFontSize)
  const editorWordWrap = useUIStore((s) => s.settings.editorWordWrap)
  const editorMinimap = useUIStore((s) => s.settings.editorMinimap)
  const editorLineNumbers = useUIStore((s) => s.settings.editorLineNumbers)
  const editorStickyScroll = useUIStore((s) => s.settings.editorStickyScroll)
  const editorFontLigatures = useUIStore((s) => s.settings.editorFontLigatures)
  const terminalTheme = useUIStore((s) => s.settings.terminalTheme)
  const addToast = useUIStore((s) => s.addToast)
  const projectPath = useProjectsStore((s) => s.projects.find((p) => p.id === s.selectedProjectId)?.path ?? null)
  const selectedWorktreePath = useWorktreesStore((s) =>
    s.worktrees.find((worktree) => worktree.id === s.selectedWorktreeId)?.path ?? null,
  )
  const [sendPicker, setSendPicker] = useState<{ prompt: string; x: number; y: number } | null>(null)
  const contextMenuEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const [editorContextMenu, setEditorContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [markdownPreviewContextMenu, setMarkdownPreviewContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [markdownMode, setMarkdownMode] = useState<MarkdownEditorMode>('source')
  const [markdownSource, setMarkdownSource] = useState('')
  const [markdownSelectionText, setMarkdownSelectionText] = useState('')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const savedContentRef = useRef<string>('')
  const watchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const editorOptions = useMemo(
    () =>
      buildEditorOptions({
        fontFamily: editorFontFamily,
        fontSize: editorFontSize,
        wordWrap: editorWordWrap,
        minimap: editorMinimap,
        lineNumbers: editorLineNumbers,
        stickyScroll: editorStickyScroll,
        fontLigatures: editorFontLigatures,
      }),
    [editorFontFamily, editorFontLigatures, editorFontSize, editorLineNumbers, editorMinimap, editorStickyScroll, editorWordWrap],
  )
  const isMarkdownEditor = tab?.language === 'markdown' && !tab.isDiff
  const renderedMarkdown = useMemo(
    () => (isMarkdownEditor ? renderMarkdown(markdownSource) : ''),
    [isMarkdownEditor, markdownSource],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container || !tab) return

    let disposed = false
    let fileSavedListener: ((event: Event) => void) | null = null
    ensureTheme(useUIStore.getState().settings.terminalTheme)

    const persistEditorValue = async (nextContent: string): Promise<void> => {
      await window.api.fs.writeFile(tab.filePath, nextContent)
      savedContentRef.current = nextContent
      setModified(editorTabId, false)
      window.dispatchEvent(new CustomEvent('fastagents:file-saved', {
        detail: { filePath: tab.filePath },
      }))
    }

    const isCurrentTabFile = (filePath: string): boolean => (
      normalizeEditorFilePath(filePath) === normalizeEditorFilePath(tab.filePath)
    )

    if (tab.isDiff) {
      // ── Diff editor ──
      window.api.fs.readFile(tab.filePath).catch(() => '').then((modifiedContent) => {
        if (disposed) return
        const originalContent = tab.originalContent ?? ''
        const opts = buildEditorOptions({
          fontFamily: useUIStore.getState().settings.editorFontFamily,
          fontSize: useUIStore.getState().settings.editorFontSize,
          wordWrap: useUIStore.getState().settings.editorWordWrap,
          minimap: useUIStore.getState().settings.editorMinimap,
          lineNumbers: useUIStore.getState().settings.editorLineNumbers,
          stickyScroll: useUIStore.getState().settings.editorStickyScroll,
          fontLigatures: useUIStore.getState().settings.editorFontLigatures,
        })

        const diffEditor = monaco.editor.createDiffEditor(container, {
          ...opts,
          readOnly: false,
          renderSideBySide: true,
          enableSplitViewResizing: true,
        })

        const originalModel = monaco.editor.createModel(originalContent, tab.language)
        const modifiedModel = monaco.editor.createModel(modifiedContent, tab.language)
        diffEditor.setModel({ original: originalModel, modified: modifiedModel })

        editorRef.current = diffEditor

        // Track cursor on modified editor
        const modEditor = diffEditor.getModifiedEditor()
        savedContentRef.current = modifiedContent
        modEditor.onDidChangeCursorSelection((e) => {
          if (!isActiveRef.current) return
          const selection = e.selection
          const position = selection.getPosition()
          const model = modEditor.getModel()
          const selectionInfo = buildSelectionInfo(selection, model)
          const selections = buildSelectionsInfo(modEditor.getSelections(), model)
          setLastFocusedTabId(editorTabId)
          setCursorInfo({ line: position.lineNumber, column: position.column, selection: selectionInfo, selections })
          window.api.ide.selectionChanged({
            text: selectionInfo?.text ?? '',
            filePath: tab.filePath,
            fileUrl: `file://${tab.filePath.replace(/\\/g, '/')}`,
            fileName: tab.fileName,
            language: tab.language,
            cursorLine: position.lineNumber,
            cursorColumn: position.column,
            selection: {
              start: { line: selection.startLineNumber - 1, character: selection.startColumn - 1 },
              end: { line: selection.endLineNumber - 1, character: selection.endColumn - 1 },
              isEmpty: selection.isEmpty(),
            },
          })
        })

        modEditor.onDidChangeModelContent(() => {
          const current = modEditor.getValue()
          setModified(editorTabId, current !== savedContentRef.current)
        })

        modEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          const val = modEditor.getValue()
          void persistEditorValue(val)
        })
        modEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
          triggerProjectTextSearch(modEditor)
        })
        modEditor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F12, () => {
          triggerProjectTextSearch(modEditor)
        })

        editorBindings.set(editorTabId, {
          getContent: () => modEditor.getValue(),
          applyGeneratedCode: async (code, selection) => {
            if (selection && !selection.isEmpty) {
              modEditor.executeEdits('fastagents-ai-apply', [{
                range: new monaco.Range(
                  selection.startLine,
                  selection.startColumn,
                  selection.endLine,
                  selection.endColumn,
                ),
                text: code,
              }])
            } else {
              modifiedModel.setValue(code)
            }
            await persistEditorValue(modEditor.getValue())
          },
        })

        registerEditorContextActions(modEditor, contextMenuEditorRef, setEditorContextMenu)

        const syncModifiedEditorFromDisk = (): void => {
          void window.api.fs.readFile(tab.filePath).then((diskContent) => {
            if (disposed) return
            if (diskContent === savedContentRef.current || get().modified) return
            savedContentRef.current = diskContent
            const viewState = modEditor.saveViewState()
            modifiedModel.setValue(diskContent)
            if (viewState) modEditor.restoreViewState(viewState)
          }).catch(() => {})
        }

        watchTimerRef.current = setInterval(() => {
          if (disposed) return
          syncModifiedEditorFromDisk()
        }, 3000)

        fileSavedListener = (event: Event) => {
          const filePath = (event as CustomEvent<{ filePath?: string }>).detail?.filePath
          if (!filePath || !isCurrentTabFile(filePath)) return
          syncModifiedEditorFromDisk()
        }
        window.addEventListener('fastagents:file-saved', fileSavedListener as EventListener)

        setLoading(false)
      }).catch((err) => { if (!disposed) setError(String(err)) })
    } else {
      // ── Normal editor ──
      window.api.fs.readFile(tab.filePath).then((content) => {
        if (disposed) return
        savedContentRef.current = content
        if (tab.language === 'markdown') setMarkdownSource(content)
        const opts = buildEditorOptions({
          fontFamily: useUIStore.getState().settings.editorFontFamily,
          fontSize: useUIStore.getState().settings.editorFontSize,
          wordWrap: useUIStore.getState().settings.editorWordWrap,
          minimap: useUIStore.getState().settings.editorMinimap,
          lineNumbers: useUIStore.getState().settings.editorLineNumbers,
          stickyScroll: useUIStore.getState().settings.editorStickyScroll,
          fontLigatures: useUIStore.getState().settings.editorFontLigatures,
        })

        const editor = monaco.editor.create(container, { ...opts, value: content, language: tab.language })
        editorRef.current = editor

        // Track modifications
        editor.onDidChangeModelContent(() => {
          const current = editor.getValue()
          if (tab.language === 'markdown') setMarkdownSource(current)
          setModified(editorTabId, current !== savedContentRef.current)
        })

        // Track cursor position + sync IDE state
        editor.onDidChangeCursorSelection((e) => {
          if (!isActiveRef.current) return
          const selection = e.selection
          const position = selection.getPosition()
          const selectionInfo = buildSelectionInfo(selection, editor.getModel())
          const selections = buildSelectionsInfo(editor.getSelections(), editor.getModel())
          if (tab.language === 'markdown') setMarkdownSelectionText(selectionInfo?.text ?? '')
          setLastFocusedTabId(editorTabId)
          setCursorInfo({ line: position.lineNumber, column: position.column, selection: selectionInfo, selections })
          window.api.ide.selectionChanged({
            text: selectionInfo?.text ?? '',
            filePath: tab.filePath,
            fileUrl: `file://${tab.filePath.replace(/\\/g, '/')}`,
            fileName: tab.fileName,
            language: tab.language,
            cursorLine: position.lineNumber,
            cursorColumn: position.column,
            selection: {
              start: { line: selection.startLineNumber - 1, character: selection.startColumn - 1 },
              end: { line: selection.endLineNumber - 1, character: selection.endColumn - 1 },
              isEmpty: selection.isEmpty(),
            },
          })
        })

        // Ctrl+S to save
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          const val = editor.getValue()
          void persistEditorValue(val)
        })
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
          triggerProjectTextSearch(editor)
        })
        editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F12, () => {
          triggerProjectTextSearch(editor)
        })

        editorBindings.set(editorTabId, {
          getContent: () => editor.getValue(),
          applyGeneratedCode: async (code, selection) => {
            if (selection && !selection.isEmpty) {
              editor.executeEdits('fastagents-ai-apply', [{
                range: new monaco.Range(
                  selection.startLine,
                  selection.startColumn,
                  selection.endLine,
                  selection.endColumn,
                ),
                text: code,
              }])
            } else {
              editor.setValue(code)
            }
            await persistEditorValue(editor.getValue())
          },
        })

        registerEditorContextActions(editor, contextMenuEditorRef, setEditorContextMenu)

        const syncEditorFromDisk = (): void => {
          void window.api.fs.readFile(tab.filePath).then((diskContent) => {
            if (disposed) return
            if (diskContent === savedContentRef.current || get().modified) return
            savedContentRef.current = diskContent
            const viewState = editor.saveViewState()
            editor.setValue(diskContent)
            if (tab.language === 'markdown') setMarkdownSource(diskContent)
            if (viewState) editor.restoreViewState(viewState)
          }).catch(() => {})
        }

        // File watch: auto-reload on external change
        watchTimerRef.current = setInterval(() => {
          if (disposed) return
          syncEditorFromDisk()
        }, 3000)

        fileSavedListener = (event: Event) => {
          const filePath = (event as CustomEvent<{ filePath?: string }>).detail?.filePath
          if (!filePath || !isCurrentTabFile(filePath)) return
          syncEditorFromDisk()
        }
        window.addEventListener('fastagents:file-saved', fileSavedListener as EventListener)

        setLoading(false)
      }).catch((err) => { if (!disposed) setError(String(err)) })
    }

    // Helper to check modified state from inside interval
    function get() { return useEditorsStore.getState().tabs.find((t) => t.id === editorTabId) ?? { modified: false } }

    return () => {
      disposed = true
      if (watchTimerRef.current) clearInterval(watchTimerRef.current)
      if (fileSavedListener) window.removeEventListener('fastagents:file-saved', fileSavedListener as EventListener)
      editorBindings.delete(editorTabId)
      editorRef.current?.dispose()
      editorRef.current = null
      setCursorInfo(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorTabId, tab?.filePath, tab?.isDiff])

  useEffect(() => {
    if (!isMarkdownEditor) {
      setMarkdownMode('source')
      setMarkdownSelectionText('')
    }
  }, [isMarkdownEditor])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const frame = window.requestAnimationFrame(() => {
      if ('getModifiedEditor' in editor) {
        editor.layout()
        return
      }
      editor.layout()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [isMarkdownEditor, markdownMode])

  useEffect(() => {
    if (!isMarkdownEditor || markdownMode !== 'split') return
    const editor = editorRef.current
    const preview = markdownPreviewRef.current
    if (!editor || !preview || 'getModifiedEditor' in editor) return

    const syncPreviewFromSource = (): void => {
      if (markdownScrollSyncRef.current === 'preview') return
      markdownScrollSyncRef.current = 'source'
      const ratio = getScrollableRatio(editor.getScrollTop(), editor.getScrollHeight(), editor.getLayoutInfo().height)
      preview.scrollTop = ratio * Math.max(0, preview.scrollHeight - preview.clientHeight)
      window.requestAnimationFrame(() => {
        if (markdownScrollSyncRef.current === 'source') markdownScrollSyncRef.current = null
      })
    }

    const syncSourceFromPreview = (): void => {
      if (markdownScrollSyncRef.current === 'source') return
      markdownScrollSyncRef.current = 'preview'
      const ratio = getScrollableRatio(preview.scrollTop, preview.scrollHeight, preview.clientHeight)
      editor.setScrollTop(ratio * Math.max(0, editor.getScrollHeight() - editor.getLayoutInfo().height))
      window.requestAnimationFrame(() => {
        if (markdownScrollSyncRef.current === 'preview') markdownScrollSyncRef.current = null
      })
    }

    const disposable = editor.onDidScrollChange((event) => {
      if (event.scrollTopChanged) syncPreviewFromSource()
    })
    preview.addEventListener('scroll', syncSourceFromPreview, { passive: true })
    syncPreviewFromSource()

    return () => {
      disposable.dispose()
      preview.removeEventListener('scroll', syncSourceFromPreview)
      markdownScrollSyncRef.current = null
    }
  }, [isMarkdownEditor, markdownMode, renderedMarkdown])

  useEffect(() => {
    const preview = markdownPreviewRef.current
    if (!preview || !isMarkdownEditor || markdownMode !== 'split') return

    const frame = window.requestAnimationFrame(() => {
      if (!markdownSelectionText.trim()) {
        clearMarkdownPreviewSelection(preview)
        return
      }
      highlightMarkdownPreviewSelection(preview, markdownSelectionText)
    })

    return () => {
      window.cancelAnimationFrame(frame)
      clearMarkdownPreviewSelection(preview)
    }
  }, [isMarkdownEditor, markdownMode, markdownSelectionText, renderedMarkdown])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    updateEditorOptions(editor, editorOptions)
  }, [editorOptions])

  useEffect(() => {
    defineMonacoTheme(terminalTheme)
    lastAppliedTheme = terminalTheme
  }, [terminalTheme])

  useEffect(() => {
    if (!navigationTarget || !editorRef.current) return

    const editor = 'getModifiedEditor' in editorRef.current
      ? editorRef.current.getModifiedEditor()
      : editorRef.current
    const model = editor.getModel()
    if (!model) return

    const endLine = navigationTarget.endLine ?? navigationTarget.line
    const endColumn = navigationTarget.endColumn ?? navigationTarget.column
    const range = new monaco.Range(
      navigationTarget.line,
      navigationTarget.column,
      endLine,
      Math.max(navigationTarget.column, endColumn),
    )
    editor.setSelection(range)
    editor.revealRangeInCenter(range, monaco.editor.ScrollType.Smooth)
    clearNavigationTarget(editorTabId)
  }, [clearNavigationTarget, editorTabId, navigationTarget])

  // Focus editor when becoming active
  useEffect(() => {
    if (!isActive || !editorRef.current) return
    setLastFocusedTabId(editorTabId)
    if (isMarkdownEditor && markdownMode === 'preview') {
      setCursorInfo(null)
      return
    }
    const ed = editorRef.current
    if ('getModifiedEditor' in ed) {
      (ed as monaco.editor.IStandaloneDiffEditor).getModifiedEditor().focus()
    } else {
      (ed as monaco.editor.IStandaloneCodeEditor).focus()
    }
  }, [editorTabId, isActive, isMarkdownEditor, markdownMode, setCursorInfo, setLastFocusedTabId])

  // Get running sessions for picker — only current project, deduplicated
  const allSessions = useSessionsStore((s) => s.sessions)
  const selectedProjectId = useProjectsStore((s) => s.selectedProjectId)
  const runningSessions = useMemo(() => {
    const seen = new Set<string>()
    return allSessions.filter((s) => {
      if (!s.ptyId || s.status !== 'running') return false
      if (s.projectId !== selectedProjectId) return false
      if (seen.has(s.id)) return false
      seen.add(s.id)
      return true
    })
  }, [allSessions, selectedProjectId])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--color-bg-primary)]">
        <div className="text-center">
          <p className="text-[var(--ui-font-sm)] text-[var(--color-error)]">无法打开文件</p>
          <p className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)] mt-1 max-w-[400px] break-all">{error}</p>
          <button
            onClick={() => {
              const ps = usePanesStore.getState()
              const paneId = ps.findPaneForSession(editorTabId)
              if (paneId) ps.removeSessionFromPane(paneId, editorTabId)
              useEditorsStore.getState().closeTab(editorTabId)
            }}
            className="mt-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-1 text-[var(--ui-font-xs)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
          >
            关闭此标签页
          </button>
        </div>
      </div>
    )
  }

  const menuEditor = editorContextMenu ? contextMenuEditorRef.current : null
  const menuHasSelection = Boolean(menuEditor?.getSelection() && !menuEditor.getSelection()?.isEmpty())
  const searchRootPath = selectedWorktreePath ?? projectPath
  const runEditorMenuAction = (
    action: (editor: monaco.editor.IStandaloneCodeEditor) => void | Promise<void>,
  ): void => {
    const editor = contextMenuEditorRef.current
    setEditorContextMenu(null)
    if (!editor) return

    Promise.resolve(action(editor)).catch((err: unknown) => {
      addToast({
        type: 'error',
        title: '编辑器操作失败',
        body: err instanceof Error ? err.message : String(err),
      })
    })
  }
  const copyMarkdownPreviewSelection = async (): Promise<void> => {
    const selectedText = getSelectionTextWithinElement(markdownPreviewRef.current)
    if (!selectedText) return
    await navigator.clipboard.writeText(selectedText)
  }
  const copyMarkdownPreviewText = async (): Promise<void> => {
    const text = markdownPreviewRef.current?.innerText.trim()
    if (!text) return
    await navigator.clipboard.writeText(text)
  }
  const runMarkdownPreviewMenuAction = (action: () => void | Promise<void>): void => {
    setMarkdownPreviewContextMenu(null)
    Promise.resolve(action()).catch((err: unknown) => {
      addToast({
        type: 'error',
        title: '阅读视图操作失败',
        body: err instanceof Error ? err.message : String(err),
      })
    })
  }

  function triggerProjectTextSearch(editor: monaco.editor.IStandaloneCodeEditor): void {
    const query = getSelectedTextOrCurrentWord(editor)
    if (!query) {
      addToast({
        type: 'warning',
        title: '项目搜索',
        body: '请先选中文本，或把光标放在一个标识符上。',
      })
      return
    }

    if (!searchRootPath) {
      addToast({
        type: 'warning',
        title: '项目搜索',
        body: '当前没有可搜索的项目路径。',
      })
      return
    }

    useProjectSearchStore.getState().setQuery(query)
    void useProjectSearchStore.getState().searchInPath(searchRootPath, query)
    useUIStore.getState().activateDockPanel('search')
  }

  return (
    <div className="h-full w-full relative flex flex-col bg-[var(--color-bg-primary)]">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <span className="text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">Loading...</span>
        </div>
      )}
      {isMarkdownEditor && (
        <div className="relative flex h-9 shrink-0 items-center justify-end border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]/70 px-2">
          <div className="pointer-events-none absolute inset-x-28 top-0 flex h-full items-center justify-center">
            <span className="truncate text-sm font-medium text-[var(--color-text-secondary)]">
              {tab.fileName}
            </span>
          </div>
          <div className="inline-flex overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)]">
            <button
              type="button"
              onClick={() => setMarkdownMode('source')}
              aria-label="源码模式"
              aria-pressed={markdownMode === 'source'}
              title="源码模式"
              className={cn(
                'flex h-6 w-8 items-center justify-center text-[var(--color-text-tertiary)] transition-colors',
                markdownMode === 'source'
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                  : 'hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]',
              )}
            >
              <Code2 size={13} strokeWidth={2.2} />
            </button>
            <button
              type="button"
              onClick={() => setMarkdownMode('preview')}
              aria-label="阅读模式"
              aria-pressed={markdownMode === 'preview'}
              title="阅读模式"
              className={cn(
                'flex h-6 w-8 items-center justify-center border-l border-[var(--color-border)] text-[var(--color-text-tertiary)] transition-colors',
                markdownMode === 'preview'
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                  : 'hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]',
              )}
            >
              <Eye size={13} strokeWidth={2.2} />
            </button>
            <button
              type="button"
              onClick={() => setMarkdownMode('split')}
              aria-label="分屏模式"
              aria-pressed={markdownMode === 'split'}
              title="分屏模式"
              className={cn(
                'flex h-6 w-8 items-center justify-center border-l border-[var(--color-border)] text-[var(--color-text-tertiary)] transition-colors',
                markdownMode === 'split'
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                  : 'hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-secondary)]',
              )}
            >
              <Columns2 size={13} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      )}
      <div className={cn('min-h-0 w-full flex-1', isMarkdownEditor && markdownMode === 'split' ? 'flex' : 'relative')}>
        <div
          ref={containerRef}
          aria-hidden={isMarkdownEditor && markdownMode === 'preview'}
          className={cn(
            'min-h-0 min-w-0',
            !isMarkdownEditor && 'h-full w-full',
            isMarkdownEditor && markdownMode === 'source' && 'h-full w-full',
            isMarkdownEditor && markdownMode === 'split' && 'h-full w-1/2 border-r border-[var(--color-border)]',
            isMarkdownEditor && markdownMode === 'preview' && 'pointer-events-none absolute inset-0 h-full w-full opacity-0',
          )}
        />
        {isMarkdownEditor && markdownMode !== 'source' && (
          <div
            ref={markdownPreviewRef}
            tabIndex={0}
            className={cn(
              'markdown-preview-content ai-summary-content select-text relative h-full min-w-0 overflow-auto bg-[var(--color-bg-primary)] px-8 py-7 text-[13px] leading-6 text-[var(--color-text-secondary)] outline-none',
              markdownMode === 'split' ? 'w-1/2' : 'w-full',
            )}
            onContextMenu={(event) => {
              event.preventDefault()
              setMarkdownPreviewContextMenu({ x: event.clientX, y: event.clientY })
            }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
                const selectedText = getSelectionTextWithinElement(markdownPreviewRef.current)
                if (!selectedText) return
                event.preventDefault()
                void navigator.clipboard.writeText(selectedText)
              }
            }}
            dangerouslySetInnerHTML={{ __html: renderedMarkdown }}
          />
        )}
      </div>

      {markdownPreviewContextMenu && createPortal(
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: 9998 }}
            onMouseDown={() => setMarkdownPreviewContextMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault()
              setMarkdownPreviewContextMenu(null)
            }}
          />
          <div
            style={{ top: markdownPreviewContextMenu.y, left: markdownPreviewContextMenu.x, zIndex: 9999 }}
            className="fixed min-w-40 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[#343436] py-1 shadow-lg shadow-black/35"
            onMouseDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <EditorMenuItem
              label="复制"
              shortcut="Ctrl+C"
              disabled={!getSelectionTextWithinElement(markdownPreviewRef.current)}
              onClick={() => runMarkdownPreviewMenuAction(copyMarkdownPreviewSelection)}
            />
            <EditorMenuDivider />
            <EditorMenuItem
              label="复制全文"
              onClick={() => runMarkdownPreviewMenuAction(copyMarkdownPreviewText)}
            />
          </div>
        </>,
        document.body,
      )}

      {editorContextMenu && tab && createPortal(
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: 9998 }}
            onMouseDown={() => setEditorContextMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault()
              setEditorContextMenu(null)
            }}
          />
          <div
            style={{ top: editorContextMenu.y, left: editorContextMenu.x, zIndex: 9999 }}
            className="fixed min-w-56 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[#343436] py-1 shadow-lg shadow-black/35"
            onMouseDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <EditorMenuItem
              label="更改所有匹配项"
              shortcut="Ctrl+F2"
              disabled={!menuHasSelection}
              onClick={() => runEditorMenuAction((editor) => editor.trigger('fastagents-menu', 'editor.action.changeAll', null))}
            />
            <EditorMenuDivider />
            <EditorMenuItem label="剪切" shortcut="Ctrl+X" onClick={() => runEditorMenuAction(cutEditorText)} />
            <EditorMenuItem label="复制" shortcut="Ctrl+C" onClick={() => runEditorMenuAction(copyEditorText)} />
            <EditorMenuItem label="粘贴" shortcut="Ctrl+V" onClick={() => runEditorMenuAction(pasteEditorText)} />
            <EditorMenuDivider />
            <EditorMenuItem
              label="复制详细代码路径"
              onClick={() => runEditorMenuAction((editor) => copyDetailedCodePath(editor, tab, addToast))}
            />
            <EditorMenuItem
              label="发送选区到会话..."
              disabled={!menuHasSelection}
              onClick={() => runEditorMenuAction((editor) => showSendPickerForSelection(editor, tab, setSendPicker))}
            />
            <EditorMenuItem
              label="在项目中搜索文本"
              shortcut="Ctrl+Shift+F"
              onClick={() => runEditorMenuAction(triggerProjectTextSearch)}
            />
            <EditorMenuItem
              label="查找项目内文本引用"
              shortcut="Shift+F12"
              onClick={() => runEditorMenuAction(triggerProjectTextSearch)}
            />
            <EditorMenuDivider />
            <EditorMenuItem
              label="命令面板"
              shortcut="F1"
              onClick={() => runEditorMenuAction((editor) => editor.trigger('fastagents-menu', 'editor.action.quickCommand', null))}
            />
          </div>
        </>,
        document.body,
      )}

      {/* Session picker for "发送选区到会话" */}
      {sendPicker && createPortal(
        <>
          <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setSendPicker(null)} />
          <div
            style={{ top: sendPicker.y, left: sendPicker.x, zIndex: 9999 }}
            className="fixed w-52 rounded-[var(--radius-md)] py-1 border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] shadow-lg shadow-black/30"
          >
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
              发送到会话
            </div>
            {runningSessions.length === 0 ? (
              <div className="px-3 py-2 text-[var(--ui-font-xs)] text-[var(--color-text-tertiary)]">没有正在运行的会话</div>
            ) : (
              runningSessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    if (s.ptyId) window.api.session.write(s.ptyId, sendPicker.prompt + '\r')
                    setSendPicker(null)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-[var(--ui-font-xs)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)] shrink-0" />
                  <span className="truncate">{s.name}</span>
                </button>
              ))
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
