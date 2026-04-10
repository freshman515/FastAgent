# FastAgents

A lightweight multi-agent terminal manager built with Electron. Run multiple AI coding agents (Claude Code, Codex, OpenCode) and terminals side-by-side, organized by projects and workspaces.

![Electron](https://img.shields.io/badge/Electron-39-47848F?logo=electron)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss)

## Features

### Multi-Agent Session Management
- Run **Claude Code**, **Codex**, **OpenCode**, and **Terminal** sessions simultaneously
- Organize sessions with **split panes** (horizontal/vertical, unlimited nesting)
- **Drag & drop** tabs between panes, reorder freely
- **Pop out** any tab to an independent window (drag outside or right-click)
- Detached windows auto-reconnect to running PTY processes

### Project & Workspace Organization
- **Groups** with color coding and drag-to-reorder
- **Projects** with git branch display and dirty indicators
- **Git worktree isolation** — run multiple branches simultaneously in independent directories, each with its own sessions
- **Session templates** — save and apply preset session configurations per project
- **Task bundles** — one-click workflows (Fix Bug, New Feature, Code Review, Release Check) that auto-launch agents with prompts

### Git Integration
- Branch display in sidebar with pill badges
- Branch switching with uncommitted changes warning
- Create/switch branches from context menu
- Git worktree management (create, remove, switch)
- Auto-detect and initialize non-git projects

### Music Player
- System audio monitoring (Windows media API)
- Real-time audio spectrum visualizer (FFT-based, 1024-point)
- Two visualizer modes: flowing melody curves or spectrum bars
- Play/pause/skip controls synced with system media
- Configurable in settings (size, mode, controls visibility)

### UI
- Custom frameless window with title bar controls
- Collapsible sidebar with search
- Quick switcher (Ctrl+P)
- Toast notifications and permission dialogs
- Settings dialog with multiple pages
- Dark theme with accent colors

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Electron 39 |
| Frontend | React 19, TypeScript 5.9 |
| Styling | Tailwind CSS 4 |
| State | Zustand 5 |
| Terminal | xterm.js 6 |
| PTY | node-pty |
| Build | electron-vite, electron-builder |
| Animation | Framer Motion |

## Getting Started

### Prerequisites
- Node.js >= 20
- npm or yarn
- Git

### Install

```bash
git clone https://github.com/freshman515/FastAgent.git
cd FastAgent
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt+Space` | Toggle window visibility |
| `Ctrl+Tab` | Next tab in active pane |
| `Ctrl+Shift+Tab` | Previous tab |
| `Ctrl+W` | Close active tab |
| `Ctrl+Shift+T` | Restore last closed tab |
| `Ctrl+1-9` | Jump to Nth tab |
| `Ctrl+P` | Quick switcher |
| `Ctrl+Alt+Arrow` | Navigate between panes |
| `F2` | Rename active tab |
| Middle click | Close tab |

## Project Structure

```
src/
├── main/                  # Electron main process
│   ├── services/          # PtyManager, GitService, MediaMonitor, etc.
│   └── ipc/               # IPC handlers (session, git, media, config)
├── preload/               # Context bridge API
├── renderer/              # React frontend
│   ├── components/        # UI components
│   │   ├── layout/        # TitleBar, Sidebar, MainPanel, MusicPlayer
│   │   ├── session/       # SessionTab, SessionTabs, NewSessionMenu
│   │   ├── sidebar/       # GroupItem, ProjectItem (with worktree/branch UI)
│   │   ├── split/         # PaneView (split pane system)
│   │   ├── settings/      # SettingsDialog, TemplatesPage
│   │   └── permission/    # PermissionDialog
│   ├── stores/            # Zustand stores (sessions, projects, git, worktrees, etc.)
│   └── hooks/             # useXterm, useActivityMonitor
└── shared/                # Shared types and constants
```

## License

MIT
