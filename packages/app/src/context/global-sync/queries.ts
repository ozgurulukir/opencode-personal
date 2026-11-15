import { queryOptions } from "@tanstack/solid-query"
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"

export const mcpQueryKey = (directory: string) => [directory, "mcp"] as const

export const loadMcpQuery = (directory: string, sdk: OpencodeClient) =>
  queryOptions({
    queryKey: mcpQueryKey(directory),
    queryFn: () => sdk.mcp.status().then((r) => r.data ?? {}),
  })

export const lspQueryKey = (directory: string) => [directory, "lsp"] as const

export const loadLspQuery = (directory: string, sdk: OpencodeClient) =>
  queryOptions({
    queryKey: lspQueryKey(directory),
    queryFn: () => sdk.lsp.status().then((r) => r.data ?? []),
  })
