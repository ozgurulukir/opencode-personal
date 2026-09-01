#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs"
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

// `@opentui/solid` exposes a Bun-specific entrypoint, but its jsx-runtime
// imports the package root without a Bun condition. In a compiled bundle that
// can create two Solid renderer contexts, so JSX components cannot see the
// renderer created by the app. Keep both imports on the same Bun runtime.
const solidJsxRuntimePlugin = {
  name: "opentui-solid-jsx-runtime",
  setup(build: { onLoad: (options: { filter: RegExp }, callback: (args: { path: string }) => Promise<{ contents: string; loader: "js" }>) => void }) {
    build.onLoad({ filter: /[\\/]@opentui[\\/]solid[\\/]jsx-runtime\\.js$/ }, async ({ path: file }) => ({
      contents: (await Bun.file(file).text()).replaceAll('from "@opentui/solid"', 'from "@opentui/solid/index.bun.js"'),
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

// @opentui/core's parser.worker.js uses a dynamic import("web-tree-sitter/tree-sitter.wasm",
// { with: { type: "wasm" } }) which Bun.build --compile cannot resolve at build time.
// Patch the source string: replace the dynamic wasm import with a static import ... with
// { type: "file" }, which Bun embeds into bunfs and resolves to /$bunfs/root/<hash>.wasm.
// The patched string is injected as a virtual file via Bun.build's `files` option (upstream
// pattern), avoiding disk I/O and cleanup.
const treeSitterWorkerSrc = await Bun.file(parserWorker).text()
const dynamicWasmImport =
  'let treeWasm = await resolveBundledFilePath(() => import("web-tree-sitter/tree-sitter.wasm", { with: { type: "wasm" } }), () => import.meta.resolve("web-tree-sitter/tree-sitter.wasm"), import.meta.url);'
const assetWasmImport =
  'let treeWasm = treeSitterWasmPath ?? resolveAssetPath("web-tree-sitter/tree-sitter.wasm", () => new URL(import.meta.resolve("web-tree-sitter/tree-sitter.wasm")));'
if (!treeSitterWorkerSrc.includes(dynamicWasmImport) && !treeSitterWorkerSrc.includes(assetWasmImport)) {
  throw new Error(
    "Cannot patch parser.worker.js: expected WASM asset loading code not found. " +
      "The @opentui/core package may have updated — check parser.worker.js initialize() method.",
  )
}
const treeSitterWorker = treeSitterWorkerSrc
  .replace(
    'import { createRequire } from "node:module";',
    'import { createRequire } from "node:module";\nimport treeWasmUrl from "web-tree-sitter/tree-sitter.wasm" with { type: "file" };',
  )
  .replace(dynamicWasmImport, "let treeWasm = treeSitterWasmPath ?? treeWasmUrl;")
  .replace(assetWasmImport, "let treeWasm = treeSitterWasmPath ?? treeWasmUrl;")
  .replace(
    "class ParserWorker {",
    `try{
const _origInstantiate=WebAssembly.instantiate;
WebAssembly.instantiate=function(binary,imports){
  try{
    if(imports){
      const wasi = imports.wasi_snapshot_preview1 || (imports.wasi_snapshot_preview1 = {});
      wasi.clock_time_get = wasi.clock_time_get || function(clock_id, precision, ptime) { return 0; };
      wasi.fd_close = wasi.fd_close || function() { return 0; };
      wasi.fd_seek = wasi.fd_seek || function() { return 0; };
      wasi.fd_write = wasi.fd_write || function() { return 0; };
      wasi.proc_exit = wasi.proc_exit || function() {};
      wasi.environ_sizes_get = wasi.environ_sizes_get || function() { return 0; };
      wasi.environ_get = wasi.environ_get || function() { return 0; };
    }
  }catch(e){}
  return _origInstantiate.call(this,binary,imports);
};
}catch(e){}
class ParserWorker {`,
  )
const treeSitterWorkerPath = "opentui-tree-sitter-worker.js"

// Bun.build resolves `import { Parser } from "web-tree-sitter"` to the ROOT
// node_modules/web-tree-sitter (0.26.11), NOT @opentui/core's nested 0.25.10.
// The wasm MUST match the JS version: 0.26.11 JS needs 0.26.11 wasm.
// 0.26.11 renamed tree-sitter.wasm → web-tree-sitter.wasm and dropped clock_time_get.
const wtsRootDir = path.resolve(path.dirname(parserWorker), "../../web-tree-sitter")
const wtsNestedDir = path.resolve(path.dirname(parserWorker), "node_modules/web-tree-sitter")
const wtsRootWasm = path.join(wtsRootDir, "web-tree-sitter.wasm")
const wtsNestedWasm = path.join(wtsNestedDir, "tree-sitter.wasm")
const wasmFile = fs.existsSync(wtsRootWasm) ? wtsRootWasm : wtsNestedWasm
const wasmResolver = {
  name: "web-tree-sitter-wasm-resolver",
  setup(build: any) {
    build.onResolve({ filter: /^web-tree-sitter\/tree-sitter\.wasm$/ }, (args: any) => {
      return { path: wasmFile }
    })
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
    plugins: [solidPlugin, solidJsxRuntimePlugin, wasmResolver],
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
      [treeSitterWorkerPath]: treeSitterWorker,
      "diff-wasm/opencode_diff_rs.js": diffWasmJs,
      "diff-wasm/opencode_diff_rs_bg.wasm": new Uint8Array(diffWasmWasm),
      ...(embeddedFileMap ? { "opencode-web-ui.gen.ts": embeddedFileMap } : {}),
    },
    entrypoints: ["./src/index.ts", treeSitterWorkerPath, workerPath, ...(embeddedFileMap ? ["opencode-web-ui.gen.ts"] : [])],
    define: {
      OPENCODE_VERSION: `'${Script.version}'`,
      OPENCODE_MIGRATIONS: JSON.stringify(migrations),
      OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + treeSitterWorkerPath,
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
