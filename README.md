# FastAgents

FastAgents 是一个面向 AI Coding 的多 Agent 会话管理工具。

它把 Claude Code、Codex、Gemini、OpenCode、浏览器和普通终端放进同一个项目工作区里，让你可以用经典分屏或无限画布同时管理多个会话、多个任务和多个开发上下文。

> 当前版本支持 Windows，并开始提供 macOS 安装包。WSL 会话、系统媒体控制和语音输入是 Windows 专属能力。

![Electron](https://img.shields.io/badge/Electron-39-47848F?logo=electron)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)
![Windows](https://img.shields.io/badge/Platform-Windows-0078D4?logo=windows)
![macOS](https://img.shields.io/badge/Platform-macOS-000000?logo=apple)

## 为什么做 FastAgents

使用 AI Coding 时，真正麻烦的地方通常不是启动一个 Agent，而是同时管理很多 Agent。

当你有多个想法、多个分支、多个任务并行推进时，经常会遇到这些问题：

- 不同 Agent 分散在多个窗口里，切换成本高。
- 多个任务上下文混在一起，很难知道每个会话在做什么。
- 终端、浏览器、文件、Git 信息和 AI 回复分散在不同 App 里。
- 同时跑多个功能开发时，需要更清晰的分屏、分组和工作区隔离。

FastAgents 的目标是把这些东西放回同一个工作台里，让你更容易并行调度多个 Agent。

## 核心功能

### 多 Agent 会话管理

- 支持 Claude Code、Codex、Gemini、OpenCode、Browser 和 Terminal。
- 支持 Codex / Claude / Gemini 等历史会话恢复。
- 支持按项目、worktree 和会话类型组织工作区。
- 支持会话重命名、置顶、关闭、导出和重新打开。
- 支持把会话拖出为独立窗口，关闭独立窗口后会话仍可回到主窗口。

### 经典分屏模式

经典模式适合习惯终端、tmux、IDE 分屏的人。

- 支持横向、纵向嵌套分屏。
- 支持标签页拖拽排序、跨 pane 移动和拖拽分屏。
- 支持紧凑预设、经典 pane 样式和现代 pane 样式。
- 支持圆角标签页和直角标签页两套样式。
- 支持按会话类型整理标签页，例如终端、Claude、Codex、Browser 等。
- 支持智能分屏：把同类会话自动放到同一个 pane。
- 支持 `Alt+F` 进入 pane 控制模式，用方向键或 `h/j/k/l` 快速切换和调整 pane。

### 无限画布模式

画布模式适合同时观察大量 Agent，把任务按区域拆开管理。

- 每个会话都可以变成一张卡片，放在无限画布中自由排列。
- 支持卡片拖拽、缩放、聚焦、最大化和方向导航。
- 支持分组/工作区，把相关卡片放在同一个任务空间里。
- 分组支持颜色、重命名、折叠、组内整理、组内搜索和快照。
- 拖动卡片进入分组时，分组会动态扩展并包裹卡片。
- 移动分组时，会自动带动组内卡片。
- 支持画布搜索、最近访问、书签视图和快速聚焦。
- 支持卡片拖拽或缩放到视图边缘时自动平移画布。

### 项目与 Git 工作区

- 支持项目列表、项目分组和颜色标记。
- 自动识别 Git 仓库、当前分支和工作区状态。
- 支持创建、切换和移除 Git worktree。
- 支持文件状态、diff、stage、unstage、discard 和 commit。
- 适合把不同功能开发放到不同 worktree 中并行推进。

### Meta-Agent MCP

FastAgents 会给 Claude Code 会话自动注入本地 MCP 工具，让一个 Agent 可以查看和操作同工作区下的其他会话。

常用能力包括：

- 列出当前工作区的所有 session。
- 读取其他 session 的最近输出。
- 向其他 session 发送输入。
- 创建新的 Claude Code、Codex、Gemini、OpenCode 或 Terminal 会话。
- 等待某个 session 输出静止。
- 读取当前编辑器打开文件、选区和上下文。

这让 FastAgents 不只是一个终端管理器，而是一个可以让 Agent 之间互相协作的本地工作台。

## 适合谁

FastAgents 更适合这些场景：

- 同时使用多个 AI Coding CLI。
- 经常让多个 Agent 并行处理不同任务。
- 需要在多个 Git 分支或 worktree 之间切换。
- 希望把终端、浏览器、任务笔记和 Agent 回复放在同一个地方。
- 喜欢 tmux / IDE 分屏，但又需要更强的可视化画布。

## 快速开始

### 下载安装

前往 GitHub Releases 下载对应系统的安装包：

- Windows：`FastAgents-Setup-x.y.z.exe`
- macOS Intel：`FastAgents-x.y.z-x64.dmg`
- macOS Apple Silicon：`FastAgents-x.y.z-arm64.dmg`

macOS 版本目前未做 Apple Developer ID 签名和公证，首次打开时可能需要在 Finder 中右键选择“打开”，或在系统设置的“隐私与安全性”中允许打开。

### 开发环境要求

- Windows 或 macOS
- Node.js 20 或更高版本
- pnpm
- Git
- 已安装并登录需要使用的 AI CLI，例如 Claude Code、Codex、Gemini 或 OpenCode

### 安装依赖

```bash
git clone https://github.com/freshman515/FastAgent.git
cd FastAgent
pnpm install
```

### 启动开发环境

```bash
pnpm dev
```

### 构建

```bash
pnpm build
```

### 打包

```bash
# Windows
pnpm run dist:win

# macOS，需要在 macOS 环境执行
pnpm run dist:mac
```

### 运行测试

```bash
pnpm test
```

## 常用快捷键

### 全局

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+Shift+M` | 在经典模式和画布模式之间切换 |
| `Ctrl+F` / `Ctrl+Shift+F` | 搜索会话、卡片、分组和备注 |
| `F2` | 重命名当前会话 |

### 经典分屏

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+Tab` | 切换到下一个标签页 |
| `Ctrl+Shift+Tab` | 切换到上一个标签页 |
| `Ctrl+W` | 关闭当前标签页 |
| `Ctrl+Shift+T` | 恢复最近关闭的标签页 |
| `Ctrl+1-9` | 跳转到当前 pane 的第 N 个标签 |
| `Ctrl+H` / `Ctrl+L` | 切换当前 pane 内左侧或右侧标签 |
| `Alt+F` | 进入 pane 控制模式 |
| `Alt+方向键` / `Alt+h/j/k/l` | 在 pane 之间按物理方向切换 |
| `Ctrl+方向键` / `Ctrl+h/j/k/l` | 调整当前 pane 大小 |

### 无限画布

| 快捷键 | 功能 |
| --- | --- |
| `Alt+方向键` / `Alt+h/j/k/l` | 按空间方向切换卡片焦点 |
| `Alt+1-9` | 跳转到画布书签视图 |
| `Alt+A` | 适配显示所有卡片 |
| `Ctrl+Z` | 撤销画布操作 |
| `Delete` / `Backspace` | 移除选中卡片 |
| `Ctrl+A` | 选中所有画布卡片 |
| `Esc` | 清空选择 |
| `Ctrl+0` | 重置画布视图 |
| `Ctrl++` / `Ctrl+=` | 放大画布 |
| `Ctrl+-` | 缩小画布 |

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面框架 | Electron 39 |
| 前端 | React 19、TypeScript 5.9 |
| 样式 | Tailwind CSS 4 |
| 状态管理 | Zustand 5 |
| 终端 | xterm.js 6 |
| PTY | node-pty |
| 构建 | electron-vite、electron-builder |
| 动画 | Framer Motion |

## 项目结构

```text
src/
├── main/                  Electron 主进程
│   ├── ipc/               IPC 处理器
│   └── services/          PTY、Git、MCP、媒体、IDE 等服务
├── preload/               Context Bridge API
├── renderer/              React 渲染进程
│   ├── components/        UI 组件
│   │   ├── canvas/        无限画布、卡片、分组、搜索、迷你地图
│   │   ├── layout/        标题栏、侧边栏、主面板
│   │   ├── session/       会话标签、终端、创建菜单
│   │   ├── settings/      设置页
│   │   ├── sidebar/       项目、分组、历史会话
│   │   └── split/         经典分屏系统
│   ├── hooks/             xterm、活动检测等 hooks
│   ├── lib/               工具函数和会话辅助逻辑
│   ├── stores/            Zustand 状态
│   └── styles/            全局样式
└── shared/                共享类型和常量
```

## 说明

- 外部 AI CLI 需要先在系统中安装并完成登录。
- Gemini 普通会话启动命令为 `gemini`，Gemini YOLO 启动命令为 `gemini --yolo`。
- Codex、Claude Code、Gemini、OpenCode 的具体能力取决于本机安装版本。
- macOS 版本支持普通 Terminal、Claude Code、Codex、Gemini、OpenCode、Browser 和 Claude GUI。`Terminal(WSL)`、`Codex(WSL)`、`Claude Code(WSL)` 仅在 Windows 显示和可用。
- macOS 安装包由 GitHub Actions 的 macOS runner 构建；本地 Windows 环境无法直接生成可发布的 `.dmg`。

## 许可证

MIT
