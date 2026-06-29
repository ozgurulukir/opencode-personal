#!/usr/bin/env node
// Copies onnxruntime-web's WASM glue (the emscripten .mjs factory + the .wasm binary)
// from node_modules into src/search/wasm/ so it can be embedded into compiled binaries
// via `import ... with { type: "file" }`. WASM is platform-independent, so a single
// copy covers every build target. Run automatically on postinstall; gitignored.
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { createRequire } from "module"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const destDir = path.join(__dirname, "..", "src", "search", "wasm")

let srcDir
try {
  srcDir = path.join(path.dirname(require.resolve("onnxruntime-web/package.json")), "dist")
} catch {
  process.exit(0)
}

fs.mkdirSync(destDir, { recursive: true })

for (const file of ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) {
  const src = path.join(srcDir, file)
  if (!fs.existsSync(src)) continue
  fs.copyFileSync(src, path.join(destDir, file))
}
