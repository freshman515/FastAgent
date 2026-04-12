import { create } from 'zustand'

interface PromptOptimizerState {
  sourcePrompt: string
  instruction: string
  optimizedPrompt: string
  optimizing: boolean
  error: string | null
  setSourcePrompt: (value: string) => void
  setInstruction: (value: string) => void
  setOptimizedPrompt: (value: string) => void
  setOptimizing: (value: boolean) => void
  setError: (value: string | null) => void
  clear: () => void
}

export const usePromptOptimizerStore = create<PromptOptimizerState>((set) => ({
  sourcePrompt: '',
  instruction: '',
  optimizedPrompt: '',
  optimizing: false,
  error: null,
  setSourcePrompt: (value) => set({ sourcePrompt: value }),
  setInstruction: (value) => set({ instruction: value }),
  setOptimizedPrompt: (value) => set({ optimizedPrompt: value }),
  setOptimizing: (value) => set({ optimizing: value }),
  setError: (value) => set({ error: value }),
  clear: () => set({
    sourcePrompt: '',
    instruction: '',
    optimizedPrompt: '',
    optimizing: false,
    error: null,
  }),
}))
