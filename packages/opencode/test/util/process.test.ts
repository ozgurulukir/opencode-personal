import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Process } from "@/util/process"
import { tmpdir } from "../fixture/fixture"

async function node<T>(script: string, fn: (command: string[]) => Promise<T>) {
  await using tmp = await tmpdir()
  const scriptPath = path.join(tmp.path, "script.js")
  await Bun.write(scriptPath, script)
  const result = await fn([process.execPath, scriptPath])
  return result
}

describe("util.process", () => {
  test("captures stdout and stderr", async () => {
    const out = await node('process.stdout.write("out");process.stderr.write("err")', (command) =>
      Process.run(command),
    )
    expect(out.code).toBe(0)
    expect(out.stdout.toString()).toBe("out")
    expect(out.stderr.toString()).toBe("err")
  }, 30000)

  test("returns code when nothrow is enabled", async () => {
    const out = await node("process.exit(7)", (command) => Process.run(command, { nothrow: true }))
    expect(out.code).toBe(7)
  }, 30000)

  test("throws RunFailedError on non-zero exit", async () => {
    const err = await node('process.stderr.write("bad");process.exit(3)', (command) =>
      Process.run(command).catch((error) => error),
    )
    expect(err).toBeInstanceOf(Process.RunFailedError)
    if (!(err instanceof Process.RunFailedError)) throw err
    expect(err.code).toBe(3)
    expect(err.stderr.toString()).toBe("bad")
  }, 30000)

  test("aborts a running process", async () => {
    const abort = new AbortController()
    const started = Date.now()
    setTimeout(() => abort.abort(), 25)

    const out = await node("setInterval(() => {}, 1000)", (command) =>
      Process.run(command, {
        abort: abort.signal,
        nothrow: true,
      }),
    )

    expect(out.code).not.toBe(0)
    expect(Date.now() - started).toBeLessThan(1000)
  }, 30000)

  test("kills after timeout when process ignores terminate signal", async () => {
    if (process.platform === "win32") return

    const abort = new AbortController()
    const started = Date.now()
    setTimeout(() => abort.abort(), 25)

    const out = await node('process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)', (command) =>
      Process.run(command, {
        abort: abort.signal,
        nothrow: true,
        timeout: 25,
      }),
    )

    expect(out.code).not.toBe(0)
    expect(Date.now() - started).toBeLessThan(1000)
  }, 30000)

  test("uses cwd when spawning commands", async () => {
    await using tmp = await tmpdir()
    const out = await node("process.stdout.write(process.cwd())", (command) =>
      Process.run(command, {
        cwd: tmp.path,
      }),
    )
    expect(out.stdout.toString()).toBe(tmp.path)
  }, 30000)

  test("merges environment overrides", async () => {
    const out = await node('process.stdout.write(process.env.OPENCODE_TEST ?? "")', (command) =>
      Process.run(command, {
        env: {
          OPENCODE_TEST: "set",
        },
      }),
    )
    expect(out.stdout.toString()).toBe("set")
  }, 30000)

  test("rejects shell option in process spawning", () => {
    expect(() => {
      Process.spawn(["echo", "hello"], {
        shell: true,
      })
    }).toThrow("Shell execution is disabled")
  })

  test("runs copied executables with spaces on Windows without shell", async () => {
    if (process.platform !== "win32") return

    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "with space")
    const file = path.join(dir, "bun.exe")

    await fs.mkdir(dir, { recursive: true })
    await fs.copyFile(process.execPath, file)

    const proc = Process.spawn([file, "--version"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })

    expect(await proc.exited).toBe(0)
  }, 30000)

  test("rejects missing commands without leaking unhandled errors", async () => {
    await using tmp = await tmpdir()
    const cmd = path.join(tmp.path, "missing-command")
    const err = await Process.spawn([cmd], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    }).exited.catch((err) => err)

    expect(err).toBeInstanceOf(Error)
    if (!(err instanceof Error)) throw err
    expect(err).toMatchObject({
      code: "ENOENT",
    })
  })

  test("rejects shell path containing injection characters", () => {
    expect(() => {
      Process.spawn(["echo", "hello"], {
        shell: "/bin/sh; rm -rf /",
      })
    }).toThrow("Invalid shell path")
  })

  test("rejects command with control characters or null bytes", () => {
    expect(() => {
      Process.spawn(["echo\0malicious", "hello"])
    }).toThrow("Invalid command")
    expect(() => {
      Process.spawn(["echo\nmalicious", "hello"])
    }).toThrow("Invalid command")
  })

  test("rejects command with shell metacharacters", () => {
    for (const command of [
      "safe;malicious",
      "safe|malicious",
      "safe&malicious",
      "safe<malicious",
      "safe>malicious",
      "safe`malicious",
      "safe$malicious",
    ]) {
      expect(() => Process.spawn([command, "hello"])).toThrow("Invalid command")
    }
  })
})
