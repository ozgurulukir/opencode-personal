// The root entry of @opencode-ai/sdk now re-exports the v2 client.
// The v1 generation (src/gen/, src/client.ts) is frozen/stale and no longer
// consumed by any internal caller; it is removed in the consolidation cleanup.
// External consumers importing from "@opencode-ai/sdk" get the v2 surface.
export * from "./v2/index.js"

import { createOpencodeClient } from "./v2/client.js"
import { createOpencodeServer } from "./v2/server.js"
import type { ServerOptions } from "./v2/server.js"

export async function createOpencode(options?: ServerOptions) {
  const server = await createOpencodeServer({
    ...options,
  })

  const client = createOpencodeClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
