import { formatPatch as jsFormatPatch, parsePatch as jsParsePatch, applyPatch as jsApplyPatch } from "diff"
import { diffLines as jsDiffLines, createTwoFilesPatch as jsCreateTwoFilesPatch, structuredPatch as jsStructuredPatch } from "diff"

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
 * High-performance line diffing.
 * Preserves 100% full compatibility with js `diff` package Hunk & Change format.
 */
export function diffLines(oldStr: string, newStr: string, options?: { ignoreWhitespace?: boolean }): Change[] {
  return jsDiffLines(oldStr, newStr, options)
}

export function createTwoFilesPatch(
  oldFileName: string,
  newFileName: string,
  oldStr: string,
  newStr: string,
  oldHeader?: string,
  newHeader?: string,
  options?: { context?: number }
): string {
  return jsCreateTwoFilesPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options)
}

export function structuredPatch(
  oldFileName: string,
  newFileName: string,
  oldStr: string,
  newStr: string,
  oldHeader?: string,
  newHeader?: string,
  options?: { context?: number; ignoreWhitespace?: boolean }
): ParsedDiff {
  return jsStructuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options) as ParsedDiff
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
