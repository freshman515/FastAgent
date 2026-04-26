# FastAgents

FastAgents 是一个基于 Electron 的多智能体会话管理器，用来在同一个项目工作区里并行运行 Claude Code、Codex、Gemini、OpenCode 和普通终端。它支持经典分屏和无限画布两种工作模式，适合同时观察、编排、切换多个 AI 编码会话。

![Electron](https://img.shields.io/badge/Electron-39-47848F?logo=electron)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss)

## 功能概览

### 多智能体会话

- 支持 Claude Code、Codex、Codex YOLO、Gemini、Gemini YOLO、OpenCode 和 Terminal。
- Codex、Gemini 会话支持启动时恢复历史对话。
- 支持通过项目、Git worktree 和独立窗口组织会话。
- 支持会话重命名、置顶、关闭、导出和历史恢复。
- 会话标题栏和画布会话列表会显示对应智能体图标。

### 经典分屏模式

- 支持横向、纵向无限嵌套分屏。
- 支持标签页拖拽排序、跨 pane 移动、拖出独立窗口。
- 独立窗口关闭后会自动回到主窗口并保持运行中的 PTY。
- 支持 `Ctrl+Tab`、`Ctrl+W`、`Ctrl+1-9` 等常用标签页快捷键。

### 无限画布模式

- 会话以卡片形式显示在无限画布中，支持拖拽、缩放、排列和框选。
- 支持左侧画布会话列表，点击后聚焦对应卡片。
- 支持搜索会话，`Ctrl+F` / `Ctrl+Shift+F` 可打开搜索面板。
- 支持多选卡片后的批量移动、对齐、等距分布、删除和统一调整大小。
- 支持关系线、分组框、便签和迷你地图。
- 支持操作撤销，移动、缩放、新增、删除等画布操作可用 `Ctrl+Z` 回退。
- 支持视图书签：保存当前视图、重命名、重新录制、删除，并可用 `Alt+1-9` 快速跳转。
- 支持 `Alt+A` 平滑缩放到刚好显示所有会话卡片。

### 项目与工作区

- 支持项目分组、颜色标记和拖拽排序。
- 侧边栏显示 Git 分支、脏状态和 worktree 信息。
- 支持从菜单创建、切换和移除 Git worktree。
- 支持会话模板和任务模板，一键启动预设工作流。
- 支持匿名工作区，用于临时会话。

### Git 集成

- 自动识别 Git 仓库和当前分支。
- 支持初始化非 Git 项目。
- 支持分支创建、切换、worktree 创建和移除。
- 支持查看文件状态、diff、stage、unstage、discard 和 commit。

### 音乐模块

- 支持读取系统媒体信息。
- 支持播放、暂停、上一首、下一首控制。
- 支持网易云音乐等系统媒体源。
- 支持实时频谱和旋律可视化。

### Meta-Agent MCP

FastAgents 会为 Claude Code 会话自动注入本地 MCP 工具，使一个会话可以查看、读取、等待或创建同工作区下的其他会话。

常用工具：

| 工具 | 用途 |
| --- | --- |
| `fa_list_sessions` | 列出同工作区下的会话 |
| `fa_read_session` | 读取目标会话最近输出 |
| `fa_write_session` | 向目标会话发送输入 |
| `fa_create_session` | 创建新的 Claude Code、Codex、Gemini、OpenCode 或 Terminal 会话 |
| `fa_wait_for_idle` | 等待目标会话输出静止 |
| `fa_get_open_file` | 获取当前编辑器打开文件 |
| `fa_get_selection` | 获取当前编辑器选区 |
| `fa_get_editor_context` | 获取完整编辑器上下文 |

这些配置在应用启动和会话创建时自动完成，不需要手动修改 Claude 配置。

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

## 本地开发

### 环境要求

- Node.js 20 或更高版本
- pnpm
- Git

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

### 运行测试

```bash
pnpm test
```

## 快捷键

### 全局与经典分屏

| 快捷键 | 功能 |
| --- | --- |
| `Alt+Space` | 显示或隐藏主窗口 |
| `Ctrl+Tab` | 切换到下一个标签页 |
| `Ctrl+Shift+Tab` | 切换到上一个标签页 |
| `Ctrl+W` | 关闭当前标签页 |
| `Ctrl+Shift+T` | 恢复最近关闭的标签页 |
| `Ctrl+1-9` | 跳转到当前 pane 的第 N 个标签 |
| `Ctrl+Alt+方向键` | 在 pane 之间移动焦点 |
| `Ctrl+Shift+M` | 在经典分屏和画布模式之间切换 |
| `F2` | 重命名当前会话 |
| 鼠标中键 | 关闭标签页 |

### 无限画布

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+F` | 打开会话搜索 |
| `Ctrl+Shift+F` | 打开会话搜索 |
| `Alt+1-9` | 跳转到第 N 个画布视图 |
| `Alt+A` | 适配显示所有会话卡片 |
| `Ctrl+Z` | 撤销画布操作 |
| `Delete` / `Backspace` | 从画布移除选中卡片 |
| `Ctrl+A` | 选中所有画布卡片 |
| `Esc` | 清空选择 |
| `Ctrl+D` | 复制选中的便签 |
| `方向键` | 微调选中卡片位置 |
| `Shift+方向键` | 大步微调选中卡片位置 |
| `Ctrl+0` | 重置画布视图 |
| `Ctrl++` / `Ctrl+=` | 放大画布 |
| `Ctrl+-` | 缩小画布 |

## 项目结构

```text
src/
├── main/                  Electron 主进程
│   ├── ipc/               IPC 处理器
│   └── services/          PTY、Git、MCP、媒体、IDE 等服务
├── preload/               Context Bridge API
├── renderer/              React 渲染进程
│   ├── components/        UI 组件
│   │   ├── canvas/        无限画布、卡片、搜索、迷你地图、关系线
│   │   ├── layout/        标题栏、侧边栏、主面板、音乐模块
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

## 常见说明

- Gemini 普通会话启动命令为 `gemini`，Gemini YOLO 启动命令为 `gemini --yolo`。
- Gemini 恢复命令形如 `gemini --resume '<session-id>'`。
- Codex、Gemini 等外部 CLI 需要先在系统中安装并配置好认证。
- Windows 下建议使用 PowerShell 7 或现代终端运行相关 CLI。

## 许可证

MIT
