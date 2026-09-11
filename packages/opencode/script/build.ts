#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

await import("./generate.ts")

import { Script } from "@opencode-ai/script"
import pkg from "../package.json"

// Load migrations from migration directories
const migrationDirs = (
  await fs.promises.readdir(path.join(dir, "migration"), {
    withFileTypes: true,
  })
)
  .filter((entry) => entry.isDirectory() && /^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}/.test(entry.name))
  .map((entry) => entry.name)
  .sort()

const migrations = await Promise.all(
  migrationDirs.map(async (name) => {
    const file = path.join(dir, "migration", name, "migration.sql")
    const sql = await Bun.file(file).text()
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
    const timestamp = match
      ? Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        )
      : 0
    return { sql, timestamp, name }
  }),
)
console.log(`Loaded ${migrations.length} migrations`)

const singleFlag = process.argv.includes("--single")
const baselineFlag = process.argv.includes("--baseline")
const skipInstall = process.argv.includes("--skip-install")
const sourcemapsFlag = process.argv.includes("--sourcemaps")
const solidPlugin = createSolidTransformPlugin()
const skipEmbedWebUi = process.argv.includes("--skip-embed-web-ui")
const preserveOpenTuiSolidPlugin = {
  name: "preserve-opentui-solid-runtime",
  setup(build: { onLoad: (options: { filter: RegExp }, callback: (args: { path: string }) => Promise<{ contents: string; loader: "js" }>) => void }) {
    build.onLoad({ filter: /[/\\]node_modules[/\\]@opentui[/\\]solid[/\\].*\.js$/ }, async (args) => ({
      contents: await Bun.file(args.path).text(),
      loader: "js",
    }))
  },
}

const createEmbeddedWebUIBundle = async () => {
  console.log(`Building Web UI to embed in the binary`)
  const appDir = path.join(import.meta.dirname, "../../app")
  const dist = path.join(appDir, "dist")

  try {
    await $`bun run --cwd ${appDir} build`

    // Validate dist exists and has index.html
    if (!(await Bun.file(path.join(dist, "index.html")).exists())) {
      throw new Error("UI build succeeded but index.html not found")
    }

    const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dist })))
      .map((file) => file.replaceAll("\\", "/"))
      .filter((file) => !file.endsWith(".map"))
      .sort()
    const imports = files.map((file, i) => {
      const spec = path.relative(dir, path.join(dist, file)).replaceAll("\\", "/")
      return `import file_${i} from ${JSON.stringify(spec.startsWith(".") ? spec : `./${spec}`)} with { type: "file" };`
    })
    const entries = files.map((file, i) => `  ${JSON.stringify(file)}: file_${i},`)
    return [
      `// Import all files as file_$i with type: "file"`,
      ...imports,
      `// Export with original mappings`,
      `export default {`,
      ...entries,
      `}`,
    ].join("\n")
  } catch (err) {
    console.warn("Embedded UI build failed, continuing without embedded UI", { error: err })
    return null
  }
}

const embeddedFileMap = skipEmbedWebUi ? null : await createEmbeddedWebUIBundle()

// Build diff-wasm WASM package
console.log("Building diff-wasm WASM package...")
await $`bun run --cwd ${path.join(dir, "..", "diff-wasm")} build:wasm`

// Read diff-wasm WASM artifacts
const diffWasmDir = path.join(dir, "..", "diff-wasm", "pkg")
const diffWasmJs = await Bun.file(path.join(diffWasmDir, "opencode_diff_rs.js")).text()
const diffWasmWasm = await Bun.file(path.join(diffWasmDir, "opencode_diff_rs_bg.wasm")).arrayBuffer()

const allTargets: {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}[] = [
  {
    os: "linux",
    arch: "arm64",
  },
  {
    os: "linux",
    arch: "x64",
  },
  {
    os: "linux",
    arch: "x64",
    avx2: false,
  },
  {
    os: "linux",
    arch: "arm64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
    avx2: false,
  },
  {
    os: "darwin",
    arch: "arm64",
  },
  {
    os: "darwin",
    arch: "x64",
  },
  {
    os: "darwin",
    arch: "x64",
    avx2: false,
  },
  {
    os: "win32",
    arch: "arm64",
  },
  {
    os: "win32",
    arch: "x64",
  },
  {
    os: "win32",
    arch: "x64",
    avx2: false,
  },
]

const targets = singleFlag
  ? allTargets.filter((item) => {
      if (item.os !== process.platform || item.arch !== process.arch) {
        return false
      }

      // When building for the current platform, prefer a single native binary by default.
      // Baseline binaries require additional Bun artifacts and can be flaky to download.
      if (item.avx2 === false) {
        return baselineFlag
      }

      // also skip abi-specific builds for the same reason
      if (item.abi !== undefined) {
        return false
      }

      return true
    })
  : allTargets

