import {
  createTwoFilesPatch as jsCreateTwoFilesPatch,
  diffLines as jsDiffLines,
  structuredPatch as jsStructuredPatch,
  formatPatch as jsFormatPatch,
  parsePatch as jsParsePatch,
  applyPatch as jsApplyPatch,
} from "diff"

declare const OPENCODE_DIFF_WASM_JS_PATH: string | undefined

const DEFAULT_WASM_JS_PATH =
  typeof OPENCODE_DIFF_WASM_JS_PATH === "string" ? OPENCODE_DIFF_WASM_JS_PATH : "../pkg/opencode_diff_rs.js"

function hasStandaloneCarriageReturn(value: string) {
  return /\r(?!\n)/.test(value)
}

function supportsWasmContext(context: number | undefined) {
  return context === undefined || (Number.isInteger(context) && context >= 0 && context <= 0xffffffff)
}

let wasmReady: Promise<void> | null = null
let wasmFailed = false
let wasmPath: string | undefined
let diff_lines_rs: typeof import("../pkg/opencode_diff_rs.js").diff_lines_rs
let create_two_files_patch_rs: typeof import("../pkg/opencode_diff_rs.js").create_two_files_patch_rs
let structured_patch_rs: typeof import("../pkg/opencode_diff_rs.js").structured_patch_rs

function getWasmJsPath() {
  return (globalThis as { OPENCODE_DIFF_WASM_JS_PATH?: string }).OPENCODE_DIFF_WASM_JS_PATH ?? DEFAULT_WASM_JS_PATH
}

function ensureWasm(): Promise<void> {
  const requestedPath = getWasmJsPath()
  if (wasmPath !== requestedPath) {
    wasmPath = requestedPath
    wasmReady = null
    wasmFailed = false
  }
  if (wasmFailed) return wasmReady!
  if (wasmReady === null) {
    wasmReady = import(requestedPath)
      .then((mod) => {
        diff_lines_rs = mod.diff_lines_rs
        create_two_files_patch_rs = mod.create_two_files_patch_rs
        structured_patch_rs = mod.structured_patch_rs
        return mod.default()
      })
      .then(() => {})
      .catch((err) => {
        wasmFailed = true
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
 * Uses Rust/WASM for line-based diff generation when available, with the `diff`
 * package as a compatibility fallback.
 */
export async function diffLines(
  oldStr: string,
  newStr: string,
  options?: { ignoreWhitespace?: boolean },
): Promise<Change[]> {
  if (options?.ignoreWhitespace || hasStandaloneCarriageReturn(oldStr) || hasStandaloneCarriageReturn(newStr)) {
    return jsDiffLines(oldStr, newStr, options) as unknown as Change[]
  }
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
  if (
    !supportsWasmContext(options?.context) ||
    hasStandaloneCarriageReturn(oldStr) ||
    hasStandaloneCarriageReturn(newStr)
  ) {
    return jsCreateTwoFilesPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options)
  }
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
  if (
    options?.ignoreWhitespace ||
    !supportsWasmContext(options?.context) ||
    hasStandaloneCarriageReturn(oldStr) ||
    hasStandaloneCarriageReturn(newStr)
  ) {
    return jsStructuredPatch(
      oldFileName,
      newFileName,
      oldStr,
      newStr,
      oldHeader,
      newHeader,
      options,
    ) as unknown as ParsedDiff
  }
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
    return jsStructuredPatch(
      oldFileName,
      newFileName,
      oldStr,
      newStr,
      oldHeader,
      newHeader,
      options,
    ) as unknown as ParsedDiff
  }
}

export function formatPatch(diff: ParsedDiff): string {
  // ParsedDiff is structurally compatible with diff's internal format
  return jsFormatPatch(diff as unknown as Parameters<typeof jsFormatPatch>[0])
}

export function parsePatch(diffStr: string, options?: { timeout?: number }): ParsedDiff[] {
  return jsParsePatch(diffStr) as unknown as ParsedDiff[]
}

export function applyPatch(
  source: string,
  patch: string | ParsedDiff | ParsedDiff[],
  options?: { fuzzFactor?: number },
): string | false {
  // ParsedDiff is structurally compatible with diff's internal patch format
  return jsApplyPatch(source, patch as unknown as Parameters<typeof jsApplyPatch>[1], options)
}
