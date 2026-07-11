import { describe, expect, test } from "bun:test"
import { parseRequest } from "../../../../src/routes/zen/util/request"

describe("parseRequest", () => {
  test("parses request info from APIEvent", async () => {
    const headers = new Headers({
      "x-real-ip": "192.168.1.1",
      "x-opencode-session": "session-1",
      "x-opencode-request": "request-1",
      "x-opencode-project": "project-1",
      "x-opencode-client": "client-1",
      "user-agent": "test-agent",
    })
    const input = {
      request: {
        url: "https://example.com/v1/chat/completions",
        headers,
        json: async () => ({ model: "gpt-4o", stream: true }),
      },
    } as any

    const result = await parseRequest(input, {
      parseApiKey: () => "key-1",
      parseModel: (_url, body) => (body as any).model,
      parseVariant: (_url, body) => (body as any).variant,
      parseIsStream: (_url, body) => !!(body as any).stream,
    })

    expect(result.url).toBe("https://example.com/v1/chat/completions")
    expect(result.model).toBe("gpt-4o")
    expect(result.variant).toBeUndefined()
    expect(result.isStream).toBe(true)
    expect(result.ip).toBe("192.168.1.1")
    expect(result.zenApiKey).toBe("key-1")
    expect(result.sessionId).toBe("session-1")
    expect(result.requestId).toBe("request-1")
    expect(result.projectId).toBe("project-1")
    expect(result.ocClient).toBe("client-1")
    expect(result.userAgent).toBe("test-agent")
  })

  test("treats public api key as undefined", async () => {
    const input = {
      request: {
        url: "https://example.com/v1/chat/completions",
        headers: new Headers({}),
        json: async () => ({ model: "gpt-4o" }),
      },
    } as any

    const result = await parseRequest(input, {
      parseApiKey: () => "public",
      parseModel: (_url, body) => (body as any).model,
      parseVariant: () => undefined,
      parseIsStream: () => false,
    })

    expect(result.zenApiKey).toBeUndefined()
  })

  test("truncates IPv6 address to first 4 hextets", async () => {
    const input = {
      request: {
        url: "https://example.com/v1/chat/completions",
        headers: new Headers({ "x-real-ip": "2001:0db8:85a3:0000:0000:8a2e:0370:7334" }),
        json: async () => ({ model: "gpt-4o" }),
      },
    } as any

    const result = await parseRequest(input, {
      parseApiKey: () => undefined,
      parseModel: (_url, body) => (body as any).model,
      parseVariant: () => undefined,
      parseIsStream: () => false,
    })

    expect(result.ip).toBe("2001:0db8:85a3:0000")
  })
})
