# Codex App 桌面端功能对比调研

调研时间：2026-05-17
对比对象：OpenAI Codex App 桌面端 vs Pragma Desk

## 结论先看

Pragma Desk 现在的优势是多 Agent、多 CLI、经典分屏、无限画布、便签/关系线、Meta-Agent MCP 编排。Codex App 的优势更集中在“单个 Codex 任务从开始到审查、自动化、远程接管、浏览器验证”的闭环。

最值得优先借鉴的是下面 5 个方向：

| 排名 | 功能方向 | 为什么值得做 | 对 Pragma Desk 的落地方式 |
| --- | --- | --- | --- |
| 1 | Review 行内评论闭环 | 能把“看 diff”变成“精准让 Agent 修复某几行” | 在 Git diff 面板支持行内评论，评论可一键发送到指定会话 |
| 2 | Automations + Triage Inbox | 把重复检查、定时巡检、每日总结变成后台任务 | 新增自动化任务中心，结果进入收件箱 |
| 3 | 项目 Actions / Setup Scripts | 常用命令不需要重复输入，worktree 初始化也能自动化 | 每个项目配置 Run/Test/Build/Install 按钮和 worktree setup |
| 4 | 手机/网页远程控制 | 长任务需要随时审批、查看进展、补充指令 | 先做 Web Remote，支持会话查看、审批、发送输入 |
| 5 | Browser 页面标注反馈 | 前端开发时能直接点页面元素提问题 | Browser 卡片增加标注模式，生成截图/selector/评论并发送给会话 |

## 功能对比表

| 功能模块 | Codex App 最新能力 | Pragma Desk 当前能力 | 差距 | 建议优先级 |
| --- | --- | --- | --- | --- |
| 多线程/多任务工作台 | 同一项目内并行管理多个 Codex threads | 支持 Claude Code、Codex、Gemini、OpenCode、Browser、Terminal，多会话能力更强 | Pragma Desk 在多 Agent 管理上更强，但缺少统一任务生命周期视图 | 保持优势 |
| 无限画布 | 官方文档未突出无限画布形态 | 已有无限画布、卡片、分组、便签、关系线、书签、搜索 | 这是 Pragma Desk 的明显差异化能力 | 保持优势 |
| Review 面板 | 支持未提交变更、分支变更、最近一轮变更；支持行内评论和 PR review 上下文 | 有 Git 面板、diff、stage/unstage/commit，也有 AI review 能力 | 缺少行内评论和“评论发送给 Agent 修复”的闭环 | P0 |
| Automations | 支持定时/cron 后台任务，结果进入 Triage；Git 项目可跑在独立 worktree | 暂无正式自动化任务中心 | 缺少定时任务、自动运行记录、结果收件箱 | P0 |
| Worktree 任务隔离 | 新建 thread 可选择 Local 或 Worktree；支持 handoff 到 Local | 支持 Git worktree 创建、切换、移除，并按 worktree 组织会话 | 缺少线程级 handoff 和“这个任务属于哪个 worktree”的明确状态流 | P1 |
| 项目 Actions | Local Environments 可配置 setup scripts 和常用 actions，显示在顶部 | 主要通过终端手动运行命令 | 缺少项目级快捷动作和新 worktree 自动初始化 | P0 |
| 内置终端上下文 | 每个 thread 有项目/worktree 作用域终端，Codex 可读取终端输出 | 每个会话本身就是终端，且支持多 CLI | Pragma Desk 终端更强，但可增强“把终端输出摘要作为上下文发送给 Agent” | P1 |
| In-app Browser | 可预览本地页面，支持 browser comments 和本地页面操作 | 有 Browser 会话 | 缺少页面元素标注、截图反馈、DOM selector 上下文 | P1 |
| Chrome 扩展 | 可用用户登录态的 Chrome，并管理网站 allowlist/blocklist | 暂无 Chrome profile/扩展接管 | 对登录态网页自动化能力弱 | P2 |
| Computer Use | macOS 可让 Codex 操作桌面 GUI App | 暂无系统级 GUI 操作 | 实现成本高，权限风险高；短期不建议追 | P3 |
| 手机远程控制 | ChatGPT 手机端可连接 Codex host，查看线程、审批命令、看 diff/test/terminal/screenshot | 暂无手机端/网页端远程控制 | 长任务离开电脑后不可控 | P0 |
| Remote SSH | Codex App 可通过 SSH 连接远程项目，命令和文件操作在远端执行 | 有本地/WSL 会话；未见完整 Remote SSH 项目模型 | 缺少远程主机项目、远程文件树、远程 shell 统一管理 | P1 |
| IDE Sync / Auto Context | App 与 IDE Extension 同项目同步，可读取当前 IDE 文件上下文 | 有内置编辑器和 Claude IDE bridge，MCP 可读编辑器上下文 | 缺少 VS Code/Cursor 等外部 IDE 同步 | P1 |
| Artifacts | 侧栏可展示计划、来源、总结、生成文件预览；支持 PDF、表格、文档、演示稿 | 有文件卡片、编辑器、目录卡片 | 缺少“每个任务生成了什么”的产物聚合视图 | P1 |
| Deep links | 支持 `codex://settings`、`codex://new`、`codex://threads/<id>` 等 | 未形成公开 deep link 协议 | 外部脚本/浏览器/README 难以一键创建任务 | P1 |
| Slash commands | 有 `/review`、`/status`、`/plan-mode`、`/mcp` 等 | Claude GUI 有 slash/skills 相关能力，普通 CLI 依赖各自工具 | Pragma Desk 可以做跨 Agent 的统一命令面板 | P1 |
| Skills / Plugins / MCP | Codex App、CLI、IDE 共用配置；支持插件、skills、MCP | 已有插件 manifest、技能发现、Meta-Agent MCP | 需要更产品化的插件市场/启用状态/诊断面板 | P1 |
| Memories / 个性化 | 支持 personality、自定义指令、Memories、context-aware suggestions | 有 AGENTS.md、设置和会话备注，但没有统一记忆系统 | 缺少跨会话长期记忆和“建议继续做什么” | P2 |
| 外观主题 | 支持主题、字体、颜色、宠物浮层 | Pragma Desk 已有大量 UI 设置 | 不是核心差距 | P3 |

