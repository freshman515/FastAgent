import type { TaskBundle } from './types'

export const BUILT_IN_BUNDLES: TaskBundle[] = [
  {
    id: 'task-plan',
    type: 'custom',
    name: 'Task Plan',
    description: 'Turn a rough request into scope, acceptance criteria, and an executable plan',
    branchPrefix: 'task/',
    steps: [
      {
        type: 'codex-yolo',
        name: 'Plan',
        prompt: `把下面的任务整理成可执行计划，不要编辑文件。

请包含：
- 目标 / 非目标
- 验收标准
- 需要修改或调查的模块
- 建议拆分的 worker 任务
- 风险和阻塞
- 验证方案

任务：
`,
      },
    ],
  },
  {
    id: 'agent-workflow',
    type: 'custom',
    name: 'Agent Workflow',
    description: 'Design and run a multi-agent workflow with exploration, implementation, tests, and review',
    branchPrefix: 'workflow/',
    steps: [
      {
        type: 'codex-yolo',
        name: 'Workflow',
        prompt: `为下面目标设计多 Agent 工作流，不要编辑文件。

输出：
- 阶段：探索、实现、测试、复核、收尾
- 每个阶段的输入/输出/完成条件
- 可并行 worker 与必须串行的依赖
- 每个 worker 的所有权范围
- 同步点和失败恢复方式

目标：
`,
      },
      {
        type: 'codex-yolo',
        name: 'Implement',
        prompt: `根据已确认的工作流实现你的部分。你不是代码库里唯一的会话。
不要回滚用户或其他会话的改动。

任务：
`,
      },
      {
        type: 'codex-yolo',
        name: 'Review',
        prompt: `只读复核当前工作流产物。先列问题，重点找 bug、回归、状态同步问题和缺失测试。

复核目标：
`,
      },
    ],
  },
  {
    id: 'fix-bug',
    type: 'fix-bug',
    name: 'Fix Bug',
    description: 'Investigate and fix a bug with AI assistance',
    branchPrefix: 'fix/',
    steps: [
      { type: 'claude-code', name: 'Investigate', prompt: 'Investigate the following bug and propose a fix:\n\n' },
      { type: 'terminal', name: 'Test', prompt: '' },
    ],
  },
  {
    id: 'new-feature',
    type: 'new-feature',
    name: 'New Feature',
    description: 'Plan and implement a new feature',
    branchPrefix: 'feat/',
    steps: [
      { type: 'claude-code', name: 'Implement', prompt: 'Implement the following feature:\n\n' },
      { type: 'claude-code-yolo', name: 'Tests', prompt: 'Write comprehensive tests for the feature just implemented.' },
      { type: 'terminal', name: 'Terminal', prompt: '' },
    ],
  },
  {
    id: 'task-card',
    type: 'custom',
    name: 'Task Card',
    description: 'Implement or refine canvas task cards and task-agent interactions',
    branchPrefix: 'task-card/',
    steps: [
      {
        type: 'codex-yolo',
        name: 'Task UI',
        prompt: `实现或改进画布任务卡体验。

要求：
- 支持任务标题、需求、状态、优先级/标签或等价信息。
- 高频编辑尽量在卡片内完成。
- 任务和 Agent/终端会话的绑定关系要可见。
- 覆盖空态、编辑态、运行态、完成态、失败态。
- 遵循当前代码库的画布和右侧面板风格。

任务：
`,
      },
      {
        type: 'codex-yolo',
        name: 'Workflow Test',
        prompt: `验证任务卡和 Agent 工作流是否跑通。

请检查：
- 创建任务
- 启动/绑定 Agent 会话
- 状态流转
- RESULT 报告同步
- 项目切换或画布切换后的状态一致性

任务：
`,
      },
    ],
  },
  {
    id: 'code-review',
    type: 'code-review',
    name: 'Code Review',
    description: 'Review code changes with AI',
    steps: [
      { type: 'claude-code', name: 'Review', prompt: 'Review the recent changes in this repository. Focus on:\n- Code quality\n- Security issues\n- Performance concerns\n- Test coverage\n' },
    ],
  },
  {
    id: 'release-check',
    type: 'release-check',
    name: 'Release Check',
    description: 'Pre-release verification',
    branchPrefix: 'release/',
    steps: [
      { type: 'claude-code', name: 'Changelog', prompt: 'Generate a changelog for the upcoming release based on recent commits.' },
      { type: 'terminal', name: 'Build & Test', prompt: '' },
    ],
  },
]
