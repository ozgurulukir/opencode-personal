import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs"
import os from "os"
import { Shell } from "../../src/shell/shell"
import { Filesystem } from "@/util/filesystem"
import { which } from "../../src/util/which"

const withShell = async (shell: string | undefined, fn: () => void | Promise<void>) => {
  const prev = process.env.SHELL
  if (shell === undefined) delete process.env.SHELL
  else process.env.SHELL = shell
  Shell.acceptable.reset()
  Shell.preferred.reset()
  try {
    await fn()
  } finally {
    if (prev === undefined) delete process.env.SHELL
    else process.env.SHELL = prev
    Shell.acceptable.reset()
    Shell.preferred.reset()
  }
}

describe("shell", () => {
  test("normalizes shell names", () => {
    expect(Shell.name("/bin/bash")).toBe("bash")
    if (process.platform === "win32") {
      expect(Shell.name("C:/tools/NU.EXE")).toBe("nu")
      expect(Shell.name("C:/tools/PWSH.EXE")).toBe("pwsh")
    }
  })

  test("detects login shells", () => {
    expect(Shell.login("/bin/bash")).toBe(true)
    expect(Shell.login("C:/tools/pwsh.exe")).toBe(false)
  })

  test("detects posix shells", () => {
    expect(Shell.posix("/bin/bash")).toBe(true)
    expect(Shell.posix("/bin/fish")).toBe(false)
    expect(Shell.posix("C:/tools/pwsh.exe")).toBe(false)
  })

  test("falls back when configured shell cannot be resolved", async () => {
    await withShell(undefined, async () => {
      const preferred = Shell.preferred()
      const acceptable = Shell.acceptable()
      expect(Shell.preferred("opencode-missing-shell")).toBe(preferred)
      expect(Shell.acceptable("opencode-missing-shell")).toBe(acceptable)
    })
  })

  test("falls back for terminal-only acceptable shells", () => {
    expect(Shell.name(Shell.acceptable("fish"))).not.toBe("fish")
    expect(Shell.name(Shell.acceptable("nu"))).not.toBe("nu")
  })

  if (process.platform === "win32") {
    test("rejects blacklisted shells case-insensitively", async () => {
      await withShell("NU.EXE", async () => {
        expect(Shell.name(Shell.acceptable())).not.toBe("nu")
      })
    })

    test("normalizes Git Bash shell paths from env", async () => {
      const shell = "/cygdrive/c/Program Files/Git/bin/bash.exe"
      await withShell(shell, async () => {
        expect(Shell.preferred()).toBe(Filesystem.windowsPath(shell))
      })
    })

    test("resolves /usr/bin/bash from env to Git Bash", async () => {
      const bash = Shell.gitbash()
      if (!bash) return
      await withShell("/usr/bin/bash", async () => {
        expect(Shell.acceptable()).toBe(bash)
        expect(Shell.preferred()).toBe(bash)
      })
    })

    test("resolves bare bash to Git Bash before PATH", async () => {
      const bash = Shell.gitbash()
      if (!bash) return
      expect(Shell.acceptable("bash")).toBe(bash)
      expect(Shell.preferred("bash")).toBe(bash)
      await withShell("bash", async () => {
        expect(Shell.acceptable()).toBe(bash)
        expect(Shell.preferred()).toBe(bash)
      })
    })

    test("resolves bare PowerShell shells", async () => {
      const shell = which("pwsh") || which("powershell")
      if (!shell) return
      await withShell(path.win32.basename(shell), async () => {
        expect(Shell.preferred()).toBe(shell)
      })
    })
  }
})

describe("bash args round-trip", () => {
  // Skipped where bash is unavailable (e.g. Windows without Git Bash).
  const bash = process.platform === "win32" ? undefined : which("bash") || "/bin/bash"

  const run = async (command: string, cwd?: string) => {
    if (!bash) return { stdout: "", code: 0 }
    const args = Shell.args(bash, command, cwd ?? process.cwd())
    const proc = Bun.spawn([bash, ...args], { stdout: "pipe", stderr: "pipe" })
    const stdout = await new Response(proc.stdout).text()
    const code = await proc.exited
    return { stdout, code }
  }

  test("passes newline-separated commands through verbatim", async () => {
    if (!bash) return
    const { stdout, code } = await run("echo one\necho two")
    expect(code).toBe(0)
    expect(stdout).toBe("one\ntwo\n")
  })

  test("preserves tabs and carriage returns through printf escapes", async () => {
    if (!bash) return
    const { stdout, code } = await run("printf 'a\\tb\\rc'")
    expect(code).toBe(0)
    expect(stdout).toBe("a\tb\rc")
  })

  test("keeps dollar expansions inside single quotes literal", async () => {
    if (!bash) return
    const { stdout, code } = await run("echo 'costs $5 and ${HOME} literal'")
    expect(code).toBe(0)
    expect(stdout).toBe("costs $5 and ${HOME} literal\n")
  })

  test("expands variables exactly once at eval time", async () => {
    if (!bash) return
    const { stdout, code } = await run("V='two  words'; echo \"$V\"")
    expect(code).toBe(0)
    expect(stdout).toBe("two  words\n")
  })

  test("handles escaped double quotes", async () => {
    if (!bash) return
    const { stdout, code } = await run('echo "a \\"quoted\\" word"')
    expect(code).toBe(0)
    expect(stdout).toBe('a "quoted" word\n')
  })

  test("executes backtick command substitution at eval time", async () => {
    if (!bash) return
    const { stdout, code } = await run("v=`echo hi`; echo \"$v\"")
    expect(code).toBe(0)
    expect(stdout).toBe("hi\n")
  })

  test("preserves control characters through printf escapes", async () => {
    if (!bash) return
    const { stdout, code } = await run("printf 'a\\001b'")
    expect(code).toBe(0)
    expect(stdout).toBe("a\x01b")
  })

  test("runs in the cwd passed as the first positional", async () => {
    if (!bash) return
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "shell-args-")))
    try {
      const { stdout, code } = await run("pwd", dir)
      expect(code).toBe(0)
      expect(stdout.trim()).toBe(dir)
    } finally {
      fs.rmdirSync(dir)
    }
  })
})
