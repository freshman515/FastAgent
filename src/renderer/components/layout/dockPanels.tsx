import type { ComponentType } from 'react'
import { Activity, Bot, Command, Files, GitBranch, History, Layers3, ListTodo, MessageSquareText, Network, Search, Sparkles, Clock } from 'lucide-react'
import type { DockPanelId } from '@/stores/ui'
import claudeIcon from '@/assets/icons/Claude.png'
import { ProjectsPanel } from '@/components/sidebar/ProjectsPanel'
import { RecentSessionsPanel } from '@/components/sidebar/RecentSessionsPanel'
import { AgentMonitor } from '@/components/rightpanel/AgentMonitor'
import { QuickCommands } from '@/components/rightpanel/QuickCommands'
import { PromptManager } from '@/components/rightpanel/PromptManager'
import { PromptOptimizerPanel } from '@/components/rightpanel/PromptOptimizerPanel'
import { TodoList } from '@/components/rightpanel/TodoList'
import { TaskOrchestrator } from '@/components/rightpanel/TaskOrchestrator'
import { FileTree } from '@/components/rightpanel/FileTree'
import { ProjectSearch } from '@/components/rightpanel/ProjectSearch'
import { SessionTimeline } from '@/components/rightpanel/SessionTimeline'
import { GitChanges } from '@/components/rightpanel/GitChanges'
import { OpenCodePanel } from '@/components/rightpanel/OpenCodePanel'
import { ClaudeCodePanel } from '@/components/rightpanel/ClaudeCodePanel'

export interface DockPanelDefinition {
  id: DockPanelId
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
  render: () => JSX.Element
}

function ClaudeDockIcon({ size = 16, className }: { size?: number; className?: string }): JSX.Element {
  return <img src={claudeIcon} alt="" className={className} style={{ width: size, height: size }} />
}

export const DOCK_PANEL_DEFINITIONS: Record<DockPanelId, DockPanelDefinition> = {
  projects: {
    id: 'projects',
    label: '项目',
    icon: Layers3,
    render: () => <ProjectsPanel />,
  },
  recentSessions: {
    id: 'recentSessions',
    label: '最近会话',
    icon: Clock,
    render: () => <RecentSessionsPanel />,
  },
  agent: {
    id: 'agent',
    label: '代理监控',
    icon: Activity,
    render: () => <AgentMonitor />,
  },
  tasks: {
    id: 'tasks',
    label: '任务编排',
    icon: Network,
    render: () => <TaskOrchestrator />,
  },
  commands: {
    id: 'commands',
    label: '快捷命令',
    icon: Command,
    render: () => <QuickCommands />,
  },
  prompts: {
    id: 'prompts',
    label: '提示词',
    icon: MessageSquareText,
    render: () => <PromptManager />,
  },
  promptOptimizer: {
    id: 'promptOptimizer',
    label: '提示词实验室',
    icon: Sparkles,
    render: () => <PromptOptimizerPanel />,
  },
  todo: {
    id: 'todo',
    label: '待办事项',
    icon: ListTodo,
    render: () => <TodoList />,
  },
  files: {
    id: 'files',
    label: '文件',
    icon: Files,
    render: () => <FileTree />,
  },
  search: {
    id: 'search',
    label: '搜索',
    icon: Search,
    render: () => <ProjectSearch />,
  },
  timeline: {
    id: 'timeline',
    label: '时间线',
    icon: History,
    render: () => <SessionTimeline />,
  },
  git: {
    id: 'git',
    label: 'Git',
    icon: GitBranch,
    render: () => <GitChanges />,
  },
  ai: {
    id: 'ai',
    label: 'OpenCode',
    icon: Bot,
    render: () => <OpenCodePanel />,
  },
  claude: {
    id: 'claude',
    label: 'Claude',
    icon: ClaudeDockIcon,
    render: () => <ClaudeCodePanel />,
  },
}
