import { create } from 'zustand'
import { generateId } from '@/lib/utils'
import type {
  ClaudeGuiComputeMode,
  ClaudeGuiEvent,
  ClaudeGuiImagePayload,
  ClaudeGuiLanguage,
  ClaudeGuiPermissionMode,
  ClaudeGuiUsage,
} from '@shared/types'

export type ClaudeGuiMessageKind =
  | 'user'
  | 'assistant'
  | 'thinking'
  | 'tool-use'
  | 'tool-result'
  | 'system'
  | 'error'
  | 'stats'

export interface ClaudeGuiMessage {
  id: string
  kind: ClaudeGuiMessageKind
  createdAt: number
  text?: string
  messageId?: string
  toolUseId?: string
  toolName?: string
  rawInput?: unknown
  status?: string
  hidden?: boolean
  isError?: boolean
  attachments?: string[]
  meta?: Record<string, unknown>
}

export interface ClaudeGuiPreferences {
  selectedModel: string
  computeMode: ClaudeGuiComputeMode
  permissionMode: ClaudeGuiPermissionMode
  planMode: boolean
  thinkingMode: boolean
  messageTextSize: 'md' | 'lg' | 'xl'
  includeEditorContext: boolean
  languageMode: boolean
  language: ClaudeGuiLanguage | null
  onlyCommunicate: boolean
}

export interface ClaudeGuiPatchFile {
  id: string
  filePath: string
  relativePath: string
  fileName: string
  language: string
  beforeContent: string
  afterContent: string
}

export interface ClaudeGuiPatchReview {
  id: string
  requestId: string
  toolUseId: string
  toolName: string
  createdAt: number
  files: ClaudeGuiPatchFile[]
}

export interface ClaudeGuiConversation {
  id: string
  scopeKey: string
  projectId: string | null
  worktreeId?: string | null
  cwd: string
  title: string
  pinned: boolean
  group: string | null
  sessionId: string | null
  status: 'idle' | 'running' | 'error'
  createdAt: number
  updatedAt: number
  messages: ClaudeGuiMessage[]
  preferences: ClaudeGuiPreferences
  patchReviews: ClaudeGuiPatchReview[]
  totalCost: number
  totalTokensInput: number
  totalTokensOutput: number
  requestCount: number
  lastRequestCost: number
  lastRequestDuration: number
  lastRequestInputTokens: number
  lastRequestOutputTokens: number
  availableTools: string[]
  availableSkills: string[]
  liveUsage: ClaudeGuiUsage | null
  currentRequestId: string | null
}

export interface ClaudeGuiRequestPayload {
  requestId: string
  conversationId: string
  cwd: string
  displayText: string
  effectiveText: string
  attachments: string[]
  images: ClaudeGuiImagePayload[]
  preferences: ClaudeGuiPreferences
  createdAt: number
}

export interface ClaudeGuiSlashCommandUsage {
  count: number
  lastUsedAt: number
}

interface PendingPatchSnapshotFile {
  filePath: string
  relativePath: string
  fileName: string
  language: string
  beforeContent: string
}

interface PendingPatchSnapshot {
  conversationId: string
  requestId: string
  toolUseId: string
  toolName: string
  createdAt: number
  files: PendingPatchSnapshotFile[]
}

const DEFAULT_PREFERENCES: ClaudeGuiPreferences = {
  selectedModel: 'claude-sonnet-4-6',
  computeMode: 'auto',
  permissionMode: 'default',
  planMode: false,
  thinkingMode: false,
  messageTextSize: 'lg',
  includeEditorContext: true,
  languageMode: true,
  language: 'zh',
  onlyCommunicate: false,
}

const MAX_CONVERSATIONS = 40
const MAX_MESSAGES = 500
const MAX_PATCH_REVIEWS = 20

