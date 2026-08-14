/**
 * Cross-module invariant: the companion manifest for a zvec index at `indexPath`
 * always lives at `{indexPath}_manifest.json`. `ZvecIndex.reset()` owns manifest
 * removal (the manifest maps vectors that no longer exist after a reset/migration),
 * and consumers derive their manifest paths through this helper instead of
 * hand-building them.
 */
export const MANIFEST_SUFFIX = "_manifest.json"

export function manifestPathFor(indexPath: string): string {
  return `${indexPath}${MANIFEST_SUFFIX}`
}
