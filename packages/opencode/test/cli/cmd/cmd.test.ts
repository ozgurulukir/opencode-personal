import { describe, expect, test } from "bun:test"
import type { ArgumentsCamelCase } from "yargs"
import { cmd, type WithDoubleDash } from "../../../src/cli/cmd/cmd"

describe("cli/cmd/cmd", () => {
  test("cmd identity function returns input command module unmodified", () => {
    const inputCmd = {
      command: "test",
      describe: "a test command",
      handler: () => {},
    }

    const result = cmd(inputCmd)
    expect(result).toBe(inputCmd)
  })

  test("cmd works with builder and handler functions", async () => {
    let executedArgs: WithDoubleDash<{ name: string }> | undefined

    const inputCmd = cmd({
      command: "greet <name>",
      describe: "greet someone",
      builder: (yargs) =>
        yargs.positional("name", {
          type: "string",
          demandOption: true,
        }),
      handler: (args) => {
        executedArgs = args
      },
    })

    expect(inputCmd.command).toBe("greet <name>")
    expect(inputCmd.describe).toBe("greet someone")
    expect(typeof inputCmd.builder).toBe("function")
    expect(typeof inputCmd.handler).toBe("function")

    const mockArgs: ArgumentsCamelCase<WithDoubleDash<{ name: string }>> = {
      _: ["greet"],
      $0: "opencode",
      name: "world",
      "--": ["--extra", "flag"],
    }

    await inputCmd.handler(mockArgs)
    expect(executedArgs).toEqual(mockArgs)
  })

  test("WithDoubleDash type structure allows optional '--' array", () => {
    type BaseArgs = { foo: string }
    type ArgsWithDoubleDash = WithDoubleDash<BaseArgs>

    const argsWithoutDoubleDash: ArgsWithDoubleDash = { foo: "bar" }
    const argsWithDoubleDash: ArgsWithDoubleDash = { foo: "bar", "--": ["extra", "args"] }

    expect(argsWithoutDoubleDash.foo).toBe("bar")
    expect(argsWithoutDoubleDash["--"]).toBeUndefined()
    expect(argsWithDoubleDash["--"]).toEqual(["extra", "args"])
  })
})
