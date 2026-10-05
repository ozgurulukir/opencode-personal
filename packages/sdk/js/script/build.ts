#!/usr/bin/env bun
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"
import path from "path"

import { createClient } from "@hey-api/openapi-ts"

const opencode = path.resolve(dir, "../../opencode")

await $`bun dev generate > ${dir}/openapi.json`.cwd(opencode)

await createClient({
  input: "./openapi.json",
  output: {
    path: "./src/v2/gen",
    tsConfigPath: path.join(dir, "tsconfig.json"),
    clean: true,
  },
  plugins: [
    {
      name: "@hey-api/typescript",
      exportFromIndex: false,
    },
    {
      name: "@hey-api/sdk",
      instance: "OpencodeClient",
      exportFromIndex: false,
      auth: false,
      paramsStructure: "flat",
    },
    {
      name: "@hey-api/client-fetch",
      exportFromIndex: false,
      baseUrl: "http://localhost:4096",
    },
  ],
})

await $`bun prettier --write src/v2`

// Post-generation patch: fix data-style error return in the regenerated v2 client.
// (The legacy v1 generation was removed during SDK consolidation; there is now a
// single generated client under src/v2/gen.)
for (const genDir of ["src/v2/gen"] as const) {
  const clientFile = path.join(dir, genDir, "client", "client.gen.ts")
  const typesFile = path.join(dir, genDir, "client", "types.gen.ts")

  const clientText = await Bun.file(clientFile).text()
  const patchedClient = clientText
    .replace(
      `      // TODO: we probably want to return error and improve types\n      return responseStyle === "data"\n        ? undefined\n        : {\n            error: finalError,\n            request,\n            response,\n          }`,
      `      return responseStyle === "data"\n        ? finalError\n        : {\n            error: finalError,\n            request,\n            response,\n          }`,
    )
    .replace(
      `    // TODO: we probably want to return error and improve types\n    return opts.responseStyle === "data"\n      ? undefined\n      : {\n          error: finalError,\n          ...result,\n        }`,
      `    return opts.responseStyle === "data"\n      ? finalError\n      : {\n          error: finalError,\n          ...result,\n        }`,
    )
  if (!/return (?:opts\.)?responseStyle === "data"\s*\? finalError/.test(patchedClient)) {
    throw new Error("Generated SDK error return changed; update the data-style error patch")
  }
  if (patchedClient !== clientText) await Bun.write(clientFile, patchedClient)

  const typesText = await Bun.file(typesFile).text()
  const patchedTypes = typesText
    .replace(
      `        ? (TData extends Record<string, unknown> ? TData[keyof TData] : TData) | undefined`,
      `        ? (TData extends Record<string, unknown> ? TData[keyof TData] : TData) | (TError extends Record<string, unknown> ? TError[keyof TError] : TError)`,
    )
    .replace(
      `        ? (TData extends Record<string, unknown> ? TData[keyof TData] : TData) | TError`,
      `        ? (TData extends Record<string, unknown> ? TData[keyof TData] : TData) | (TError extends Record<string, unknown> ? TError[keyof TError] : TError)`,
    )
  if (patchedTypes !== typesText) await Bun.write(typesFile, patchedTypes)
}

await $`bun prettier --write src/v2/gen/client/types.gen.ts`

await $`rm -rf dist`
await $`bun tsc`
await $`rm openapi.json`
