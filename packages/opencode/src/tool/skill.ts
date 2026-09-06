import path from "path"
import { pathToFileURL } from "url"
import { Effect, Schema } from "effect"
import * as Stream from "effect/Stream"
import { Ripgrep } from "../file/ripgrep"
import { Skill } from "../skill"
import * as Tool from "./tool"
import DESCRIPTION from "./skill.txt"

export const Parameters = Schema.Struct({
  name: Schema.optional(Schema.String).annotate({
    description: "The name of a single skill from available_skills. Prefer 'names' for loading multiple skills.",
  }),
  names: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Array of skill names from available_skills. Use this to load multiple skills at once.",
  }),
})

// Each loaded skill spawns a ripgrep process and injects its full content into
// the output, so an unbounded names array means unbounded process spawns and
// context blowout. The model can split larger batches across calls.
const MAX_SKILLS_PER_CALL = 10

function formatSkillOutput(
  info: Skill.Info,
  files: string,
): string[] {
  const warningHeader = info.warnings && info.warnings.length > 0
    ? [`⚠️ Skill "${info.name}" has validation issues:`, ...info.warnings.map((w) => `  - ${w}`), ""]
    : []

  const dir = path.dirname(info.location)
  const base = pathToFileURL(dir).href

  return [
    ...warningHeader,
    `<skill_content name="${info.name}">`,
    `# Skill: ${info.name}`,
    "",
    info.content.trim(),
    "",
    `Base directory for this skill: ${base}`,
    "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
    "Note: file list is sampled.",
    "",
    "<skill_files>",
    files,
    "</skill_files>",
    "</skill_content>",
  ]
}

export const SkillTool = Tool.define(
  "skill",
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const rg = yield* Ripgrep.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          // Normalize to array of skill names. Loop, not spread — model-supplied
          // arrays can be large enough to blow engine argument limits.
          const skillNames: string[] = []
          if (params.names) for (const n of params.names) skillNames.push(n)
          if (params.name) skillNames.push(params.name)

          if (skillNames.length === 0) {
            const all = yield* skill.all()
            const available = all.map((item) => item.name).join(", ")
            throw new Error(`No skill names provided. Available skills: ${available || "none"}`)
          }

          // Deduplicate preserving order
          const uniqueNames = [...new Set(skillNames)]

          if (uniqueNames.length > MAX_SKILLS_PER_CALL) {
            throw new Error(
              `Cannot load ${uniqueNames.length} skills because the limit is ${MAX_SKILLS_PER_CALL} per call. To fix, split the names across multiple skill tool calls.`,
            )
          }

          // Look up all skills
          const infos: Skill.Info[] = []
          const notFound: string[] = []

          for (const name of uniqueNames) {
            const info = yield* skill.get(name)
            if (info) {
              infos.push(info)
            } else {
              notFound.push(name)
            }
          }

          if (notFound.length > 0) {
            const all = yield* skill.all()
            const available = all.map((item) => item.name).join(", ")
            const notFoundStr = notFound.map((n) => `"${n}"`).join(", ")
            throw new Error(`Skill(s) ${notFoundStr} not found. Available skills: ${available || "none"}`)
          }

          // Permission ask for all skills
          yield* ctx.ask({
            permission: "skill",
            patterns: uniqueNames,
            always: uniqueNames,
            metadata: {},
          })

          // Mark all skills as loaded
          for (const name of uniqueNames) {
            yield* skill.markLoaded(name)
          }

          // Get files for each skill and build combined output
          const outputParts: string[][] = []
          const metadataDirs: string[] = []
          const limit = 10

          for (const info of infos) {
            const dir = path.dirname(info.location)
            metadataDirs.push(dir)
            const files = yield* rg.files({ cwd: dir, follow: false, hidden: true, signal: ctx.abort }).pipe(
              Stream.filter((file) => !file.includes("SKILL.md")),
              Stream.map((file) => path.resolve(dir, file)),
              Stream.take(limit),
              Stream.runCollect,
              Effect.map((chunk) => [...chunk].map((file) => `<file>${file}</file>`).join("\n")),
            )
            outputParts.push(formatSkillOutput(info, files))
          }

          // Combined output with separator between skills
          const combinedOutput = outputParts.flatMap((part, idx) =>
            idx === 0 ? part : ["", "---", "", ...part],
          )

          const title = uniqueNames.length === 1
            ? `Loaded skill: ${uniqueNames[0]}`
            : `Loaded ${uniqueNames.length} skills: ${uniqueNames.join(", ")}`

          return {
            title,
            output: combinedOutput.join("\n"),
            metadata: {
              names: uniqueNames,
              dirs: metadataDirs,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
