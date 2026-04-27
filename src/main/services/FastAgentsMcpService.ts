import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { readConfig } from './ConfigStore'
import { windowsPathToWslPath } from './WslPath'

interface McpConfigOptions {
  port: number
  token: string
  sessionId: string
  target?: 'windows' | 'wsl'
}

function getMcpDir(): string {
  return join(app.getPath('userData'), 'mcp')
}

function getSourceBridgeCandidates(): string[] {
  return [
    join(process.cwd(), 'src', 'main', 'services', 'mcp-bridge.cjs'),
    join(__dirname, 'mcp-bridge.cjs'),
    join(process.resourcesPath, 'app.asar', 'src', 'main', 'services', 'mcp-bridge.cjs'),
  ]
}

function readBridgeSource(): string | null {
  for (const candidate of getSourceBridgeCandidates()) {
    try {
      if (existsSync(candidate)) return readFileSync(candidate, 'utf-8')
    } catch {
      // Try the next candidate.
    }
  }
  return null
}

function ensureBridgeScript(): string | null {
  const source = readBridgeSource()
  if (!source) {
    console.warn('[FastAgentsMcp] mcp-bridge.cjs not found')
    return null
  }

  const target = join(getMcpDir(), 'fastagents-mcp-bridge.cjs')
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, source, 'utf-8')
  return target
}

export function ensureFastAgentsMcpBridgePath(target: 'windows' | 'wsl' = 'windows'): string | null {
  const bridgePath = ensureBridgeScript()
  if (!bridgePath) return null
  return target === 'wsl' ? windowsPathToWslPath(bridgePath) : bridgePath
}

function normalizeClaudeProjectPath(projectPath: string): string {
  return projectPath.replace(/\\/g, '/').replace(/\/+$/, '')
}

function getClaudeJsonPath(): string {
  return join(homedir(), '.claude.json')
}

function readClaudeJson(): Record<string, unknown> {
  const path = getClaudeJsonPath()
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function writeClaudeJson(data: Record<string, unknown>): void {
  const path = getClaudeJsonPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
}

export function createFastAgentsMcpConfig(options: McpConfigOptions): string | null {
  const target = options.target ?? 'windows'
  const bridgePath = ensureFastAgentsMcpBridgePath(target)
  if (!bridgePath) return null

  const configPath = join(getMcpDir(), `fastagents-mcp-${target}-${options.sessionId}.json`)
  const config = {
    mcpServers: {
      fastagents: {
        command: 'node',
        args: [bridgePath],
        env: {
          FASTAGENTS_MCP_PORT: String(options.port),
          FASTAGENTS_MCP_TOKEN: options.token,
          FASTAGENTS_SESSION_ID: options.sessionId,
        },
      },
    },
  }

  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  return target === 'wsl' ? windowsPathToWslPath(configPath) : configPath
}

// ─── Codex CLI (~/.codex/config.toml) ──────────────────────────────────────
//
// Codex CLI loads MCP servers from ~/.codex/config.toml under
// `[mcp_servers.<name>]` sections. Unlike Claude Code it has no
// `--mcp-config <file>` CLI arg, so we rewrite this file on every
// FastAgents startup with the fresh port/token.
//
// We preserve everything else in config.toml (user preferences, project
// trust levels, tui theme, ...) and only upsert the `fastagents` section.

function getCodexConfigPath(): string {
  return join(homedir(), '.codex', 'config.toml')
}

function readCodexConfig(): string {
  try {
    return readFileSync(getCodexConfigPath(), 'utf-8')
  } catch {
    return ''
  }
}

function writeCodexConfig(content: string): void {
  const path = getCodexConfigPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf-8')
}

/** Replace `[header]` section (up to the next `[` header) with `replacement`,
 *  or append if not present. Section-aware without a full TOML parser: we
 *  only touch line-level markers so user comments / arrays inside other
 *  sections stay untouched. */
function upsertTomlSection(source: string, header: string, replacement: string): string {
  const lines = source.length ? source.split(/\r?\n/) : []
  const headerLine = `[${header}]`

  let sectionStart = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === headerLine) {
      sectionStart = i
      break
    }
  }

  const replacementLines = replacement.replace(/\r\n/g, '\n').split('\n')
  if (sectionStart === -1) {
    // Append at end (with one blank line separator if file is non-empty).
    const base = lines.length === 0 ? [] : lines[lines.length - 1] === '' ? lines : [...lines, '']
    return [...base, ...replacementLines, ''].join('\n')
  }

  // Find end of section: next TOML section header (`[xxx]` or `[[xxx]]`) or EOF.
  let sectionEnd = lines.length
  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      sectionEnd = i
      break
    }
  }

  // Trim trailing blank lines inside the old section so replacement lands
  // cleanly against the next header.
  while (sectionEnd > sectionStart + 1 && lines[sectionEnd - 1].trim() === '') {
    sectionEnd -= 1
  }

  const merged = [
    ...lines.slice(0, sectionStart),
    ...replacementLines,
    '', // one blank line separator before next section
    ...lines.slice(sectionEnd),
  ]
  return merged.join('\n')
}