type PersistedState = {
  conversations: ClaudeGuiConversation[]
  selectedConversationByScope: Record<string, string>
  preferences: ClaudeGuiPreferences
  slashCommandUsage?: Record<string, ClaudeGuiSlashCommandUsage>
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
let lastPersistedSlashCommandUsage: Record<string, ClaudeGuiSlashCommandUsage> = {}

function persist(state: PersistedState): void {
  if (window.api.detach.isDetached) return
  if (persistTimer) clearTimeout(persistTimer)
  const payload: PersistedState = {
    ...state,
    slashCommandUsage: state.slashCommandUsage ?? lastPersistedSlashCommandUsage,
  }
  lastPersistedSlashCommandUsage = payload.slashCommandUsage ?? {}
  persistTimer = setTimeout(() => {
    window.api.config.write('claudeGui', payload)
  }, 150)
}

function trimMessages(messages: ClaudeGuiMessage[]): ClaudeGuiMessage[] {
  return messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages
}

function trimPatchReviews(reviews: ClaudeGuiPatchReview[]): ClaudeGuiPatchReview[] {
  return reviews.length > MAX_PATCH_REVIEWS ? reviews.slice(-MAX_PATCH_REVIEWS) : reviews
}

function scopeKey(projectId: string | null, worktreeId?: string | null): string {
  return `${projectId ?? '__none__'}::${worktreeId ?? '__main__'}`
}

function sanitizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === 'string')
}

function sanitizePreferences(raw: unknown, fallback: ClaudeGuiPreferences): ClaudeGuiPreferences {
  if (!raw || typeof raw !== 'object') return { ...fallback }
  const value = raw as Partial<ClaudeGuiPreferences>
  return {
    selectedModel: typeof value.selectedModel === 'string' ? value.selectedModel : fallback.selectedModel,
    computeMode: value.computeMode === 'max' ? 'max' : fallback.computeMode,
    permissionMode: value.permissionMode === 'plan'
      || value.permissionMode === 'acceptEdits'
      || value.permissionMode === 'bypassPermissions'
      || value.permissionMode === 'dontAsk'
      ? value.permissionMode
      : fallback.permissionMode,
    planMode: value.planMode === true,
    thinkingMode: value.thinkingMode === true,
    messageTextSize: value.messageTextSize === 'md' || value.messageTextSize === 'xl'
      ? value.messageTextSize
      : fallback.messageTextSize,
    includeEditorContext: typeof value.includeEditorContext === 'boolean'
      ? value.includeEditorContext
      : fallback.includeEditorContext,
    languageMode: typeof value.languageMode === 'boolean' ? value.languageMode : fallback.languageMode,
    language: typeof value.language === 'string' ? value.language : fallback.language,
    onlyCommunicate: value.onlyCommunicate === true,
  }
}

function sanitizeSlashCommandUsage(raw: unknown): Record<string, ClaudeGuiSlashCommandUsage> {
  if (!raw || typeof raw !== 'object') return {}

  const usageEntries = Object.entries(raw as Record<string, unknown>)
    .filter((entry): entry is [string, Record<string, unknown>] => (
      typeof entry[0] === 'string'
      && entry[1] !== null
      && typeof entry[1] === 'object'
    ))
    .map(([key, value]) => {
      const count = typeof value.count === 'number' && Number.isFinite(value.count) ? Math.max(0, value.count) : 0
      const lastUsedAt = typeof value.lastUsedAt === 'number' && Number.isFinite(value.lastUsedAt) ? value.lastUsedAt : 0
      return [key, { count, lastUsedAt }] as const
    })
    .filter(([, value]) => value.count > 0 && value.lastUsedAt > 0)

  return Object.fromEntries(usageEntries)
}

function sanitizePatchFile(raw: unknown): ClaudeGuiPatchFile | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (
    typeof value.id !== 'string'
    || typeof value.filePath !== 'string'
    || typeof value.relativePath !== 'string'
    || typeof value.fileName !== 'string'
    || typeof value.language !== 'string'
    || typeof value.beforeContent !== 'string'
    || typeof value.afterContent !== 'string'
  ) {
    return null
  }

  return {
    id: value.id,
    filePath: value.filePath,
    relativePath: value.relativePath,
    fileName: value.fileName,
    language: value.language,
    beforeContent: value.beforeContent,
    afterContent: value.afterContent,
  }
}

