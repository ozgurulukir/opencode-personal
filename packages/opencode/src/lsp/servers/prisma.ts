import {
  type Info,
  NearestRoot,
  spawn,
  which,
  log,
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
