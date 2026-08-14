import path from "path"
import { Filesystem } from "@/util/filesystem"

export function venvCandidates(root: string): string[] {
  return [process.env["VIRTUAL_ENV"], path.join(root, ".venv"), path.join(root, "venv")].filter(
    (p): p is string => p !== undefined,
  )
}

export async function resolveVenvPython(root: string): Promise<string | undefined> {
  const isWindows = process.platform === "win32"
  const pythonPaths = venvCandidates(root).map((venvPath) =>
    isWindows ? path.join(venvPath, "Scripts", "python.exe") : path.join(venvPath, "bin", "python"),
  )
  const pythonExists = await Promise.all(pythonPaths.map((p) => Filesystem.exists(p)))
  const pythonIndex = pythonExists.findIndex(Boolean)
  return pythonIndex !== -1 ? pythonPaths[pythonIndex] : undefined
}
