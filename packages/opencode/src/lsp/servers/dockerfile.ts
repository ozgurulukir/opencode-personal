import {
  type Info,
  spawn,
  which,
  Flag,
  Npm,
} from "./shared"

export const DockerfileLS: Info = {
  id: "dockerfile",
  extensions: [".dockerfile", "Dockerfile"],
  root: async (_file, ctx) => ctx.directory,
  async spawn(root) {
    let binary = which("docker-langserver")
    const args: string[] = []
    if (!binary) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      const resolved = await Npm.which("dockerfile-language-server-nodejs")
      if (!resolved) return
      binary = resolved
    }
    args.push("--stdio")
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