function sanitizePatchReview(raw: unknown): ClaudeGuiPatchReview | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (
    typeof value.id !== 'string'
    || typeof value.requestId !== 'string'
    || typeof value.toolUseId !== 'string'
    || typeof value.toolName !== 'string'
    || typeof value.createdAt !== 'number'
  ) {
    return null
  }

  const files = Array.isArray(value.files)
    ? value.files.map(sanitizePatchFile).filter((file): file is ClaudeGuiPatchFile => file !== null)
    : []

  return {
    id: value.id,
    requestId: value.requestId,
    toolUseId: value.toolUseId,
    toolName: value.toolName,
    createdAt: value.createdAt,
    files,
  }
}

function sanitizeMessage(raw: unknown): ClaudeGuiMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (typeof value.id !== 'string' || typeof value.kind !== 'string' || typeof value.createdAt !== 'number') {
    return null
  }

  return {
    id: value.id,
    kind: value.kind as ClaudeGuiMessageKind,
    createdAt: value.createdAt,
    text: typeof value.text === 'string' ? value.text : undefined,
    messageId: typeof value.messageId === 'string' ? value.messageId : undefined,
    toolUseId: typeof value.toolUseId === 'string' ? value.toolUseId : undefined,
    toolName: typeof value.toolName === 'string' ? value.toolName : undefined,
    rawInput: value.rawInput,
    status: typeof value.status === 'string' ? value.status : undefined,
    hidden: value.hidden === true,
    isError: value.isError === true,
    attachments: sanitizeStringArray(value.attachments),
    meta: value.meta && typeof value.meta === 'object' ? value.meta as Record<string, unknown> : undefined,
  }
}

function sanitizeConversation(raw: unknown, defaultPreferences: ClaudeGuiPreferences): ClaudeGuiConversation | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (
    typeof value.id !== 'string'
    || typeof value.scopeKey !== 'string'
    || typeof value.cwd !== 'string'
    || typeof value.createdAt !== 'number'
    || typeof value.updatedAt !== 'number'
  ) {
    return null
  }

  const messages = Array.isArray(value.messages)
    ? value.messages.map(sanitizeMessage).filter((message): message is ClaudeGuiMessage => message !== null)
    : []

  const patchReviews = Array.isArray(value.patchReviews)
    ? value.patchReviews.map(sanitizePatchReview).filter((item): item is ClaudeGuiPatchReview => item !== null)
    : []

  const liveUsage = value.liveUsage && typeof value.liveUsage === 'object'
    ? value.liveUsage as ClaudeGuiUsage
    : null

  return {
    id: value.id,
    scopeKey: value.scopeKey,
    projectId: typeof value.projectId === 'string' ? value.projectId : null,
    worktreeId: typeof value.worktreeId === 'string' ? value.worktreeId : null,
    cwd: value.cwd,
    title: typeof value.title === 'string' ? value.title : 'Claude Code Chat',
    pinned: value.pinned === true,
    group: typeof value.group === 'string' && value.group.trim() ? value.group.trim() : null,
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : null,
    status: value.status === 'running' || value.status === 'error' ? value.status : 'idle',
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    messages,
    preferences: sanitizePreferences(value.preferences, defaultPreferences),
    patchReviews: trimPatchReviews(patchReviews),
    totalCost: typeof value.totalCost === 'number' ? value.totalCost : 0,
    totalTokensInput: typeof value.totalTokensInput === 'number' ? value.totalTokensInput : 0,
    totalTokensOutput: typeof value.totalTokensOutput === 'number' ? value.totalTokensOutput : 0,
    requestCount: typeof value.requestCount === 'number' ? value.requestCount : 0,
    lastRequestCost: typeof value.lastRequestCost === 'number' ? value.lastRequestCost : 0,
    lastRequestDuration: typeof value.lastRequestDuration === 'number' ? value.lastRequestDuration : 0,
    lastRequestInputTokens: typeof value.lastRequestInputTokens === 'number' ? value.lastRequestInputTokens : 0,
    lastRequestOutputTokens: typeof value.lastRequestOutputTokens === 'number' ? value.lastRequestOutputTokens : 0,
    availableTools: sanitizeStringArray(value.availableTools),
    availableSkills: sanitizeStringArray(value.availableSkills),
    liveUsage,
    currentRequestId: typeof value.currentRequestId === 'string' ? value.currentRequestId : null,
  }
}

