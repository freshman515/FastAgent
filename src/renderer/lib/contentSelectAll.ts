const selectAllTargets = new Map<string, () => boolean | void>()

export function registerContentSelectAllTarget(id: string, selectAll: () => boolean | void): () => void {
  selectAllTargets.set(id, selectAll)
  return () => {
    if (selectAllTargets.get(id) === selectAll) {
      selectAllTargets.delete(id)
    }
  }
}

export function selectAllContentTarget(id: string): boolean {
  const selectAll = selectAllTargets.get(id)
  if (!selectAll) return false
  return selectAll() !== false
}
