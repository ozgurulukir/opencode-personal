import { describe, expect, test } from "bun:test"
import { buildSlashCommands, type BuiltinCommandOption, type CustomCommand } from "./slash-commands"

const builtin = (overrides: Partial<BuiltinCommandOption> & { id: string; title: string }): BuiltinCommandOption => ({
  ...overrides,
})

describe("prompt-input slash-commands", () => {
  test("keeps slash-capable builtin options with trigger and metadata", () => {
    const commands = buildSlashCommands(
      [
        builtin({
          id: "session.new",
          title: "New session",
          description: "Start a new session",
          keybind: "mod+n",
          slash: "new",
        }),
      ],
      [],
    )

    expect(commands).toEqual([
      {
        id: "session.new",
        trigger: "new",
        title: "New session",
        description: "Start a new session",
        keybind: "mod+n",
        type: "builtin",
      },
    ])
  })

  test("drops disabled builtin options", () => {
    const commands = buildSlashCommands(
      [builtin({ id: "file.attach", title: "Attach", slash: "attach", disabled: true })],
      [],
    )

    expect(commands).toEqual([])
  })

  test("drops suggested.* builtin options", () => {
    const commands = buildSlashCommands(
      [builtin({ id: "suggested.optimize", title: "Optimize", slash: "optimize" })],
      [],
    )

    expect(commands).toEqual([])
  })

  test("drops builtin options without a slash trigger", () => {
    const commands = buildSlashCommands([builtin({ id: "agent.cycle", title: "Cycle agent" })], [])

    expect(commands).toEqual([])
  })

  test("maps custom commands with custom.<name> ids and carries source", () => {
    const custom: CustomCommand[] = [
      { name: "review", description: "Review the diff", source: "command" },
      { name: "deploy", source: "mcp" },
    ]

    expect(buildSlashCommands([], custom)).toEqual([
      { id: "custom.review", trigger: "review", title: "review", description: "Review the diff", type: "custom", source: "command" },
      { id: "custom.deploy", trigger: "deploy", title: "deploy", description: undefined, type: "custom", source: "mcp" },
    ])
  })

  test("lists custom commands before builtin commands", () => {
    const commands = buildSlashCommands(
      [builtin({ id: "session.new", title: "New session", slash: "new" })],
      [{ name: "review", source: "skill" }],
    )

    expect(commands.map((cmd) => cmd.type)).toEqual(["custom", "builtin"])
    expect(commands.map((cmd) => cmd.trigger)).toEqual(["review", "new"])
  })

  test("returns empty list for empty inputs", () => {
    expect(buildSlashCommands([], [])).toEqual([])
  })
})
