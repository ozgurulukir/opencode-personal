import { describe, expect, test } from "bun:test"
import { authenticate } from "../../../../src/routes/zen/util/auth"

function createDeps(row: any, adminWs: string[] = []) {
  const mockThen: Promise<any> = {
    then: (cb: (rows: any[]) => any) => Promise.resolve([row]).then(cb),
  } as any
  const mockTx = {
    select: () => mockTx,
    from: () => mockTx,
    innerJoin: () => mockTx,
    leftJoin: () => mockTx,
    where: () => mockThen,
  }
  return {
    t: (key: string) => key,
    Database: { use: async (fn: any) => fn(mockTx) },
    ADMIN_WORKSPACES: adminWs,
  }
}

describe("authenticate", () => {
  test("returns undefined when zenApiKey is empty and allowAnonymous", async () => {
    expect(await authenticate({ allowAnonymous: true }, undefined, createDeps(null))).toBeUndefined()
    expect(await authenticate({ allowAnonymous: true }, "", createDeps(null))).toBeUndefined()
  })

  test("throws AuthError when zenApiKey is empty and no anonymous", () => {
    expect(() => authenticate({ allowAnonymous: false }, undefined, createDeps(null))).toThrow(
      "zen.api.error.missingApiKey",
    )
  })

  test("returns auth info for valid key", async () => {
    const row = {
      apiKey: "key-1",
      workspaceID: "ws-1",
      billing: { balance: 1000 },
      user: {},
      black: {},
      lite: {},
      provider: null,
      timeDisabled: null,
    }
    const result = await authenticate({ id: "gpt-4o" }, "key", createDeps(row))
    expect(result.workspaceID).toBe("ws-1")
    expect(result.billing.balance).toBe(1000)
  })

  test("marks admin workspace as isFree", async () => {
    const row = {
      apiKey: "k",
      workspaceID: "ws-a",
      billing: {},
      user: {},
      black: {},
      lite: {},
      provider: null,
      timeDisabled: null,
    }
    const result = await authenticate({ id: "gpt-4o" }, "key", createDeps(row, ["ws-a"]))
    expect(result.isFree).toBe(true)
  })

  test("marks non-admin workspace as not isFree", async () => {
    const row = {
      apiKey: "k",
      workspaceID: "ws-b",
      billing: {},
      user: {},
      black: {},
      lite: {},
      provider: null,
      timeDisabled: null,
    }
    const result = await authenticate({ id: "gpt-4o" }, "key", createDeps(row, ["other-ws"]))
    expect(result.isFree).toBe(false)
  })
})
