import { beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../fixture/fixture"
import { LSPClient } from "@/lsp/client"
import * as LSPServer from "@/lsp/server"
import { Instance } from "../../src/project/instance"
import { WithInstance } from "../../src/project/with-instance"
import * as Log from "@opencode-ai/core/util/log"

function spawnFakeServer() {
  const { spawn } = require("child_process")
  const serverPath = path.join(__dirname, "../fixture/lsp/fake-lsp-server.js")
  return {
    process: spawn(process.execPath, [serverPath], {
      stdio: "pipe",
    }),
  }
}

describe("LSPClient interop", () => {
  beforeEach(async () => {
    await Log.init({ print: true })
  })

  test("handles workspace/workspaceFolders request", async () => {
    const handle = spawnFakeServer() as any

    const client = await WithInstance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: process.cwd(),
          directory: process.cwd(),
        }),
    })

    await client.connection.sendNotification("test/trigger", {
      method: "workspace/workspaceFolders",
    })

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(client.connection).toBeDefined()
    await client.shutdown()
  })

  test("handles client/registerCapability request", async () => {
    const handle = spawnFakeServer() as any

    const client = await WithInstance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: process.cwd(),
          directory: process.cwd(),
        }),
    })

    await client.connection.sendNotification("test/trigger", {
      method: "client/registerCapability",
    })

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(client.connection).toBeDefined()
    await client.shutdown()
  })

  test("handles client/unregisterCapability request", async () => {
    const handle = spawnFakeServer() as any

    const client = await WithInstance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: process.cwd(),
          directory: process.cwd(),
        }),
    })

    await client.connection.sendNotification("test/trigger", {
      method: "client/unregisterCapability",
    })

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(client.connection).toBeDefined()
    await client.shutdown()
  })

  test("initialize does not overclaim unsupported diagnostics capabilities", async () => {
    const handle = spawnFakeServer() as any

    const client = await WithInstance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: process.cwd(),
          directory: process.cwd(),
        }),
    })

    const params = await client.connection.sendRequest<any>("test/get-initialize-params", {})
    expect(params.capabilities.workspace.diagnostics.refreshSupport).toBe(false)
    expect(params.capabilities.textDocument.publishDiagnostics.versionSupport).toBe(false)

    await client.shutdown()
  })

  test("workspace/configuration returns one result per requested item", async () => {
    const handle = spawnFakeServer() as any
    const initialization = {
      alpha: {
        beta: 1,
      },
      gamma: true,
    }

    const client = await WithInstance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: {
            ...(handle as unknown as LSPServer.Handle),
            initialization,
          },
          root: process.cwd(),
          directory: process.cwd(),
        }),
    })

    const response = await client.connection.sendRequest<any[]>("test/request-configuration", {
      items: [{ section: "alpha" }, { section: "alpha.beta" }, { section: "missing" }, {}],
    })

    expect(response).toEqual([{ beta: 1 }, 1, null, initialization])

    await client.shutdown()
  })

  test("sends ranged didChange for incremental sync servers", async () => {
    const handle = spawnFakeServer() as any
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "client.ts")
    await Bun.write(file, "first\n")

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
          directory: tmp.path,
        })

        await client.notify.open({ path: file })
        await Bun.write(file, "second\nthird\n")
        await client.notify.open({ path: file })

        const change = await client.connection.sendRequest<{
          textDocument: { version: number }
          contentChanges: {
            range?: { start: { line: number; character: number }; end: { line: number; character: number } }
            text: string
          }[]
        }>("test/get-last-change", {})
        expect(change.textDocument.version).toBe(1)
        expect(change.contentChanges).toEqual([
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 1, character: 0 },
            },
            text: "second\nthird\n",
          },
        ])

        await client.shutdown()
      },
    })
  })

  test("document mode falls back to push diagnostics", async () => {
    const handle = spawnFakeServer() as any
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "client.ts")
    await Bun.write(file, "const x = 1\n")

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
          directory: tmp.path,
        })

        const version = await client.notify.open({ path: file })
        const wait = client.waitForDiagnostics({ path: file, version, mode: "document" })
        await client.connection.sendNotification("test/publish-diagnostics", {
          uri: pathToFileURL(file).href,
          version,
          diagnostics: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 5 },
              },
              message: "push diagnostic",
              severity: 1,
            },
          ],
        })
        await wait

        const diagnostics = client.diagnostics.get(file) ?? []
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]?.message).toBe("push diagnostic")

        const count = await client.connection.sendRequest("test/get-diagnostic-request-count", {})
        expect(count).toBe(0)

        await client.shutdown()
      },
    })
  })

  test("document mode accepts matching push diagnostics published before waiting", async () => {
    const handle = spawnFakeServer() as any
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "client.ts")
    await Bun.write(file, "const x = 1\n")

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
          directory: tmp.path,
        })

        const version = await client.notify.open({ path: file })
        await client.connection.sendNotification("test/publish-diagnostics", {
          uri: pathToFileURL(file).href,
          version,
          diagnostics: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 5 },
              },
              message: "push diagnostic",
              severity: 1,
            },
          ],
        })

        for (let i = 0; i < 20 && (client.diagnostics.get(file)?.length ?? 0) === 0; i++) {
          await new Promise((resolve) => setTimeout(resolve, 25))
        }

        expect(client.diagnostics.get(file)?.[0]?.message).toBe("push diagnostic")

        const started = Date.now()
        await client.waitForDiagnostics({ path: file, version, mode: "document" })
        expect(Date.now() - started).toBeLessThan(1_000)

        await client.shutdown()
      },
    })
  })

  test("document mode waits for pull diagnostics", async () => {
    const handle = spawnFakeServer() as any
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "client.cs")
    await Bun.write(file, "class C {}\n")

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
          directory: tmp.path,
        })

        await client.connection.sendRequest("test/configure-pull-diagnostics", {
          registerOn: "didOpen",
          registrations: [{ identifier: "DocumentCompilerSemantic" }],
          documentDiagnosticsByIdentifier: {
            DocumentCompilerSemantic: [
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 5 },
                },
                message: "pull diagnostic",
                severity: 1,
              },
            ],
          },
        })

        const version = await client.notify.open({ path: file })
        await client.waitForDiagnostics({ path: file, version, mode: "document" })

        const diagnostics = client.diagnostics.get(file) ?? []
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]?.message).toBe("pull diagnostic")

        const count = await client.connection.sendRequest("test/get-diagnostic-request-count", {})
        expect(count).toBeGreaterThan(0)

        await client.shutdown()
      },
    })
  })

  test("document mode does not wait for the slowest pull identifier after current-file diagnostics arrive", async () => {
    const handle = spawnFakeServer() as any
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "client.cs")
    await Bun.write(file, "class C {}\n")

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
          directory: tmp.path,
        })

        await client.connection.sendRequest("test/configure-pull-diagnostics", {
          registrations: [{ identifier: "fast" }, { identifier: "slow" }],
          documentDiagnosticsByIdentifier: {
            fast: [
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 5 },
                },
                message: "fast diagnostic",
                severity: 1,
              },
            ],
            slow: [],
          },
          documentDelayMsByIdentifier: {
            slow: 2_500,
          },
        })

        const version = await client.notify.open({ path: file })
        await client.connection.sendRequest("test/register-configured-pull-diagnostics", {})
        await new Promise((resolve) => setTimeout(resolve, 100))
        const started = Date.now()
        await client.waitForDiagnostics({ path: file, version, mode: "document" })

        expect(Date.now() - started).toBeLessThan(1_000)
        expect(client.diagnostics.get(file)?.[0]?.message).toBe("fast diagnostic")
        expect(await client.connection.sendRequest("test/get-diagnostic-request-count", {})).toBeGreaterThan(1)

        await client.shutdown()
      },
    })
  })

  test("full mode includes workspace pull diagnostics", async () => {
    const handle = spawnFakeServer() as any
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "client.cs")
    const related = path.join(tmp.path, "other.cs")
    await Bun.write(file, "class C {}\n")
    await Bun.write(related, "class D {}\n")

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
          directory: tmp.path,
        })

        await client.connection.sendRequest("test/configure-pull-diagnostics", {
          registerOn: "didOpen",
          registrations: [
            { identifier: "DocumentCompilerSemantic" },
            { identifier: "WorkspaceDocumentsAndProject", workspaceDiagnostics: true },
          ],
          documentDiagnosticsByIdentifier: {
            DocumentCompilerSemantic: [
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 5 },
                },
                message: "current file",
                severity: 1,
              },
            ],
          },
          workspaceDiagnosticsByIdentifier: {
            WorkspaceDocumentsAndProject: [
              {
                uri: pathToFileURL(related).href,
                items: [
                  {
                    range: {
                      start: { line: 0, character: 0 },
                      end: { line: 0, character: 5 },
                    },
                    message: "workspace file",
                    severity: 1,
                  },
                ],
              },
            ],
          },
        })

        const version = await client.notify.open({ path: file })
        await client.waitForDiagnostics({ path: file, version, mode: "full" })

        expect(client.diagnostics.get(file)?.[0]?.message).toBe("current file")
        expect(client.diagnostics.get(related)?.[0]?.message).toBe("workspace file")

        await client.shutdown()
      },
    })
  })

  test("full mode treats an empty workspace pull response as handled", async () => {
    const handle = spawnFakeServer() as any
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "client.cs")
    await Bun.write(file, "class C {}\n")

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
          directory: tmp.path,
        })

        await client.connection.sendRequest("test/configure-pull-diagnostics", {
          registerOn: "didOpen",
          registrations: [{ identifier: "WorkspaceDocumentsAndProject", workspaceDiagnostics: true }],
          workspaceDiagnosticsByIdentifier: {
            WorkspaceDocumentsAndProject: [],
          },
        })

        const version = await client.notify.open({ path: file })
        const started = Date.now()
        await client.waitForDiagnostics({ path: file, version, mode: "full" })

        expect(Date.now() - started).toBeLessThan(1_000)

        await client.shutdown()
      },
    })
  })

  test("notify.close cleans up diagnostics and document state", async () => {
    const handle = spawnFakeServer() as any
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "client.ts")
    await Bun.write(file, "const x = 1\n")

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
          directory: tmp.path,
        })

        const version = await client.notify.open({ path: file })
        await client.connection.sendNotification("test/publish-diagnostics", {
          uri: pathToFileURL(file).href,
          version,
          diagnostics: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              message: "push diagnostic",
              severity: 1,
            },
          ],
        })

        await client.waitForDiagnostics({ path: file, version, mode: "document" })
        expect(client.diagnostics.get(file)).toHaveLength(1)

        await client.notify.close({ path: file })
        expect(client.diagnostics.get(file)).toBeUndefined()

        await client.shutdown()
      },
    })
  })

  test("publishDiagnostics bounds diagnostic maps to MAX_DIAGNOSTICS on the server-push path", async () => {
    const handle = spawnFakeServer() as any
    await using tmp = await tmpdir()

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
          directory: tmp.path,
        })

        // Push diagnostics for 300 unique paths without ever calling notify.open.
        // The MAX_OPEN_FILES guard in notify.open never fires here, so the
        // MAX_DIAGNOSTICS eviction in the publishDiagnostics handler must bound
        // the maps.
        for (let i = 0; i < 300; i++) {
          await client.connection.sendNotification("test/publish-diagnostics", {
            uri: pathToFileURL(path.join(tmp.path, `file-${i}.ts`)).href,
            diagnostics: [
              {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
                message: `push ${i}`,
                severity: 1,
              },
            ],
          })
        }

        // Give the client a tick to process the notifications.
        await new Promise((resolve) => setTimeout(resolve, 200))

        expect(client.diagnostics.size).toBeLessThanOrEqual(200)
        // The oldest entries are evicted first.
        expect(client.diagnostics.get(path.join(tmp.path, "file-0.ts"))).toBeUndefined()
        // The most recent entries survive.
        expect(client.diagnostics.get(path.join(tmp.path, "file-299.ts"))?.[0]?.message).toBe("push 299")

        await client.shutdown()
      },
    })
  })

  test("publishDiagnostics eviction sends didClose for files also in the open files record", async () => {
    const handle = spawnFakeServer() as any
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "client.ts")
    await Bun.write(file, "const x = 1\n")

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
          directory: tmp.path,
        })

        // Open a file so it lands in the `files` record.
        await client.notify.open({ path: file })

        // Push diagnostics for the opened file first so it becomes the oldest
        // entry in pushDiagnostics (notify.open deletes it from the maps on open).
        await client.connection.sendNotification("test/publish-diagnostics", {
          uri: pathToFileURL(file).href,
          diagnostics: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              message: "opened file",
              severity: 1,
            },
          ],
        })

        // Push diagnostics for 300 more unique paths. The opened file is now the
        // oldest entry, so eviction must send didClose and remove it from files.
        for (let i = 0; i < 300; i++) {
          await client.connection.sendNotification("test/publish-diagnostics", {
            uri: pathToFileURL(path.join(tmp.path, `file-${i}.ts`)).href,
            diagnostics: [
              {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
                message: `push ${i}`,
                severity: 1,
              },
            ],
          })
        }

        await new Promise((resolve) => setTimeout(resolve, 200))

        // The opened file was evicted: didClose was sent and its diagnostics are gone.
        const didCloseCount = await client.connection.sendRequest("test/get-did-close-count", {})
        expect(didCloseCount).toBeGreaterThan(0)
        expect(client.diagnostics.get(file)).toBeUndefined()

        await client.shutdown()
      },
    })
  })

  test("notify.open LRU eviction cleans all four maps when files overflow", async () => {
    const handle = spawnFakeServer() as any
    await using tmp = await tmpdir()

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
          directory: tmp.path,
        })

        // Open the first file and push diagnostics for it so it is present in
        // both the files record and the diagnostic maps.
        const first = path.join(tmp.path, "open-0.ts")
        await Bun.write(first, "const x = 1\n")
        await client.notify.open({ path: first })
        await client.connection.sendNotification("test/publish-diagnostics", {
          uri: pathToFileURL(first).href,
          diagnostics: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              message: "first file",
              severity: 1,
            },
          ],
        })

        // Open 50 more files (MAX_OPEN_FILES = 50) so the LRU guard fires and
        // evicts the oldest entry (open-0.ts).
        for (let i = 1; i <= 50; i++) {
          const file = path.join(tmp.path, `open-${i}.ts`)
          await Bun.write(file, "const x = 1\n")
          await client.notify.open({ path: file })
        }

        await new Promise((resolve) => setTimeout(resolve, 100))

        // The evicted file's diagnostics are gone from all maps.
        expect(client.diagnostics.get(first)).toBeUndefined()

        await client.shutdown()
      },
    })
  })

  test("shutdown clears all diagnostic maps", async () => {
    const handle = spawnFakeServer() as any
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "client.ts")
    await Bun.write(file, "const x = 1\n")

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const client = await LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: tmp.path,
          directory: tmp.path,
        })

        await client.notify.open({ path: file })
        await client.connection.sendNotification("test/publish-diagnostics", {
          uri: pathToFileURL(file).href,
          diagnostics: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              message: "push diagnostic",
              severity: 1,
            },
          ],
        })

        await new Promise((resolve) => setTimeout(resolve, 100))
        expect(client.diagnostics.get(file)).toBeDefined()

        await client.shutdown()
        expect(client.diagnostics.size).toBe(0)
      },
    })
  })
})
