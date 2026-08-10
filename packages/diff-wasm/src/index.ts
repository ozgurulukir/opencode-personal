import { formatPatch as jsFormatPatch, parsePatch as jsParsePatch, applyPatch as jsApplyPatch } from "diff"
import init, { diff_lines_rs, create_two_files_patch_rs, structured_patch_rs } from "../pkg/opencode_diff_rs.js"

let wasmReady: Promise<void> | null = null

function ensureWasm(): Promise<void> {
  if (wasmReady === null) {
    wasmReady = init().then(() => {})
  }
  return wasmReady!
}

export interface Change {
  value: string
  added?: boolean
  removed?: boolean
  count?: number
}

export interface Hunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
  linedelimiters?: string[]
}

export interface ParsedDiff {
  oldFileName?: string
  newFileName?: string
  oldHeader?: string
  newHeader?: string
  hunks: Hunk[]
  index?: string
}

/**
 * High-performance line diffing via Rust/WASM.
 * Preserves 100% full compatibility with js `diff` package Hunk & Change format.
 */
export async function diffLines(oldStr: string, newStr: string, options?: { ignoreWhitespace?: boolean }): Promise<Change[]> {
  await ensureWasm()
  const result = diff_lines_rs(oldStr, newStr)
  return result as unknown as Change[]
}

export async function createTwoFilesPatch(
  oldFileName: string,
  newFileName: string,
  oldStr: string,
  newStr: string,
  oldHeader?: string,
  newHeader?: string,
  options?: { context?: number }
): Promise<string> {
  await ensureWasm()
  const context = options?.context
  return create_two_files_patch_rs(oldFileName, newFileName, oldStr, newStr, oldHeader ?? null, newHeader ?? null, context ?? null)
}

export async function structuredPatch(
  oldFileName: string,
  newFileName: string,
  oldStr: string,
  newStr: string,
  oldHeader?: string,
  newHeader?: string,
  options?: { context?: number; ignoreWhitespace?: boolean }
): Promise<ParsedDiff> {
  await ensureWasm()
  const context = options?.context
  const result = structured_patch_rs(oldFileName, newFileName, oldStr, newStr, oldHeader ?? null, newHeader ?? null, context ?? null)
  return result as unknown as ParsedDiff
}

export function formatPatch(diff: ParsedDiff): string {
  return jsFormatPatch(diff as any)
}

export function parsePatch(diffStr: string, options?: { timeout?: number }): ParsedDiff[] {
  return jsParsePatch(diffStr) as unknown as ParsedDiff[]
}

export function applyPatch(
  source: string,
  patch: string | ParsedDiff | ParsedDiff[],
  options?: { fuzzFactor?: number }
): string | false {
  return jsApplyPatch(source, patch as any, options)
}
