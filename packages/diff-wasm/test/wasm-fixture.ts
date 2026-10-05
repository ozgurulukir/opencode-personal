let initialized = false

export default async function init() {
  initialized = true
}

function assertInitialized() {
  if (!initialized) throw new Error("WASM fixture was not initialized")
}

export function diff_lines_rs() {
  assertInitialized()
  return [{ value: "fixture\n", count: 1 }]
}

export function create_two_files_patch_rs() {
  assertInitialized()
  return "fixture patch"
}

export function structured_patch_rs() {
  assertInitialized()
  return {
    oldFileName: "fixture-old.txt",
    newFileName: "fixture-new.txt",
    hunks: [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: ["-fixture", "+fixture"],
      },
    ],
  }
}
