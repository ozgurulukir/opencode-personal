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

export const BashLS: Info = {
  id: "bash",
  extensions: [".sh", ".bash", ".zsh", ".ksh"],
  root: async (_file, ctx) => ctx.directory,
  async spawn(root) {
    let binary = which("bash-language-server")
    const args: string[] = []
    if (!binary) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      const resolved = await Npm.which("bash-language-server")
      if (!resolved) return
      binary = resolved
    }
    args.push("start")
    const proc = spawn(binary, args, {
      cwd: root,
      env: {
        ...process.env,
      },
    })
    return {
      process: proc,
    }
  },
}
