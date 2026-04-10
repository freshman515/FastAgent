import type { TaskBundle } from './types'

export const BUILT_IN_BUNDLES: TaskBundle[] = [
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