function upsertTextMessage(
  messages: ClaudeGuiMessage[],
  kind: 'assistant' | 'thinking' | 'system',
  messageId: string,
  text: string,
): ClaudeGuiMessage[] {
  const existing = messages.find((message) => message.kind === kind && message.messageId === messageId)
  if (!existing) {
    return trimMessages([
      ...messages,
      { id: `claude-msg-${generateId()}`, kind, createdAt: Date.now(), text, messageId },
    ])
  }

  return messages.map((message) => (
    message.id === existing.id
      ? { ...message, text: `${message.text ?? ''}${text}` }
      : message
  ))
}

function deriveTitle(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.slice(0, 48) || 'Claude Code Chat'
}

interface ClaudeGuiState {
  conversations: ClaudeGuiConversation[]
  selectedConversationByScope: Record<string, string>
  preferences: ClaudeGuiPreferences
  slashCommandUsage: Record<string, ClaudeGuiSlashCommandUsage>
  requestPayloads: Record<string, ClaudeGuiRequestPayload>
  pendingPatchSnapshots: Record<string, PendingPatchSnapshot>
  _loadFromConfig: (raw: Record<string, unknown>) => void
  recordSlashCommandUsage: (usageKey: string) => void
  updatePreferences: (updates: Partial<ClaudeGuiPreferences>) => void
  updateConversationPreferences: (conversationId: string, updates: Partial<ClaudeGuiPreferences>) => void
  updateConversationMeta: (conversationId: string, updates: { title?: string; pinned?: boolean; group?: string | null }) => void
  createConversation: (context: {
    projectId: string | null
    worktreeId?: string | null
    cwd: string
    scopeKey?: string
    title?: string
  }) => string
  cloneConversation: (
    conversationId: string,
    context: {
      projectId: string | null
      worktreeId?: string | null
      cwd: string
      scopeKey: string
    },
  ) => string | null
  selectConversation: (scopeId: string, conversationId: string | null) => void
  removeConversation: (conversationId: string) => void
  beginRequest: (
    conversationId: string,
    payload: { requestId: string; text: string; attachments?: string[]; meta?: Record<string, unknown> },
  ) => string | null
  registerRequestPayload: (payload: ClaudeGuiRequestPayload) => void
  clearRequestPayload: (requestId: string) => void
  capturePatchSnapshot: (payload: PendingPatchSnapshot) => void
  finalizePatchSnapshot: (payload: {
    conversationId: string
    requestId: string
    toolUseId: string
    isError: boolean
    files: Array<{
      filePath: string
      afterContent: string
    }>
  }) => void
  dismissPatchReview: (conversationId: string, reviewId: string) => void
  dismissPatchReviewFile: (conversationId: string, reviewId: string, filePath: string) => void
  applyEvent: (event: ClaudeGuiEvent) => void
}

