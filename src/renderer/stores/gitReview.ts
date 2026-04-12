import { create } from 'zustand'

export type GitReviewStatus = 'idle' | 'running' | 'done' | 'error'

export interface GitReviewRecord {
  cwd: string
  status: GitReviewStatus
  content: string
  error: string | null
  diffHash: string
  filesSignature: string
  reviewedAt: number | null
}

interface GitReviewState {
  reviewsByCwd: Record<string, GitReviewRecord>
  startReview: (cwd: string, diffHash: string, filesSignature: string) => void
  completeReview: (cwd: string, content: string) => void
  failReview: (cwd: string, error: string) => void
  clearReview: (cwd: string) => void
}

export const useGitReviewStore = create<GitReviewState>((set) => ({
  reviewsByCwd: {},
  startReview: (cwd, diffHash, filesSignature) =>
    set((state) => ({
      reviewsByCwd: {
        ...state.reviewsByCwd,
        [cwd]: {
          cwd,
          status: 'running',
          content: state.reviewsByCwd[cwd]?.content ?? '',
          error: null,
          diffHash,
          filesSignature,
          reviewedAt: null,
        },
      },
    })),
  completeReview: (cwd, content) =>
    set((state) => {
      const existing = state.reviewsByCwd[cwd]
      if (!existing) return state
      return {
        reviewsByCwd: {
          ...state.reviewsByCwd,
          [cwd]: {
            ...existing,
            status: 'done',
            content,
            error: null,
            reviewedAt: Date.now(),
          },
        },
      }
    }),
  failReview: (cwd, error) =>
    set((state) => {
      const existing = state.reviewsByCwd[cwd]
      return {
        reviewsByCwd: {
          ...state.reviewsByCwd,
          [cwd]: {
            cwd,
            status: 'error',
            content: existing?.content ?? '',
            error,
            diffHash: existing?.diffHash ?? '',
            filesSignature: existing?.filesSignature ?? '',
            reviewedAt: existing?.reviewedAt ?? null,
          },
        },
      }
    }),
  clearReview: (cwd) =>
    set((state) => {
      const next = { ...state.reviewsByCwd }
      delete next[cwd]
      return { reviewsByCwd: next }
    }),
}))
