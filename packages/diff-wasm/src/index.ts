import {
  createTwoFilesPatch as jsCreateTwoFilesPatch,
  diffLines as jsDiffLines,
  structuredPatch as jsStructuredPatch,
  formatPatch as jsFormatPatch,
  parsePatch as jsParsePatch,
  applyPatch as jsApplyPatch,
} from "diff"

const WASM_JS_PATH = (globalThis as any).OPENCODE_DIFF_WASM_JS_PATH ?? "../pkg/opencode_diff_rs.js"

let wasmReady: Promise<void> | null = null
let diff_lines_rs: typeof import("../pkg/opencode_diff_rs.js").diff_lines_rs
let create_two_files_patch_rs: typeof import("../pkg/opencode_diff_rs.js").create_two_files_patch_rs
let structured_patch_rs: typeof import("../pkg/opencode_diff_rs.js").structured_patch_rs

function ensureWasm(): Promise<void> {
  if (wasmReady === null) {
    wasmReady = import(WASM_JS_PATH)
      .then((mod) => {
        diff_lines_rs = mod.diff_lines_rs
        create_two_files_patch_rs = mod.create_two_files_patch_rs
        structured_patch_rs = mod.structured_patch_rs
        return mod.init()
      })
      .then(() => {})
      .catch((err) => {
        wasmReady = null
        throw err
      })
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
 * High-performance line diffing via Rust/WASM with JS fallback.
 * Preserves 100% full compatibility with js `diff` package Hunk & Change format.
 */
export async function diffLines(
  oldStr: string,
  newStr: string,
  options?: { ignoreWhitespace?: boolean },
): Promise<Change[]> {
  try {
    await ensureWasm()
    const result = diff_lines_rs(oldStr, newStr)
    return result as unknown as Change[]
  } catch {
    return jsDiffLines(oldStr, newStr, options) as unknown as Change[]
  }
}

export async function createTwoFilesPatch(
  oldFileName: string,
  newFileName: string,
  oldStr: string,
  newStr: string,
  oldHeader?: string,
  newHeader?: string,
  options?: { context?: number },
): Promise<string> {
  try {
    await ensureWasm()
    const context = options?.context
    return create_two_files_patch_rs(
      oldFileName,
      newFileName,
      oldStr,
      newStr,
      oldHeader ?? null,
      newHeader ?? null,
      context ?? null,
    )
  } catch {
    return jsCreateTwoFilesPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options)
  }
}

export async function structuredPatch(
  oldFileName: string,
  newFileName: string,
  oldStr: string,
  newStr: string,
  oldHeader?: string,
  newHeader?: string,
  options?: { context?: number; ignoreWhitespace?: boolean },
): Promise<ParsedDiff> {
  try {
    await ensureWasm()
    const context = options?.context
    const result = structured_patch_rs(
      oldFileName,
      newFileName,
      oldStr,
      newStr,
      oldHeader ?? null,
      newHeader ?? null,
      context ?? null,
    )
    return result as unknown as ParsedDiff
  } catch {
    return jsStructuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options) as unknown as ParsedDiff
  }
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
