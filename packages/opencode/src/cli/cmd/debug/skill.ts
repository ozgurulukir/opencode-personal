import { EOL } from "os"
import { Effect } from "effect"
import { Skill } from "../../../skill"
import { effectCmd, fail } from "../../effect-cmd"
import { cmd } from "../cmd"
import z from "zod"

export const SkillCommand = cmd({
  command: "skill",
  describe: "skill debugging utilities",
  builder: (yargs) => yargs.command(ListCommand).command(ValidateCommand).demandCommand(),
  async handler() {},
})

const ListCommand = effectCmd({
  command: "list",
  describe: "list all available skills",
  handler: Effect.fn("Cli.debug.skill.list")(function* () {
    const skill = yield* Skill.Service
    const skills = yield* skill.all()
    process.stdout.write(JSON.stringify(skills, null, 2) + EOL)
  }),
})

const ValidateCommand = effectCmd({
  command: "validate",
  describe: "validate all skills against the agentskills.io spec",
  handler: Effect.fn("Cli.debug.skill.validate")(function* () {
    const skill = yield* Skill.Service
    const all = yield* skill.allIncludingInvalid()
    const errors: Array<{ name: string; path: string; message: string }> = []

    const FRONTMATTER_SCHEMA = z.object({
      name: z
        .string()
        .min(1, "name must not be empty")
        .max(64, "name must be ≤64 characters")
        .regex(
          /^[a-z0-9]+(-[a-z0-9]+)*$/,
          "name must be lowercase alphanumeric with hyphens; no leading/trailing/consecutive hyphens",
        ),
      description: z
        .string()
        .min(1, "description is required")
        .max(1024, "description must be ≤1024 characters"),
      license: z.string().optional(),
      compatibility: z
        .string()
        .min(1, "compatibility must not be empty")
        .max(500, "compatibility must be ≤500 characters")
        .optional(),
      metadata: z.record(z.string(), z.string()).optional(),
      "allowed-tools": z.string().optional(),
    })

    for (const s of all) {
      // Re-validate against the frontmatter schema (maps Info back to kebab-case)
      const frontmatter = {
        name: s.name,
        description: s.description,
        license: s.license,
        compatibility: s.compatibility,
        metadata: s.metadata,
        "allowed-tools": s.allowedTools,
      }
      const parsed = FRONTMATTER_SCHEMA.safeParse(frontmatter)
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          errors.push({ name: s.name, path: s.location, message: `${issue.path.join(".")}: ${issue.message}` })
        }
      }

      const folderName = s.location.split(/[\\/]/).slice(-2)[0]
      if (s.name !== folderName) {
        errors.push({ name: s.name, path: s.location, message: `name "${s.name}" does not match folder "${folderName}"` })
      }
    }

    if (errors.length === 0) {
      console.log(`All ${all.length} skills are valid.`)
    } else {
      for (const e of errors) {
        console.error(`${e.path}: ${e.message}`)
      }
      yield* fail(`${errors.length} invalid skills found`)
    }
  }),
})
