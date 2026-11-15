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

export const Nixd: Info = {
  id: "nixd",
  extensions: [".nix"],
  root: async (file, ctx) => {
    // First, look for flake.nix - the most reliable Nix project root indicator
    const flakeRoot = await NearestRoot(["flake.nix"])(file, ctx)
    if (flakeRoot && flakeRoot !== ctx.directory) return flakeRoot

    // If no flake.nix, fall back to git repository root
    if (ctx.worktree && ctx.worktree !== ctx.directory) return ctx.worktree

    // Finally, use the instance directory as fallback
    return ctx.directory
  },
  async spawn(root) {
    const nixd = which("nixd")
    if (!nixd) {
      log.info("nixd not found, please install nixd first")
      return
    }
    return {
      process: spawn(nixd, [], {
        cwd: root,
        env: {
          ...process.env,
        },
      }),
    }
  },
}
