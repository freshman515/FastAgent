import { useGitStore } from '@/stores/git'
import { useWorktreesStore } from '@/stores/worktrees'

function sanitizeSegment(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
}

function getParentDir(path: string): string {
  return path.replace(/[\\/][^\\/]+$/, '')
}

function getProjectDirName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? 'project'
}

export interface AgentWorktreeResult {
  worktreeId: string | undefined
  branch: string
  path: string
  fallback: boolean
  error?: string
}

export async function createAgentWorktree(options: {
  projectId: string
  projectPath: string
  label: string
  branchName?: string | null
}): Promise<AgentWorktreeResult> {
  const mainWorktreeId = useWorktreesStore.getState().getMainWorktree(options.projectId)?.id
  const status = await window.api.git.getStatus(options.projectPath)
  if (status.isDirty) {
    return {
      worktreeId: mainWorktreeId,
      branch: status.current,
      path: options.projectPath,
      fallback: true,
      error: '主工作区有未提交改动，已禁用隔离 worktree 并回退到当前工作区。',
    }
  }

  const shortId = Math.random().toString(36).slice(2, 8)
  const label = sanitizeSegment(options.label) || 'worker'
  const requestedBranch = options.branchName?.trim()
    ? options.branchName.trim().split('/').map(sanitizeSegment).filter(Boolean).join('/')
    : ''
  const branch = requestedBranch || `agent/${label}-${shortId}`
  const pathLabel = sanitizeSegment(branch) || `${label}-${shortId}`
  const targetPath = `${getParentDir(options.projectPath)}/${getProjectDirName(options.projectPath)}-${pathLabel}-${shortId}`

  await window.api.git.addWorktree(options.projectPath, targetPath, branch)
  const worktreeId = useWorktreesStore.getState().addWorktree(options.projectId, branch, targetPath, false)
  void useGitStore.getState().fetchWorktrees(options.projectId, options.projectPath)
  return { worktreeId, branch, path: targetPath, fallback: false }
}
