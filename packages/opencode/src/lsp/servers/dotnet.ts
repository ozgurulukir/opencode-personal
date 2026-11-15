import {
  type Info,
  type InstanceContext,
  type Handle,
  NearestRoot,
  pathExists,
  run,
  output,
  spawn,
  which,
  path,
  fs,
  os,
  log,
  Process,
  Filesystem,
  Flag,
  Global,
  Archive,
  Module,
  Npm,
  venvCandidates,
  resolveVenvPython,
} from "./shared"

export const CSharp: Info = {
  id: "csharp",
  root: NearestRoot([".slnx", ".sln", ".csproj", "global.json"]),
  extensions: [".cs", ".csx"],
  async spawn(root) {
    const bin = await getRoslynLanguageServer()
    if (!bin) return

    return {
      process: spawn(bin, ["--stdio", "--autoLoadProjects"], {
        cwd: root,
      }),
    }
  },
}

export const Razor: Info = {
  id: "razor",
  root: NearestRoot([".slnx", ".sln", ".csproj", "global.json"]),
  extensions: [".razor", ".cshtml"],
  async spawn(root) {
    const bin = await getRoslynLanguageServer()
    if (!bin) return

    const razor = await findVscodeRazorExtension()
    if (!razor) {
      log.info("VS Code C# extension with Razor support not found, skipping Razor LSP")
      return
    }

    log.info("using VS Code Razor extension for roslyn-language-server", { extension: razor.extension })
    return {
      process: spawn(
        bin,
        [
          "--stdio",
          "--autoLoadProjects",
          `--razorSourceGenerator=${razor.compiler}`,
          `--razorDesignTimePath=${razor.targets}`,
          "--extension",
          razor.extension,
        ],
        {
          cwd: root,
        },
      ),
    }
  },
}

let roslynLanguageServerInstall: Promise<string | undefined> | undefined

async function getRoslynLanguageServer() {
  const existing = which("roslyn-language-server")
  if (existing) return existing

  const global = await roslynLanguageServerGlobalPath()
  if (global) return global

  roslynLanguageServerInstall ||= installRoslynLanguageServer().finally(() => {
    roslynLanguageServerInstall = undefined
  })
  return roslynLanguageServerInstall
}

async function installRoslynLanguageServer() {
  if (!which("dotnet")) {
    log.error(".NET SDK is required to install roslyn-language-server")
    return
  }

  if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
  log.info("installing roslyn-language-server via dotnet tool")
  const proc = Process.spawn(["dotnet", "tool", "install", "--global", "roslyn-language-server", "--prerelease"], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  })
  const exit = await proc.exited
  if (exit !== 0) {
    log.error("Failed to install roslyn-language-server")
    return
  }

  const resolved = which("roslyn-language-server")
  if (resolved) {
    log.info(`installed roslyn-language-server`, { bin: resolved })
    return resolved
  }

  const global = await roslynLanguageServerGlobalPath()
  if (global) {
    log.info(`installed roslyn-language-server`, { bin: global })
    return global
  }

  log.error("Installed roslyn-language-server but could not resolve executable")
}

async function roslynLanguageServerGlobalPath() {
  const bin = path.join(
    process.env.DOTNET_CLI_HOME ?? os.homedir(),
    ".dotnet",
    "tools",
    "roslyn-language-server" + (process.platform === "win32" ? ".cmd" : ""),
  )
  return (await pathExists(bin)) ? bin : undefined
}

async function findVscodeRazorExtension() {
  const roots = [
    process.env.VSCODE_EXTENSIONS,
    path.join(os.homedir(), ".vscode", "extensions"),
    path.join(os.homedir(), ".vscode-insiders", "extensions"),
    path.join(os.homedir(), ".vscode-server", "extensions"),
    path.join(os.homedir(), ".vscode-server-insiders", "extensions"),
  ].filter((item) => item !== undefined)

  for (const root of [...new Set(roots)]) {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
    const candidates = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("ms-dotnettools.csharp-"))
        .map(async (entry) => ({
          path: path.join(root, entry.name, ".razorExtension"),
          modified: (await fs.stat(path.join(root, entry.name)).catch(() => undefined))?.mtimeMs ?? 0,
        })),
    )
    for (const entry of candidates.sort((a, b) => b.modified - a.modified).map((candidate) => candidate.path)) {
      const result = {
        compiler: path.join(entry, "Microsoft.CodeAnalysis.Razor.Compiler.dll"),
        targets: path.join(entry, "Targets", "Microsoft.NET.Sdk.Razor.DesignTime.targets"),
        extension: path.join(entry, "Microsoft.VisualStudioCode.RazorExtension.dll"),
      }
      if (
        (await pathExists(result.compiler)) &&
        (await pathExists(result.targets)) &&
        (await pathExists(result.extension))
      ) {
        return result
      }
    }
  }
}

export const FSharp: Info = {
  id: "fsharp",
  root: NearestRoot([".slnx", ".sln", ".fsproj", "global.json"]),
  extensions: [".fs", ".fsi", ".fsx", ".fsscript"],
  async spawn(root) {
    let bin = which("fsautocomplete")
    if (!bin) {
      if (!which("dotnet")) {
        log.error(".NET SDK is required to install fsautocomplete")
        return
      }

      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("installing fsautocomplete via dotnet tool")
      const proc = Process.spawn(["dotnet", "tool", "install", "fsautocomplete", "--tool-path", Global.Path.bin], {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      })
      const exit = await proc.exited
      if (exit !== 0) {
        log.error("Failed to install fsautocomplete")
        return
      }

      bin = path.join(Global.Path.bin, "fsautocomplete" + (process.platform === "win32" ? ".exe" : ""))
      log.info(`installed fsautocomplete`, { bin })
    }

    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}
