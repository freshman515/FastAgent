import { marked } from 'marked'

interface HighlightRule {
  className: string
  pattern: RegExp
}

const LANGUAGE_ALIASES: Record<string, string> = {
  csharp: 'csharp',
  cs: 'csharp',
  typescript: 'typescript',
  typescriptreact: 'typescript',
  ts: 'typescript',
  javascript: 'javascript',
  javascriptreact: 'javascript',
  js: 'javascript',
  jsx: 'javascript',
  tsx: 'typescript',
  json: 'json',
  shell: 'shell',
  bash: 'shell',
  sh: 'shell',
  powershell: 'shell',
  xml: 'xml',
  html: 'xml',
  xaml: 'xml',
  sql: 'sql',
}

const C_LIKE_STRING = /@"(?:[^"]|"")*"|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g
const C_LIKE_COMMENT = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g
const NUMBER = /\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?)\b/g
const OPERATOR = /=>|\?\?=?|&&|\|\||==|!=|<=|>=|[-+*/%]=?|[<>]=?|\.(?=[A-Za-z_])|::|!|\?|:/g

const RULES: Record<string, HighlightRule[]> = {
  csharp: [
    { className: 'comment', pattern: new RegExp(C_LIKE_COMMENT.source, 'g') },
    { className: 'string', pattern: new RegExp(C_LIKE_STRING.source, 'g') },
    {
      className: 'keyword',
      pattern: /\b(?:using|namespace|class|public|private|protected|internal|static|async|await|return|if|else|switch|case|new|var|void|null|true|false|try|catch|finally|throw|foreach|for|while|break|continue|this|base|get|set|interface|record|enum|struct|partial|readonly|const|where|in|is|as)\b/g,
    },
    {
      className: 'type',
      pattern: /\b(?:Task|List|Dictionary|Guid|string|int|bool|object|decimal|double|float|long|short|byte|char|CancellationToken|PeriodicTimer|DateTime|DateTimeKind|TimeSpan|IEnumerable|IQueryable|HashSet|Func|Action)\b/g,
    },
    {
      className: 'type',
      pattern: /\b[A-Z][A-Za-z0-9_]*\b/g,
    },
    {
      className: 'function',
      pattern: /\b[A-Za-z_][A-Za-z0-9_]*\b(?=\s*\()/g,
    },
    {
      className: 'member',
      pattern: /(?<=\.)[A-Za-z_][A-Za-z0-9_]*\b/g,
    },
    { className: 'number', pattern: new RegExp(NUMBER.source, 'g') },
    { className: 'operator', pattern: new RegExp(OPERATOR.source, 'g') },
  ],
  typescript: [
    { className: 'comment', pattern: new RegExp(C_LIKE_COMMENT.source, 'g') },
    { className: 'string', pattern: new RegExp(C_LIKE_STRING.source, 'g') },
    {
      className: 'keyword',
      pattern: /\b(?:import|export|from|const|let|var|function|return|if|else|switch|case|new|class|interface|type|extends|implements|async|await|try|catch|finally|throw|for|while|break|continue|null|undefined|true|false|typeof|instanceof|in|as)\b/g,
    },
    {
      className: 'type',
      pattern: /\b(?:Promise|Record|Array|Map|Set|string|number|boolean|unknown|never|void|React|JSX)\b/g,
    },
    {
      className: 'type',
      pattern: /\b[A-Z][A-Za-z0-9_]*\b/g,
    },
    {
      className: 'function',
      pattern: /\b[A-Za-z_$][A-Za-z0-9_$]*\b(?=\s*\()/g,
    },
    {
      className: 'member',
      pattern: /(?<=\.)[A-Za-z_$][A-Za-z0-9_$]*\b/g,
    },
    { className: 'number', pattern: new RegExp(NUMBER.source, 'g') },
    { className: 'operator', pattern: new RegExp(OPERATOR.source, 'g') },
  ],
  javascript: [
    { className: 'comment', pattern: new RegExp(C_LIKE_COMMENT.source, 'g') },
    { className: 'string', pattern: new RegExp(C_LIKE_STRING.source, 'g') },
    {
      className: 'keyword',
      pattern: /\b(?:import|export|from|const|let|var|function|return|if|else|switch|case|new|class|extends|async|await|try|catch|finally|throw|for|while|break|continue|null|undefined|true|false|typeof|instanceof|in)\b/g,
    },
    {
      className: 'type',
      pattern: /\b[A-Z][A-Za-z0-9_]*\b/g,
    },
    {
      className: 'function',
      pattern: /\b[A-Za-z_$][A-Za-z0-9_$]*\b(?=\s*\()/g,
    },
    {
      className: 'member',
      pattern: /(?<=\.)[A-Za-z_$][A-Za-z0-9_$]*\b/g,
    },
    { className: 'number', pattern: new RegExp(NUMBER.source, 'g') },
    { className: 'operator', pattern: new RegExp(OPERATOR.source, 'g') },
  ],
  json: [
    { className: 'attr', pattern: /"(?:\\.|[^"\\])*"(?=\s*:)/g },
    { className: 'string', pattern: /"(?:\\.|[^"\\])*"/g },
    { className: 'keyword', pattern: /\b(?:true|false|null)\b/g },
    { className: 'number', pattern: new RegExp(NUMBER.source, 'g') },
  ],
  shell: [
    { className: 'comment', pattern: /#[^\n]*/g },
    { className: 'string', pattern: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g },
    { className: 'variable', pattern: /\$\{?[A-Za-z_][\w]*\}?/g },
    {
      className: 'keyword',
      pattern: /\b(?:if|then|fi|for|do|done|case|esac|while|in|function|echo|export|local|return|exit)\b/g,
    },
    {
      className: 'function',
      pattern: /\b[A-Za-z_][A-Za-z0-9_-]*\b(?=\s*\()/g,
    },
    { className: 'number', pattern: new RegExp(NUMBER.source, 'g') },
    { className: 'operator', pattern: new RegExp(OPERATOR.source, 'g') },
  ],
  xml: [
    { className: 'comment', pattern: /<!--[\s\S]*?-->/g },
    { className: 'string', pattern: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g },
    { className: 'tag', pattern: /<\/?[A-Za-z][\w:-]*/g },
    { className: 'attr', pattern: /\b[A-Za-z_:][\w:.-]*(?=\=)/g },
  ],
  sql: [
    { className: 'comment', pattern: /--[^\n]*|\/\*[\s\S]*?\*\//g },
    { className: 'string', pattern: /'(?:''|[^'])*'/g },
    {
      className: 'keyword',
      pattern: /\b(?:SELECT|FROM|WHERE|AND|OR|NOT|INNER|LEFT|RIGHT|JOIN|ON|GROUP|BY|ORDER|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|ALTER|TABLE|VIEW|AS|TOP|DISTINCT|CASE|WHEN|THEN|END|NULL|IS|LIKE)\b/gi,
    },
    {
      className: 'function',
      pattern: /\b[A-Za-z_][A-Za-z0-9_]*\b(?=\s*\()/g,
    },
    { className: 'number', pattern: new RegExp(NUMBER.source, 'g') },
    { className: 'operator', pattern: new RegExp(OPERATOR.source, 'g') },
  ],
  generic: [
    { className: 'comment', pattern: /\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\//g },
    { className: 'string', pattern: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g },
    { className: 'type', pattern: /\b[A-Z][A-Za-z0-9_]*\b/g },
    { className: 'function', pattern: /\b[A-Za-z_][A-Za-z0-9_]*\b(?=\s*\()/g },
    { className: 'number', pattern: new RegExp(NUMBER.source, 'g') },
    { className: 'operator', pattern: new RegExp(OPERATOR.source, 'g') },
  ],
}

function normalizeLanguage(language?: string): string {
  if (!language) return 'generic'
  return LANGUAGE_ALIASES[language.toLowerCase()] ?? 'generic'
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function decodeHtmlEntities(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
}

function findRuleIndex(match: RegExpExecArray, rules: HighlightRule[]): number {
  let captureIndex = 1
  for (let index = 0; index < rules.length; index += 1) {
    if (match[captureIndex] !== undefined) return index
    captureIndex += 1
  }
  return -1
}

export function highlightCode(code: string, language?: string): string {
  const rules = RULES[normalizeLanguage(language)] ?? RULES.generic
  const source = rules.map((rule) => `(${rule.pattern.source})`).join('|')
  const flags = Array.from(new Set(rules.flatMap((rule) => rule.pattern.flags.split('')))).join('')
  const regex = new RegExp(source, flags.includes('g') ? flags : `${flags}g`)

  let result = ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(code)) !== null) {
    if (match.index > lastIndex) {
      result += escapeHtml(code.slice(lastIndex, match.index))
    }

    const ruleIndex = findRuleIndex(match, rules)
    const className = ruleIndex >= 0 ? `md-token md-token-${rules[ruleIndex].className}` : 'md-token'
    result += `<span class="${className}">${escapeHtml(match[0])}</span>`
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < code.length) {
    result += escapeHtml(code.slice(lastIndex))
  }

  return result
}

function highlightCodeBlocks(html: string): string {
  return html.replace(
    /<pre><code(?: class="language-([^"]+)")?>([\s\S]*?)<\/code><\/pre>/g,
    (_full, language: string | undefined, codeHtml: string) => {
      const rawCode = decodeHtmlEntities(codeHtml)
      return `<pre><code class="language-${language ?? 'plaintext'}">${highlightCode(rawCode, language)}</code></pre>`
    },
  )
}

export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false }) as string
  return highlightCodeBlocks(html)
}

export function renderCodeFence(code: string, language?: string): string {
  return renderMarkdown(`\`\`\`${language ?? ''}\n${code}\n\`\`\``)
}
