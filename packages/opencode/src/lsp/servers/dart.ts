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

export const Dart: Info = {
  id: "dart",
  extensions: [".dart"],
  root: NearestRoot(["pubspec.yaml", "analysis_options.yaml"]),
  async spawn(root) {
    const dart = which("dart")
    if (!dart) {
      log.info("dart not found, please install dart first")
      return
    }
    return {
      process: spawn(dart, ["language-server", "--lsp"], {
        cwd: root,
      }),
    }
  },
}
