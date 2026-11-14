import z from "zod"

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

const FileManifest = z.object({
  version: z.literal(1),
  files: z.record(z.string(), z.object({ mtime: z.number(), chunkIds: z.array(z.string()) })),
})

const SkillManifest = z.object({
  version: z.literal(1),
  skills: z.record(z.string(), z.object({ contentHash: z.string() })),
})

export type FileManifest = z.infer<typeof FileManifest>
export type SkillManifest = z.infer<typeof SkillManifest>

// Persisted manifests are untrusted on-disk JSON; a malformed one returns undefined so callers re-index from scratch.
export const parseFileManifest = (raw: unknown) => FileManifest.safeParse(raw).data
export const parseSkillManifest = (raw: unknown) => SkillManifest.safeParse(raw).data