/** Wrap a filesystem path as a TOML literal string (single-quoted) so we
 *  don't need to escape Windows backslashes. Codex accepts literal strings
 *  in arrays. Fails back to a double-quoted string with escaped backslashes
 *  if the path itself contains a single quote (rare). */
function tomlLiteralString(value: string): string {
  if (!value.includes("'")) return `'${value}'`
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function registerFastAgentsMcpInCodex(options: Pick<McpConfigOptions, 'port' | 'token'>): void {
  const bridgePath = ensureBridgeScript()
  if (!bridgePath) return

  // Baseline PORT/TOKEN live in config.toml. SESSION_ID is per-session and
  // is injected at PTY spawn time via `codex -c mcp_servers.fastagents.env.
  // FASTAGENTS_SESSION_ID="..."` — see PtyManager. We can't put SESSION_ID
  // here because a global config is shared by every Codex instance; only a
  // CLI override can carry a different value per Codex tab.
  //
  // Note: Codex CLI (0.121) spawns MCP servers with *only* the env declared
  // here — it does NOT inherit the parent process env. So the env clause
  // below is required; leaving it out would mean the bridge can't find the
  // orchestrator at all.
  const section = [
    '[mcp_servers.fastagents]',
    'command = "node"',
    `args = [${tomlLiteralString(bridgePath)}]`,
    `env = { FASTAGENTS_MCP_PORT = "${options.port}", FASTAGENTS_MCP_TOKEN = "${options.token}" }`,
  ].join('\n')

  // Also sweep any stale [mcp_servers.fastagents.env] sub-table left behind
  // by earlier versions.
  const original = readCodexConfig()
  // First strip any legacy dotted sub-tables (replace with empty), then
  // upsert the main section.
  const cleaned = removeTomlSection(original, 'mcp_servers.fastagents.env')
  const updated = upsertTomlSection(cleaned, 'mcp_servers.fastagents', section)
  if (updated !== original) {
    try {
      writeCodexConfig(updated)
    } catch (err) {
      console.warn('[FastAgentsMcp] failed to update ~/.codex/config.toml:', err)
    }
  }
}

// ─── Sync ~/.claude/CLAUDE.md "Meta-Agent" section into ~/.codex/AGENTS.md ───
//
// Claude Code and Codex each have their own global instruction file:
//   ~/.claude/CLAUDE.md    (Claude)
//   ~/.codex/AGENTS.md     (Codex)
// The "Meta-Agent" section explaining the fa_* / ft_* toolset must stay
// identical in both, otherwise Codex drifts out of sync. On every FastAgents
// startup we mirror the section from CLAUDE.md into a managed block of
// AGENTS.md. Everything else in AGENTS.md (e.g. Git rules) is untouched.

const MANAGED_BEGIN = '<!-- BEGIN: Meta-Agent MCP (auto-synced from ~/.claude/CLAUDE.md — do not edit by hand) -->'
const MANAGED_END = '<!-- END: Meta-Agent MCP -->'

function extractMetaAgentSection(claudeMd: string): string | null {
  const lines = claudeMd.split(/\r?\n/)
  let start = -1
  for (let i = 0; i < lines.length; i += 1) {
    // Tolerate wording changes in the heading — match by prefix.
    if (lines[i].startsWith('## Meta-Agent')) { start = i; break }
  }
  if (start === -1) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) { end = i; break }
  }
  while (end > start + 1 && lines[end - 1].trim() === '') end -= 1
  return lines.slice(start, end).join('\n')
}

function removeHeadingSection(target: string, headingPrefix: string): string {
  const lines = target.split(/\r?\n/)
  let start = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith(headingPrefix)) { start = i; break }
  }
  if (start === -1) return target
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) { end = i; break }
  }
  while (end > start + 1 && lines[end - 1].trim() === '') end -= 1
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n')
}

