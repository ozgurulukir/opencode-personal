import type { CycleResult, FooterPatch, RunInput } from "./types"

export type SelectAction =
  | { type: "variants"; variants: string[] }
  | { type: "variant"; variant: string | undefined }
  | { type: "patch"; patch: FooterPatch }

/**
 * Derives the ordered state actions from a model/variant select callback
 * result. The presence checks ("variants" in result) are load-bearing: they
 * distinguish `{ variants: undefined }` from an absent field, matching the
 * original inline handlers. Pinned by test/cli/cmd/run/footer-select.shared.test.ts.
 */
export function selectApply(result: CycleResult): SelectAction[] {
  const actions: SelectAction[] = []
  if ("variants" in result) {
    actions.push({ type: "variants", variants: result.variants ?? [] })
  }
  if ("variant" in result) {
    actions.push({ type: "variant", variant: result.variant })
  }
  const patch: FooterPatch = {}
  if (result.modelLabel) patch.model = result.modelLabel
  if (result.status) patch.status = result.status
  if (patch.model || patch.status) {
    actions.push({ type: "patch", patch })
  }
  return actions
}

/**
 * A model select result is stale when the footer's current model no longer
 * matches the selected model (the user picked another model while the
 * callback was in flight). A missing current model also counts as stale.
 */
export function modelSelectStale(
  current: RunInput["model"],
  selected: { providerID: string; modelID: string },
): boolean {
  return !current || current.providerID !== selected.providerID || current.modelID !== selected.modelID
}

/**
 * A variant select result is stale only when a model was set at select time
 * and has since changed. When no model was set at select time the result
 * always applies — this asymmetry is deliberate (see footer.ts handleVariantSelect).
 */
export function variantSelectStale(current: RunInput["model"], atSelect: RunInput["model"]): boolean {
  return (
    atSelect !== undefined &&
    (!current || current.providerID !== atSelect.providerID || current.modelID !== atSelect.modelID)
  )
}