export const useClaudeGuiStore = create<ClaudeGuiState>((set, get) => ({
  conversations: [],
  selectedConversationByScope: {},
  preferences: DEFAULT_PREFERENCES,
  slashCommandUsage: {},
  requestPayloads: {},
  pendingPatchSnapshots: {},

  _loadFromConfig: (raw) => {
    const inputPreferences = raw.preferences && typeof raw.preferences === 'object'
      ? raw.preferences as Partial<ClaudeGuiPreferences>
      : {}
    const preferences = {
      ...DEFAULT_PREFERENCES,
      ...inputPreferences,
    }
    const conversations = Array.isArray(raw.conversations)
      ? raw.conversations
        .map((item) => sanitizeConversation(item, preferences))
        .filter((item): item is ClaudeGuiConversation => item !== null)
      : []
    const selectedConversationByScope = raw.selectedConversationByScope && typeof raw.selectedConversationByScope === 'object'
      ? Object.fromEntries(
        Object.entries(raw.selectedConversationByScope as Record<string, unknown>)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      )
      : {}
    const slashCommandUsage = sanitizeSlashCommandUsage(raw.slashCommandUsage)
    lastPersistedSlashCommandUsage = slashCommandUsage

    set({
      conversations: conversations.slice(0, MAX_CONVERSATIONS),
      selectedConversationByScope,
      preferences,
      slashCommandUsage,
      requestPayloads: {},
      pendingPatchSnapshots: {},
    })
  },

  recordSlashCommandUsage: (usageKey) => set((state) => {
    const normalizedKey = usageKey.trim()
    if (!normalizedKey) return state

    const existing = state.slashCommandUsage[normalizedKey]
    const slashCommandUsage = {
      ...state.slashCommandUsage,
      [normalizedKey]: {
        count: (existing?.count ?? 0) + 1,
        lastUsedAt: Date.now(),
      },
    }

    persist({
      conversations: state.conversations,
      selectedConversationByScope: state.selectedConversationByScope,
      preferences: state.preferences,
      slashCommandUsage,
    })

    return { slashCommandUsage }
  }),

  updatePreferences: (updates) => set((state) => {
    const preferences = { ...state.preferences, ...updates }
    persist({
      conversations: state.conversations,
      selectedConversationByScope: state.selectedConversationByScope,
      preferences,
    })
    return { preferences }
  }),

  updateConversationPreferences: (conversationId, updates) => set((state) => {
    const conversations = state.conversations.map((conversation) => (
      conversation.id === conversationId
        ? { ...conversation, preferences: { ...conversation.preferences, ...updates }, updatedAt: Date.now() }
        : conversation
    ))
    persist({
      conversations,
      selectedConversationByScope: state.selectedConversationByScope,
      preferences: state.preferences,
    })
    return { conversations }
  }),

  updateConversationMeta: (conversationId, updates) => set((state) => {
    const conversations = state.conversations.map((conversation) => {
      if (conversation.id !== conversationId) return conversation
      return {
        ...conversation,
        title: typeof updates.title === 'string' && updates.title.trim() ? updates.title.trim() : conversation.title,
        pinned: typeof updates.pinned === 'boolean' ? updates.pinned : conversation.pinned,
        group: updates.group === undefined
          ? conversation.group
          : (typeof updates.group === 'string' && updates.group.trim() ? updates.group.trim() : null),
        updatedAt: Date.now(),
      }
    })

    persist({
      conversations,
      selectedConversationByScope: state.selectedConversationByScope,
      preferences: state.preferences,
    })
    return { conversations }
  }),

  createConversation: (context) => {
    const state = get()
    const id = `claude-conv-${generateId()}`
    const nextScopeKey = context.scopeKey ?? scopeKey(context.projectId, context.worktreeId)
    const conversation: ClaudeGuiConversation = {
      id,
      scopeKey: nextScopeKey,
      projectId: context.projectId,
      worktreeId: context.worktreeId ?? null,
      cwd: context.cwd,
      title: context.title ?? 'Claude Code Chat',
      pinned: false,
      group: null,
      sessionId: null,
      status: 'idle',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      preferences: { ...state.preferences },
      patchReviews: [],
      totalCost: 0,
      totalTokensInput: 0,
      totalTokensOutput: 0,
      requestCount: 0,
      lastRequestCost: 0,
      lastRequestDuration: 0,
      lastRequestInputTokens: 0,
      lastRequestOutputTokens: 0,
      availableTools: [],
      availableSkills: [],
      liveUsage: null,
      currentRequestId: null,
    }

    set((current) => {
      const conversations = [conversation, ...current.conversations].slice(0, MAX_CONVERSATIONS)
      const selectedConversationByScope = {
        ...current.selectedConversationByScope,
        [nextScopeKey]: id,
      }
      persist({ conversations, selectedConversationByScope, preferences: current.preferences })
      return { conversations, selectedConversationByScope }
    })

    return id
  },

  cloneConversation: (conversationId, context) => {
    const source = get().conversations.find((conversation) => conversation.id === conversationId)
    if (!source) return null

    const id = `claude-conv-${generateId()}`
    const conversation: ClaudeGuiConversation = {
      ...source,
      id,
      scopeKey: context.scopeKey,
      projectId: context.projectId,
      worktreeId: context.worktreeId ?? null,
      cwd: context.cwd,
      status: 'idle',
      sessionId: source.sessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      liveUsage: null,
      currentRequestId: null,
      messages: source.messages.map((message) => ({
        ...message,
        id: `claude-msg-${generateId()}`,
      })),
      patchReviews: source.patchReviews.map((review) => ({
        ...review,
        id: `claude-patch-${generateId()}`,
        files: review.files.map((file) => ({ ...file, id: `claude-patch-file-${generateId()}` })),
      })),
    }

    set((state) => {
      const conversations = [conversation, ...state.conversations].slice(0, MAX_CONVERSATIONS)
      const selectedConversationByScope = {
        ...state.selectedConversationByScope,
        [context.scopeKey]: id,
      }
      persist({ conversations, selectedConversationByScope, preferences: state.preferences })
      return { conversations, selectedConversationByScope }
    })

    return id
  },

  selectConversation: (scopeId, conversationId) => set((state) => {
    const selectedConversationByScope = { ...state.selectedConversationByScope }
    if (conversationId) selectedConversationByScope[scopeId] = conversationId
    else delete selectedConversationByScope[scopeId]

    persist({
      conversations: state.conversations,
      selectedConversationByScope,
      preferences: state.preferences,
    })
    return { selectedConversationByScope }
  }),

  removeConversation: (conversationId) => set((state) => {
    const target = state.conversations.find((conversation) => conversation.id === conversationId)
    if (!target || target.status === 'running') return state

    const conversations = state.conversations.filter((conversation) => conversation.id !== conversationId)
    const selectedConversationByScope = { ...state.selectedConversationByScope }
    if (selectedConversationByScope[target.scopeKey] === conversationId) {
      const fallback = conversations.find((conversation) => conversation.scopeKey === target.scopeKey)
      if (fallback) selectedConversationByScope[target.scopeKey] = fallback.id
      else delete selectedConversationByScope[target.scopeKey]
    }

    const requestPayloads = Object.fromEntries(
      Object.entries(state.requestPayloads).filter(([, payload]) => payload.conversationId !== conversationId),
    )
    const pendingPatchSnapshots = Object.fromEntries(
      Object.entries(state.pendingPatchSnapshots).filter(([, snapshot]) => snapshot.conversationId !== conversationId),
    )

    persist({ conversations, selectedConversationByScope, preferences: state.preferences })
    return { conversations, selectedConversationByScope, requestPayloads, pendingPatchSnapshots }
  }),

  beginRequest: (conversationId, payload) => {
    let createdMessageId: string | null = null

    set((state) => {
      let touched = false
      const conversations = state.conversations.map((conversation) => {
        if (conversation.id !== conversationId) return conversation
        touched = true
        createdMessageId = `claude-msg-${generateId()}`
        const nextMessages = trimMessages([
          ...conversation.messages,
          {
            id: createdMessageId,
            kind: 'user',
            createdAt: Date.now(),
            text: payload.text,
            attachments: payload.attachments,
            meta: {
              ...(payload.meta ?? {}),
              requestId: payload.requestId,
            },
          },
        ])

        return {
          ...conversation,
          title: conversation.messages.length === 0 ? deriveTitle(payload.text) : conversation.title,
          messages: nextMessages,
          status: 'running' as const,
          updatedAt: Date.now(),
          currentRequestId: payload.requestId,
        }
      })

      if (!touched) return state

      persist({
        conversations,
        selectedConversationByScope: state.selectedConversationByScope,
        preferences: state.preferences,
      })
      return { conversations }
    })

    return createdMessageId
  },

  registerRequestPayload: (payload) => set((state) => ({
    requestPayloads: {
      ...state.requestPayloads,
      [payload.requestId]: payload,
    },
  })),

  clearRequestPayload: (requestId) => set((state) => {
    if (!state.requestPayloads[requestId]) return state
    const { [requestId]: _ignored, ...requestPayloads } = state.requestPayloads
    return { requestPayloads }
  }),

  capturePatchSnapshot: (payload) => set((state) => ({
    pendingPatchSnapshots: {
      ...state.pendingPatchSnapshots,
      [payload.toolUseId]: payload,
    },
  })),

  finalizePatchSnapshot: (payload) => set((state) => {
    const snapshot = state.pendingPatchSnapshots[payload.toolUseId]
    if (!snapshot) return state

    const { [payload.toolUseId]: _ignored, ...pendingPatchSnapshots } = state.pendingPatchSnapshots
    if (payload.isError) {
      return { pendingPatchSnapshots }
    }

    const afterByPath = new Map(payload.files.map((file) => [file.filePath, file.afterContent]))
    const reviewFiles = snapshot.files
      .map((file) => {
        const afterContent = afterByPath.get(file.filePath)
        if (afterContent === undefined || afterContent === file.beforeContent) return null
        return {
          id: `claude-patch-file-${generateId()}`,
          filePath: file.filePath,
          relativePath: file.relativePath,
          fileName: file.fileName,
          language: file.language,
          beforeContent: file.beforeContent,
          afterContent,
        } satisfies ClaudeGuiPatchFile
      })
      .filter((item): item is ClaudeGuiPatchFile => item !== null)

    if (reviewFiles.length === 0) {
      return { pendingPatchSnapshots }
    }

    const review: ClaudeGuiPatchReview = {
      id: `claude-patch-${generateId()}`,
      requestId: snapshot.requestId,
      toolUseId: snapshot.toolUseId,
      toolName: snapshot.toolName,
      createdAt: Date.now(),
      files: reviewFiles,
    }

    const conversations = state.conversations.map((conversation) => (
      conversation.id === payload.conversationId
        ? {
          ...conversation,
          patchReviews: trimPatchReviews([...conversation.patchReviews, review]),
          updatedAt: Date.now(),
        }
        : conversation
    ))

    persist({
      conversations,
      selectedConversationByScope: state.selectedConversationByScope,
      preferences: state.preferences,
    })
    return { conversations, pendingPatchSnapshots }
  }),

  dismissPatchReview: (conversationId, reviewId) => set((state) => {
    const conversations = state.conversations.map((conversation) => (
      conversation.id === conversationId
        ? {
          ...conversation,
          patchReviews: conversation.patchReviews.filter((review) => review.id !== reviewId),
          updatedAt: Date.now(),
        }
        : conversation
    ))

    persist({
      conversations,
      selectedConversationByScope: state.selectedConversationByScope,
      preferences: state.preferences,
    })
    return { conversations }
  }),

  dismissPatchReviewFile: (conversationId, reviewId, filePath) => set((state) => {
    const conversations = state.conversations.map((conversation) => {
      if (conversation.id !== conversationId) return conversation

      const patchReviews = conversation.patchReviews.flatMap((review) => {
        if (review.id !== reviewId) return [review]
        const files = review.files.filter((file) => file.filePath !== filePath)
        return files.length > 0 ? [{ ...review, files }] : []
      })

      return {
        ...conversation,
        patchReviews,
        updatedAt: Date.now(),
      }
    })

    persist({
      conversations,
      selectedConversationByScope: state.selectedConversationByScope,
      preferences: state.preferences,
    })
    return { conversations }
  }),

  applyEvent: (event) => set((state) => {
    const conversations = state.conversations.map((conversation) => {
      if (conversation.id !== event.conversationId) return conversation

      let messages = conversation.messages
      let status = conversation.status
      let sessionId = conversation.sessionId
      let liveUsage = conversation.liveUsage
      let availableTools = conversation.availableTools
      let availableSkills = conversation.availableSkills
      let currentRequestId = conversation.currentRequestId
      let totalCost = conversation.totalCost
      let totalTokensInput = conversation.totalTokensInput
      let totalTokensOutput = conversation.totalTokensOutput
      let requestCount = conversation.requestCount
      let lastRequestCost = conversation.lastRequestCost
      let lastRequestDuration = conversation.lastRequestDuration
      let lastRequestInputTokens = conversation.lastRequestInputTokens
      let lastRequestOutputTokens = conversation.lastRequestOutputTokens
      let preferences = conversation.preferences

      switch (event.type) {
        case 'processing':
          status = event.active ? 'running' : 'idle'
          if (!event.active) currentRequestId = null
          break
        case 'connected':
          sessionId = event.sessionId ?? sessionId
          availableTools = event.tools ?? availableTools
          availableSkills = event.skills ?? availableSkills
          break
        case 'assistant':
          messages = upsertTextMessage(messages, 'assistant', event.messageId, event.text)
          break
        case 'thinking':
          messages = upsertTextMessage(messages, 'thinking', event.messageId, event.text)
          break
        case 'system':
          messages = upsertTextMessage(messages, 'system', event.messageId, event.text)
          break
        case 'tool-use':
          messages = trimMessages([
            ...messages,
            {
              id: `claude-msg-${generateId()}`,
              kind: 'tool-use',
              createdAt: Date.now(),
              messageId: event.messageId,
              toolUseId: event.toolUseId,
              toolName: event.toolName,
              rawInput: event.rawInput,
              status: '',
              meta: { requestId: event.requestId },
            },
          ])
          break
        case 'tool-status':
          messages = messages.map((message) => (
            message.kind === 'tool-use' && message.toolUseId === event.toolUseId
              ? { ...message, status: event.status }
              : message
          ))
          break
        case 'tool-result':
          messages = trimMessages([
            ...messages,
            {
              id: `claude-msg-${generateId()}`,
              kind: 'tool-result',
              createdAt: Date.now(),
              text: event.text,
              toolUseId: event.toolUseId,
              toolName: event.toolName,
              isError: event.isError,
              hidden: event.hidden,
              meta: { requestId: event.requestId },
            },
          ])
          break
        case 'usage':
          liveUsage = event.usage
          break
        case 'result':
          sessionId = event.result.sessionId ?? sessionId
          totalCost += event.result.totalCost ?? 0
          totalTokensInput = event.result.totalTokensInput
          totalTokensOutput = event.result.totalTokensOutput
          requestCount = event.result.requestCount
          lastRequestCost = event.result.totalCost ?? 0
          lastRequestDuration = event.result.duration ?? 0
          lastRequestInputTokens = event.result.currentTokensInput
          lastRequestOutputTokens = event.result.currentTokensOutput
          liveUsage = null
          status = 'idle'
          messages = trimMessages([
            ...messages,
            {
              id: `claude-msg-${generateId()}`,
              kind: 'stats',
              createdAt: Date.now(),
              text: '',
              meta: {
                cost: event.result.totalCost ?? 0,
                duration: event.result.duration ?? 0,
                inputTokens: event.result.currentTokensInput,
                outputTokens: event.result.currentTokensOutput,
                requestId: event.requestId,
              },
            },
          ])
          break
        case 'error':
          status = 'error'
          messages = trimMessages([
            ...messages,
            {
              id: `claude-msg-${generateId()}`,
              kind: 'error',
              createdAt: Date.now(),
              text: event.error,
              isError: true,
              meta: { requestId: event.requestId },
            },
          ])
          break
        case 'plan-mode':
          preferences = { ...preferences, planMode: event.active }
          break
        case 'closed':
          if (status === 'running') status = 'idle'
          currentRequestId = null
          break
      }

      return {
        ...conversation,
        sessionId,
        status,
        updatedAt: Date.now(),
        messages,
        preferences,
        availableTools,
        availableSkills,
        liveUsage,
        currentRequestId,
        totalCost,
        totalTokensInput,
        totalTokensOutput,
        requestCount,
        lastRequestCost,
        lastRequestDuration,
        lastRequestInputTokens,
        lastRequestOutputTokens,
      }
    })

    const nextState = {
      conversations,
      preferences: state.preferences,
      selectedConversationByScope: state.selectedConversationByScope,
    }
    persist(nextState)
    return {
      ...nextState,
      requestPayloads: state.requestPayloads,
      pendingPatchSnapshots: state.pendingPatchSnapshots,
    }
  }),
}))

export function getClaudeScopeKey(projectId: string | null, worktreeId?: string | null): string {
  return scopeKey(projectId, worktreeId)
}
