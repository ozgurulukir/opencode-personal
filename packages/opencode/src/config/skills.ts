import { Schema } from "effect"
import { zod } from "@opencode-ai/core/effect-zod"
import { withStatics } from "@opencode-ai/core/schema"

export const Info = Schema.Struct({
  paths: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Additional paths to skill folders",
  }),
  urls: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "URLs to fetch skills from (e.g., https://example.com/.well-known/skills/)",
  }),
  autoMatch: Schema.optional(Schema.Boolean).annotate({
    description:
      "Automatically inject top-matching skills into context via semantic search. Requires the embedding service (local or OpenAI).",
  }),
  autoMatchCount: Schema.optional(Schema.Number).annotate({
    description: "Number of top-matching skills to inject (default: 3)",
  }),
  autoMatchThreshold: Schema.optional(Schema.Number).annotate({
    description: "Minimum cosine similarity threshold (0-1, default: 0.25). Skills below this score are not injected.",
  }),
}).pipe(withStatics((s) => ({ zod: zod(s) })))

export type Info = Schema.Schema.Type<typeof Info>

export * as ConfigSkills from "./skills"