try {
  if (fs.existsSync("dist")) {
    await $`rm -rf dist`
  }
} catch (err) {
  console.warn("Failed to delete 'dist' directory directly. Renaming to bypass locked files...")
  const oldDistName = `dist.old.${Date.now()}`
  try {
    fs.renameSync("dist", oldDistName)
    // Attempt to clean up what we can in the background/silently
    $`rm -rf ${oldDistName}`.catch(() => {})
  } catch (renameErr) {
    console.error("Fatal: failed to rename 'dist' directory:", renameErr)
    throw renameErr
  }
}

const binaries: Record<string, string> = {}
if (!skipInstall) {
  await $`bun install --os="*" --cpu="*" @opentui/core@${pkg.dependencies["@opentui/core"]}`
  await $`bun install --os="*" --cpu="*" @parcel/watcher@${pkg.dependencies["@parcel/watcher"]}`
}
// Resolve @opentui/core's parser.worker.js (may be in bun cache)
const opentuiLocalPath = path.resolve(dir, "node_modules/@opentui/core/parser.worker.js")
const opentuiRootPath = path.resolve(dir, "../../node_modules/@opentui/core/parser.worker.js")
const parserWorker = fs.realpathSync(fs.existsSync(opentuiLocalPath) ? opentuiLocalPath : opentuiRootPath)

