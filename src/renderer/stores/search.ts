import { create } from 'zustand'
import type { ProjectSearchMatch, SearchQueryOptions } from '@shared/types'

interface SearchState {
  query: string
  fileFilter: string
  results: ProjectSearchMatch[]
  loading: boolean
  error: string | null
  lastRootPath: string | null
  lastSearchedQuery: string
  lastFileFilter: string
  setQuery: (query: string) => void
  setFileFilter: (fileFilter: string) => void
  clear: () => void
  searchInPath: (rootPath: string, query: string, options?: SearchQueryOptions) => Promise<void>
}

export const useProjectSearchStore = create<SearchState>((set, get) => ({
  query: '',
  fileFilter: '',
  results: [],
  loading: false,
  error: null,
  lastRootPath: null,
  lastSearchedQuery: '',
  lastFileFilter: '',

  setQuery: (query) => set({ query }),
  setFileFilter: (fileFilter) => set({ fileFilter }),

  clear: () => set({
    query: '',
    fileFilter: '',
    results: [],
    loading: false,
    error: null,
    lastRootPath: null,
    lastSearchedQuery: '',
    lastFileFilter: '',
  }),

  searchInPath: async (rootPath, query, options = {}) => {
    const trimmedQuery = query.trim()
    const fileFilter = typeof options.fileFilter === 'string' ? options.fileFilter : get().fileFilter
    set({
      query,
      loading: Boolean(rootPath && trimmedQuery),
      error: null,
      results: trimmedQuery ? [] : [],
      lastRootPath: rootPath,
      lastSearchedQuery: trimmedQuery,
      lastFileFilter: fileFilter,
    })

    if (!rootPath || !trimmedQuery) {
      set({ loading: false, results: [] })
      return
    }

    try {
      const results = await window.api.search.findInFiles(rootPath, trimmedQuery, options)
      set({
        results,
        loading: false,
        error: null,
        lastRootPath: rootPath,
        lastSearchedQuery: trimmedQuery,
        lastFileFilter: fileFilter,
      })
    } catch (error) {
      set({
        results: [],
        loading: false,
        error: error instanceof Error ? error.message : String(error),
        lastRootPath: rootPath,
        lastSearchedQuery: trimmedQuery,
        lastFileFilter: fileFilter,
      })
    }
  },
}))
