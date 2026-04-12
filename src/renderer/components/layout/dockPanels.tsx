import type { ComponentType } from 'react'
import { Activity, Bot, Command, Files, GitBranch, History, Layers3, ListTodo, MessageSquareText, Search, Sparkles } from 'lucide-react'
import type { DockPanelId } from '@/stores/ui'
import claudeIcon from '@/assets/icons/Claude.png'
import { ProjectsPanel } from '@/components/sidebar/ProjectsPanel'
import { AgentMonitor } from '@/components/rightpanel/AgentMonitor'
import { QuickCommands } from '@/components/rightpanel/QuickCommands'
import { PromptManager } from '@/components/rightpanel/PromptManager'
import { PromptOptimizerPanel } from '@/components/rightpanel/PromptOptimizerPanel'
import { TodoList } from '@/components/rightpanel/TodoList'
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
    label: 'Projects',
    icon: Layers3,
    render: () => <ProjectsPanel />,
  },
  agent: {
    id: 'agent',
    label: 'Agent',
    icon: Activity,
    render: () => <AgentMonitor />,
  },
  commands: {
    id: 'commands',
    label: 'Commands',
    icon: Command,
    render: () => <QuickCommands />,
  },
  prompts: {
    id: 'prompts',
    label: 'Prompts',
    icon: MessageSquareText,
    render: () => <PromptManager />,
  },
  promptOptimizer: {
    id: 'promptOptimizer',
    label: 'Prompt Lab',
    icon: Sparkles,
    render: () => <PromptOptimizerPanel />,
  },
  todo: {
    id: 'todo',
    label: 'Todo',
    icon: ListTodo,
    render: () => <TodoList />,
  },
  files: {
    id: 'files',
    label: 'Files',
    icon: Files,
    render: () => <FileTree />,
  },
  search: {
    id: 'search',
    label: 'Search',
    icon: Search,
    render: () => <ProjectSearch />,
  },
  timeline: {
    id: 'timeline',
    label: 'Timeline',
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