## 推荐路线图

### P0：最先做，能明显提升工作流

| 功能 | 最小可用版本 | 依赖 |
| --- | --- | --- |
| Git diff 行内评论 | 在 GitChanges diff 行上添加评论按钮，评论列表可发送到指定会话 | Git 面板、会话发送输入 |
| 自动化任务中心 | 新建任务：项目、worktree、会话类型、prompt、周期；运行结果进入 Inbox | 配置存储、后台调度、会话创建 |
| 项目 Actions | 项目设置里配置常用命令，顶部/右键一键运行到终端 | 项目配置、PTY |
| Web Remote | 本机启动一个受 token 保护的本地 Web 控制页 | 会话列表、终端输出、输入发送、审批状态 |

### P1：做完 P0 后继续增强

| 功能 | 最小可用版本 | 依赖 |
| --- | --- | --- |
| Browser 标注反馈 | 在 Browser 卡片里点选区域，保存截图和评论，发送到会话 | Browser webview、截图、坐标/selector |
| Worktree Handoff | 会话绑定 worktree，支持“移入/移出主工作区”的操作指引 | Git worktree、会话元数据 |
| Artifact 面板 | 聚合某个会话新增/修改文件、测试结果、摘要 | Git diff、会话日志解析 |
| Deep links | 注册 `pragma-desk://new?path=&prompt=` | Electron protocol |
| Remote SSH 项目 | 添加 SSH host，远端文件树和远端终端 | SSH 配置解析、远端命令执行 |

### P2/P3：可以以后再考虑

| 功能 | 原因 |
| --- | --- |
| Chrome 扩展接管 | 价值高，但安全边界、浏览器权限、登录态隔离都复杂 |
| Memories | 需要先设计数据边界，否则容易变成不可控上下文污染 |
| Computer Use | 实现成本高，而且和 Pragma Desk 当前“多 Agent 工作台”主线不完全一致 |
| 宠物/浮层 | Codex App 有趣，但对核心生产力提升有限 |

## 官方来源

- Codex App 概览：https://developers.openai.com/codex/app
- Codex App Features：https://developers.openai.com/codex/app/features
- Review：https://developers.openai.com/codex/app/review
- Automations：https://developers.openai.com/codex/app/automations
- Worktrees：https://developers.openai.com/codex/app/worktrees
- Local Environments：https://developers.openai.com/codex/app/local-environments
- In-app Browser：https://developers.openai.com/codex/app/in-app-browser
- Chrome Extension：https://developers.openai.com/codex/app/chrome-extension
- Computer Use：https://developers.openai.com/codex/app/computer-use
- Remote Connections：https://developers.openai.com/codex/remote-connections
- 2026-05-14 发布说明：https://openai.com/index/work-with-codex-from-anywhere/
