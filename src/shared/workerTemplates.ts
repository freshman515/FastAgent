import type { WorkerTemplate } from './types'

const RESULT_CONTRACT = `RESULT:
- 状态：
- 修改文件：
- 验证：
- 风险：
- 阻塞：
- 建议下一步：`

export const BUILT_IN_WORKER_TEMPLATES: WorkerTemplate[] = [
  {
    id: 'readonly-explorer',
    name: '只读调查',
    description: '调查代码、日志、调用链或失败原因，不编辑文件。',
    type: 'codex-yolo',
    defaultName: '只读调查',
    ownershipHint: '只读，不拥有写入范围',
    isolatedWorktree: false,
    resultContract: `RESULT:
- 结论：
- 证据：
- 查看过的文件：
- 置信度：
- 仍不确定的问题：`,
    prompt: `你是 FastAgents 只读调查 worker。不要编辑任何文件。

问题：
{{task}}

范围：
{{ownership}}

只返回：
RESULT:
- 结论：
- 证据：
- 查看过的文件：
- 置信度：
- 仍不确定的问题：`,
  },
  {
    id: 'code-worker',
    name: '代码实现',
    description: '在明确所有权范围内实现功能或修复问题。',
    type: 'codex-yolo',
    defaultName: '代码实现',
    ownershipHint: '例如 src/main/services/Foo.ts 或 src/renderer/components/**',
    isolatedWorktree: false,
    resultContract: RESULT_CONTRACT,
    prompt: `你是 FastAgents 代码实现 worker。你不是代码库里唯一的会话。
不要回滚用户改动，也不要回滚其他会话的改动。

你的所有权范围：
{{ownership}}

目标：
{{task}}

约束：
- 遵循代码库现有模式。
- 默认只在所有权范围内编辑。
- 如果必须扩大范围，在最终报告中说明原因和具体文件。
- 运行你能运行的最相关验证。
- 最终报告不要粘贴完整文件、大段日志或完整 diff。

最终报告：
${RESULT_CONTRACT}`,
  },
  {
    id: 'test-worker',
    name: '测试补全',
    description: '补充或修复测试，并优先覆盖回归风险。',
    type: 'codex-yolo',
    defaultName: '测试补全',
    ownershipHint: '例如 tests/**、scripts/*.test.* 或相关测试文件',
    isolatedWorktree: false,
    resultContract: RESULT_CONTRACT,
    prompt: `你是 FastAgents 测试 worker。你不是代码库里唯一的会话。
不要回滚用户改动，也不要回滚其他会话的改动。

测试目标：
{{task}}

所有权范围：
{{ownership}}

约束：
- 优先覆盖真实回归风险和边界条件。
- 不做无关重构。
- 运行相关测试或说明无法运行的原因。

最终报告：
${RESULT_CONTRACT}`,
  },
  {
    id: 'review-worker',
    name: '独立复核',
    description: '只读审查当前改动，寻找 bug、回归和缺失测试。',
    type: 'codex-yolo',
    defaultName: '独立复核',
    ownershipHint: '只读 review，可指定 diff 或目录范围',
    isolatedWorktree: false,
    resultContract: `RESULT:
- 发现的问题：
- 测试缺口：
- 剩余风险：
- 查看过的文件：`,
    prompt: `你是 FastAgents 独立 reviewer。不要编辑文件。

审查目标：
{{task}}

范围：
{{ownership}}

请重点找：
- bug
- 行为回归
- 缺失测试
- 并发或状态问题
- API 契约问题
- 集成风险

先返回问题：
RESULT:
- 发现的问题：
- 测试缺口：
- 剩余风险：
- 查看过的文件：`,
  },
]
