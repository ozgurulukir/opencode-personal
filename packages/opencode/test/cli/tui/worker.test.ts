import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { rpc } from "../../../src/cli/cmd/tui/worker"
import { Server } from "../../../src/server/server"
import { ServerAuth } from "../../../src/server/auth"
import { InstanceRuntime } from "../../../src/project/instance-runtime"
import { AppRuntime } from "../../../src/effect/app-runtime"
import { GlobalBus, type GlobalEvent } from "../../../src/bus/global"
import { Rpc } from "../../../src/util/rpc"
import * as v8 from "node:v8"

describe("cli/cmd/tui/worker rpc", () => {
  afterEach(() => {
    mock.restore()
  })

  test("GlobalBus event listener forwards events via Rpc.emit", () => {
    const emitSpy = spyOn(Rpc, "emit").mockImplementation(() => {})
    const mockEvent: GlobalEvent = { payload: { foo: "bar" } }

    GlobalBus.emit("event", mockEvent)

    expect(emitSpy).toHaveBeenCalledWith("global.event", mockEvent)
  })

  test("fetch executes server request with injected auth headers", async () => {
    spyOn(ServerAuth, "header").mockReturnValue("Bearer mock-token")

    const mockFetch = mock(async (req: Request) => {
      expect(req.headers.get("authorization")).toBe("Bearer mock-token")
      expect(req.headers.get("x-custom")).toBe("value")
      return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } })
    })

    spyOn(Server, "Default").mockReturnValue({
      app: {
        fetch: mockFetch,
        request: () => {
          throw new Error("not implemented")
        },
      },
    })

    const result = await rpc.fetch({
      url: "http://localhost/test",
      method: "POST",
      headers: { "x-custom": "value" },
      body: "data",
    })

    expect(result.status).toBe(200)
    expect(result.body).toBe("ok")
    expect(result.headers["content-type"]).toBe("text/plain")
  })

  test("fetch preserves explicit authorization header when present", async () => {
    spyOn(ServerAuth, "header").mockReturnValue("Bearer default-token")

    const mockFetch = mock(async (req: Request) => {
      expect(req.headers.get("authorization")).toBe("Bearer explicit-token")
      return new Response("ok", { status: 200, headers: {} })
    })

    spyOn(Server, "Default").mockReturnValue({
      app: {
        fetch: mockFetch,
        request: () => {
          throw new Error("not implemented")
        },
      },
    })

    const result = await rpc.fetch({
      url: "http://localhost/test",
      method: "GET",
      headers: { Authorization: "Bearer explicit-token" },
    })

    expect(result.status).toBe(200)
  })

  test("snapshot writes heap snapshot file", () => {
    const spy = spyOn(v8, "writeHeapSnapshot").mockReturnValue("server.heapsnapshot")
    const res = rpc.snapshot()
    expect(res).toBe("server.heapsnapshot")
    expect(spy).toHaveBeenCalledWith("server.heapsnapshot")
  })

  test("server stops existing server if running and starts new server", async () => {
    const stopSpy = mock(async () => {})
    const mockListener = {
      port: 8080,
      hostname: "127.0.0.1",
      url: new URL("http://127.0.0.1:8080"),
      stop: stopSpy,
    }

    const listenSpy = spyOn(Server, "listen").mockResolvedValue(mockListener)

    // First call to start server
    const result1 = await rpc.server({ port: 8080, hostname: "127.0.0.1" })
    expect(result1.url).toBe("http://127.0.0.1:8080/")
    expect(listenSpy).toHaveBeenCalledWith({ port: 8080, hostname: "127.0.0.1" })

    // Second call should stop the previous server first
    const mockListener2 = {
      port: 8081,
      hostname: "127.0.0.1",
      url: new URL("http://127.0.0.1:8081"),
      stop: mock(async () => {}),
    }
    listenSpy.mockResolvedValue(mockListener2)

    const result2 = await rpc.server({ port: 8081, hostname: "127.0.0.1" })
    expect(stopSpy).toHaveBeenCalledWith(true)
    expect(result2.url).toBe("http://127.0.0.1:8081/")
  })

  test("reload runs AppRuntime promise to invalidate config and dispose instances", async () => {
    // oxlint-disable-next-line no-unsafe-type-assertion
    const runPromiseSpy = spyOn(AppRuntime, "runPromise").mockImplementation(() => Promise.resolve(undefined as never))

    await rpc.reload()

    expect(runPromiseSpy).toHaveBeenCalled()
  })

  test("shutdown disposes all instances and stops active server", async () => {
    const disposeSpy = spyOn(InstanceRuntime, "disposeAllInstances").mockResolvedValue()

    const stopSpy = mock(async () => {})
    spyOn(Server, "listen").mockResolvedValue({
      port: 8080,
      hostname: "127.0.0.1",
      url: new URL("http://127.0.0.1:8080"),
      stop: stopSpy,
    })

    // Start a server so internal 'server' variable is set
    await rpc.server({ port: 8080, hostname: "127.0.0.1" })

    await rpc.shutdown()

    expect(disposeSpy).toHaveBeenCalled()
    expect(stopSpy).toHaveBeenCalledWith(true)
  })
})
