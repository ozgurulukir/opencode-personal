import {
  type Info,
  NearestRoot,
  spawn,
  which,
  path,
  log,
  Filesystem,
  Flag,
  Npm,
  venvCandidates,
  resolveVenvPython,
} from "./shared"

export const Ty: Info = {
  id: "ty",
  extensions: [".py", ".pyi"],
  root: NearestRoot([
    "pyproject.toml",
    "ty.toml",
    "setup.py",
    "setup.cfg",
    "requirements.txt",
    "Pipfile",
    "pyrightconfig.json",
  ]),
  async spawn(root) {
    if (!Flag.OPENCODE_EXPERIMENTAL_LSP_TY) {
      return undefined
    }

    let binary = which("ty")

    const initialization: Record<string, string> = {}

    const pythonPath = await resolveVenvPython(root)
    if (pythonPath) {
      initialization["pythonPath"] = pythonPath
    }

    if (!binary) {
      const isWindows = process.platform === "win32"
      const tyPaths = venvCandidates(root).map((venvPath) =>
        isWindows ? path.join(venvPath, "Scripts", "ty.exe") : path.join(venvPath, "bin", "ty"),
      )
      const tyExists = await Promise.all(tyPaths.map((p) => Filesystem.exists(p)))
      const tyIndex = tyExists.findIndex(Boolean)
      if (tyIndex !== -1) {
        binary = tyPaths[tyIndex]
      }
    }

    if (!binary) {
      log.error("ty not found, please install ty first")
      return
    }

    const proc = spawn(binary, ["server"], {
      cwd: root,
    })

    return {
      process: proc,
      initialization,
    }
  },
}

export const Pyright: Info = {
  id: "pyright",
  extensions: [".py", ".pyi"],
  root: NearestRoot(["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile", "pyrightconfig.json"]),
  async spawn(root) {
    let binary = which("pyright-langserver")
    const args = []
    if (!binary) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      const resolved = await Npm.which("pyright", "pyright-langserver")
      if (!resolved) return
      binary = resolved
    }
    args.push("--stdio")

    const initialization: Record<string, string> = {}

    const pythonPath = await resolveVenvPython(root)
    if (pythonPath) {
      initialization["pythonPath"] = pythonPath
    }

    const proc = spawn(binary, args, {
      cwd: root,
      env: {
        ...process.env,
      },
    })
    return {
      process: proc,
      initialization,
    }
  },
}
