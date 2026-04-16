import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildClaudeCodeArgs,
  isClaudeSessionCwdMatch,
  isClaudeSessionUuid,
  normalizeClaudeSessionPath,
} from '../.tmp-cache/claude-session-test/claudeSession.js'

const UUID = '5954439b-6795-490a-afff-68efe999e747'

test('builds fresh Claude Code command with explicit session id', () => {
  assert.deepEqual(
    buildClaudeCodeArgs('claude-code', 'session-id', UUID),
    ['--session-id', UUID],
  )
})

test('builds Claude Code YOLO resume command without dropping permission flag', () => {
  assert.deepEqual(
    buildClaudeCodeArgs('claude-code-yolo', 'resume', UUID),
    ['--dangerously-skip-permissions', '--resume', UUID],
  )
})

test('does not append resume flags for invalid UUIDs', () => {
  assert.deepEqual(
    buildClaudeCodeArgs('claude-code', 'resume', 'not-a-uuid'),
    [],
  )
})

test('validates Claude session UUID shape', () => {
  assert.equal(isClaudeSessionUuid(UUID), true)
  assert.equal(isClaudeSessionUuid('5954439b-6795-690a-afff-68efe999e747'), false)
  assert.equal(isClaudeSessionUuid(null), false)
})

test('normalizes Windows and POSIX paths consistently', () => {
  assert.equal(
    normalizeClaudeSessionPath('D:\\pragma\\MyProject\\FastAgents\\'),
    'd:/pragma/myproject/fastagents',
  )
})

test('matches Claude cwd only inside the expected workspace', () => {
  assert.equal(
    isClaudeSessionCwdMatch(
      'D:\\pragma\\MyProject\\FastAgents',
      'D:/pragma/MyProject/FastAgents',
    ),
    true,
  )
  assert.equal(
    isClaudeSessionCwdMatch(
      'D:\\pragma\\MyProject\\FastAgents',
      'D:/pragma/MyProject/FastAgents/src',
    ),
    true,
  )
  assert.equal(
    isClaudeSessionCwdMatch(
      'D:\\pragma\\MyProject\\FastAgents',
      'D:/pragma/MyProject/FastTerminal',
    ),
    false,
  )
})