// Compiled binaries cannot load the tree-sitter worker from Bun's virtual
// filesystem as a Worker entry (proven with a minimal repro on Bun 1.3.14:
// ModuleNotFound on files-map entries, in every URL form), so embed a
// pre-bundled self-contained worker as text and extract it to disk at runtime
// (see src/util/ts-worker.ts). The engine wasm is inlined as bytes matching
// the web-tree-sitter JS the bundler resolves, so no JS/wasm version pairing
// is needed. Language grammars and queries still load at runtime (network +
// data-dir cache), same as dev.
async function buildTreeSitterWorkerBundle(): Promise<string> {
  console.log("Bundling tree-sitter worker...")
  let workerSrc = await Bun.file(parserWorker).text()
  const wasmImportSpecs = [
    "web-tree-sitter/web-tree-sitter.wasm", // current (see patches/@opentui%2Fcore@0.2.16.patch)
    "web-tree-sitter/tree-sitter.wasm", // pre-0.26.11 filename, kept as fallback
  ]
  const dynLine = wasmImportSpecs
    .map(
      (spec) =>
        `let treeWasm = await resolveBundledFilePath(() => import("${spec}", { with: { type: "wasm" } }), () => import.meta.resolve("${spec}"), import.meta.url);`,
    )
    .find((line) => workerSrc.includes(line))
  if (!dynLine) {
    throw new Error(
      "Cannot patch parser.worker.js: expected WASM asset loading code not found. " +
        "The @opentui/core package may have updated — check parser.worker.js initialize() method.",
    )
  }
  // Resolve the wasm next to the web-tree-sitter JS the bundler will inline,
  // so the pair always matches regardless of root/nested hoisting.
  const wtsDir = path.dirname(Bun.resolveSync("web-tree-sitter", path.dirname(parserWorker)))
  const wasmBase64 = Buffer.from(await Bun.file(path.join(wtsDir, "web-tree-sitter.wasm")).arrayBuffer()).toString(
    "base64",
  )
  const apply = (from: string, to: string) => {
    if (!workerSrc.includes(from)) {
      throw new Error(`Cannot patch parser.worker.js: expected block not found: ${from.slice(0, 80)}...`)
    }
    workerSrc = workerSrc.replace(from, to)
  }
  apply(dynLine, `let treeWasmBytes = Uint8Array.from(atob("${wasmBase64}"), (c) => c.charCodeAt(0));`)
  apply(
    `await Parser.init({
        locateFile() {
          return treeWasm;
        }
      });`,
    `await Parser.init({ wasmBinary: treeWasmBytes });`,
  )
  apply(
    `if (isBunfsPath(treeWasm)) {
        treeWasm = normalizeBunfsPath(path2.parse(treeWasm).base);
      }
`,
    "",
  )
  // Keep the temporary entrypoint under the project tree so Bun can walk up
  // to the workspace node_modules while resolving the worker's imports.
  const tmpDir = fs.mkdtempSync(path.join(dir, ".ts-worker-"))
  try {
    const entry = path.join(tmpDir, "parser.worker.src.js")
    fs.writeFileSync(entry, workerSrc)
    const result = await Bun.build({
      entrypoints: [entry],
      outdir: path.join(tmpDir, "out"),
      format: "esm",
      target: "bun",
      minify: true,
      naming: "parser.worker.bundle.js",
    })
    if (!result.success) {
      throw new Error(`tree-sitter worker bundle failed:\n${result.logs.map((l) => l.message).join("\n")}`)
    }
    const bundled = await Bun.file(path.join(tmpDir, "out", "parser.worker.bundle.js")).text()
    // Build-time assertions: fail loud, never ship a broken worker. Upstream
    // swallows init errors (highlightOnce returns { error }, startHighlight
    // falls back to raw text), so a silent break here means raw markdown.
    const checks: Array<[string, boolean]> = [
      ["wasm bytes inlined", bundled.includes("wasmBinary")],
      ["no undeclared treeSitterWasmPath", !bundled.includes("treeSitterWasmPath")],
      ["no bare web-tree-sitter import", !bundled.includes('from "web-tree-sitter"')],
      ["no dynamic wasm import left", !bundled.includes('type: "wasm"')],
    ]
    const failed = checks.filter(([, ok]) => !ok).map(([label]) => label)
    if (failed.length > 0) {
      throw new Error(`tree-sitter worker bundle failed checks: ${failed.join(", ")}`)
    }
    console.log(`Tree-sitter worker bundle: ${(bundled.length / 1024).toFixed(0)} KB embedded`)
    return bundled
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

const tsWorkerBundle = await buildTreeSitterWorkerBundle()
const embeddedTsWorkerPlugin = {
  name: "embedded-ts-worker-bundle",
  setup(build: any) {
    build.onResolve({ filter: /^embedded:ts-worker-bundle$/ }, () => ({
      path: "embedded:ts-worker-bundle",
      namespace: "embedded-ts-worker",
    }))
    build.onLoad({ filter: /.*/, namespace: "embedded-ts-worker" }, () => ({
      contents: tsWorkerBundle,
      loader: "text",
    }))
  },
}

for (const item of targets) {
  const name = [
    pkg.name,
    // changing to win32 flags npm for some reason
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.avx2 === false ? "baseline" : undefined,
    item.abi === undefined ? undefined : item.abi,
  ]
    .filter(Boolean)
    .join("-")
  console.log(`building ${name}`)
  await $`mkdir -p dist/${name}/bin`

  const workerPath = "./src/cli/cmd/tui/worker.ts"
  const bunfsRoot = item.os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"

  await Bun.build({
    conditions: ["bun"],
    tsconfig: "./tsconfig.json",
    plugins: [preserveOpenTuiSolidPlugin, solidPlugin, embeddedTsWorkerPlugin],
    external: ["node-gyp"],
    format: "esm",
    minify: true,
    sourcemap: sourcemapsFlag ? "linked" : "none",
    splitting: true,
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: name.replace(pkg.name, "bun") as any,
      outfile: `dist/${name}/bin/opencode`,
      execArgv: [`--user-agent=opencode/${Script.version}`, "--use-system-ca", "--"],
      windows: {},
    },
    files: {
      "diff-wasm/opencode_diff_rs.js": diffWasmJs,
      "diff-wasm/opencode_diff_rs_bg.wasm": new Uint8Array(diffWasmWasm),
      ...(embeddedFileMap ? { "opencode-web-ui.gen.ts": embeddedFileMap } : {}),
    },
    entrypoints: ["./src/index.ts", workerPath, ...(embeddedFileMap ? ["opencode-web-ui.gen.ts"] : [])],
    define: {
      OPENCODE_VERSION: `'${Script.version}'`,
      OPENCODE_MIGRATIONS: JSON.stringify(migrations),
      OPENCODE_DIFF_WASM_JS_PATH: bunfsRoot + "diff-wasm/opencode_diff_rs.js",
      OPENCODE_WORKER_PATH: workerPath,
      OPENCODE_CHANNEL: `'${Script.channel}'`,
      OPENCODE_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "",
    },
  })

  // Smoke test: only run if binary is for current platform
  if (item.os === process.platform && item.arch === process.arch && !item.abi) {
    const binaryPath = `dist/${name}/bin/opencode`
    console.log(`Running smoke test: ${binaryPath} --version`)
    try {
      const versionOutput = await $`${binaryPath} --version`.text()
      console.log(`Smoke test passed: ${versionOutput.trim()}`)
    } catch (e) {
      console.error(`Smoke test failed for ${name}:`, e)
      process.exit(1)
    }
  }

  await $`rm -rf ./dist/${name}/bin/tui`

  // Ship the OpenTUI native library next to the compiled binary. In a Bun
  // --compile binary the library is embedded under /$bunfs/root/..., which the
  // OS dynamic linker cannot dlopen. The runtime falls back to this real copy.
  const libExt = item.os === "win32" ? "dll" : item.os === "darwin" ? "dylib" : "so"
  const coreDir = path.dirname(parserWorker)
  const platformLibName = item.os === "win32" ? `opentui.${libExt}` : `libopentui.${libExt}`
  const platformLib = path.join(coreDir, `../core-${item.os}-${item.arch}/${platformLibName}`)
  if (fs.existsSync(platformLib)) {
    fs.copyFileSync(platformLib, `dist/${name}/bin/${platformLibName}`)
  }

  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version: Script.version,
        os: [item.os],
        cpu: [item.arch],
      },
      null,
      2,
    ),
  )
  binaries[name] = Script.version
}

if (Script.release) {
  for (const key of Object.keys(binaries)) {
    if (key.includes("linux")) {
      await $`tar -czf ../../${key}.tar.gz *`.cwd(`dist/${key}/bin`)
    } else {
      await $`zip -r ../../${key}.zip *`.cwd(`dist/${key}/bin`)
    }
  }
  await $`gh release upload v${Script.version} ./dist/*.zip ./dist/*.tar.gz --clobber --repo ${process.env.GH_REPO}`
}

export { binaries }
