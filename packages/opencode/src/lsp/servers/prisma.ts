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

export const Prisma: Info = {
  id: "prisma",
  extensions: [".prisma"],
  root: NearestRoot(["schema.prisma", "prisma/schema.prisma", "prisma"], ["package.json"]),
  async spawn(root) {
    const prisma = which("prisma")
    if (!prisma) {
      log.info("prisma not found, please install prisma")
      return
    }
    return {
      process: spawn(prisma, ["language-server"], {
        cwd: root,
      }),
    }
  },
}