function removeManagedBlock(target: string): string {
  const beginIdx = target.indexOf(MANAGED_BEGIN)
  const endIdx = target.indexOf(MANAGED_END)
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) return target
  // Swallow one trailing newline so repeated strips don't accumulate blanks.
  let cut = endIdx + MANAGED_END.length
  if (target[cut] === '\n') cut += 1
  return target.slice(0, beginIdx).replace(/\n+$/, '\n') + target.slice(cut)
}

function appendManagedBlock(target: string, block: string): string {
  const managed = `${MANAGED_BEGIN}\n${block}\n${MANAGED_END}`
  const normalized = target.length === 0 ? '' : target.replace(/\n+$/, '') + '\n\n'
  return `${normalized}${managed}\n`
}

function getClaudeMdPath(): string {
  return join(homedir(), '.claude', 'CLAUDE.md')
}

function getCodexAgentsMdPath(): string {
  return join(homedir(), '.codex', 'AGENTS.md')
}

export function syncMetaAgentToCodexAgentsMd(): void {
  let claudeMd: string
  try {
    claudeMd = readFileSync(getClaudeMdPath(), 'utf-8')
  } catch {
    return // no CLAUDE.md → nothing to sync from
  }

  const block = extractMetaAgentSection(claudeMd)
  if (!block) return // no Meta-Agent section present

  let agentsMd = ''
  try {
    agentsMd = readFileSync(getCodexAgentsMdPath(), 'utf-8')
  } catch {
    // file absent — will be created below
  }

  // Three-step idempotent rewrite:
  //  1. Drop the existing managed block (if any) atomically — avoids the
  //     END-marker-eaten trap where step 2's heading scan would munch past it.
  //  2. Strip any hand-written "## Meta-Agent ..." section so it doesn't
  //     coexist with the managed block after a first-time migration.
  //  3. Append the fresh managed block at the end.
  const step1 = removeManagedBlock(agentsMd)
  const step2 = removeHeadingSection(step1, '## Meta-Agent')
  const updated = appendManagedBlock(step2, block)

  if (updated !== agentsMd) {
    try {
      const path = getCodexAgentsMdPath()
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, updated, 'utf-8')
    } catch (err) {
      console.warn('[FastAgentsMcp] failed to sync ~/.codex/AGENTS.md:', err)
    }
  }
}

function removeTomlSection(source: string, header: string): string {
  const lines = source.length ? source.split(/\r?\n/) : []
  const headerLine = `[${header}]`
  let start = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === headerLine) {
      start = i
      break
    }
  }
  if (start === -1) return source

  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      end = i
      break
    }
  }
  while (end > start + 1 && lines[end - 1].trim() === '') end -= 1
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n')
}

export function registerFastAgentsMcpInClaudeProjects(options: Pick<McpConfigOptions, 'port' | 'token'>): void {
  const bridgePath = ensureBridgeScript()
  if (!bridgePath) return

  const fastagentsServer = {
    type: 'stdio',
    command: 'node',
    args: [bridgePath],
    env: {
      FASTAGENTS_MCP_PORT: String(options.port),
      FASTAGENTS_MCP_TOKEN: options.token,
    },
  }

  const config = readConfig()
  const projectPaths = [
    ...(Array.isArray(config.projects) ? config.projects : [])
      .flatMap((project) => {
        if (!project || typeof project !== 'object') return []
        const path = (project as Record<string, unknown>).path
        return typeof path === 'string' ? [path] : []
      }),
    ...(Array.isArray(config.worktrees) ? config.worktrees : [])
      .flatMap((worktree) => {
        if (!worktree || typeof worktree !== 'object') return []
        const path = (worktree as Record<string, unknown>).path
        return typeof path === 'string' ? [path] : []
      }),
  ]

  const uniquePaths = [...new Set(projectPaths.map(normalizeClaudeProjectPath).filter(Boolean))]
  if (uniquePaths.length === 0) return

  const claudeJson = readClaudeJson()
  const projects = claudeJson.projects && typeof claudeJson.projects === 'object' && !Array.isArray(claudeJson.projects)
    ? claudeJson.projects as Record<string, unknown>
    : {}
  claudeJson.projects = projects

  for (const projectPath of uniquePaths) {
    const entry = projects[projectPath] && typeof projects[projectPath] === 'object' && !Array.isArray(projects[projectPath])
      ? projects[projectPath] as Record<string, unknown>
      : {}
    const mcpServers = entry.mcpServers && typeof entry.mcpServers === 'object' && !Array.isArray(entry.mcpServers)
      ? entry.mcpServers as Record<string, unknown>
      : {}
    mcpServers.fastagents = fastagentsServer
    entry.mcpServers = mcpServers
    projects[projectPath] = entry
  }

  writeClaudeJson(claudeJson)
}
