/**
 * Move `fromId` to the position of `toId`. Returns `undefined` when either id is
 * missing or they are the same element — callers treat that as a no-op.
 *
 * Pure and dependency-free so it can be tested without loading the SolidJS
 * browser runtime.
 */
export function reorderWorkspaceIds(ids: string[], fromId: string, toId: string): string[] | undefined {
  const fromIndex = ids.indexOf(fromId)
  const toIndex = ids.indexOf(toId)
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return undefined
  const result = ids.slice()
  const [item] = result.splice(fromIndex, 1)
  if (!item) return undefined
  result.splice(toIndex, 0, item)
  return result
}
