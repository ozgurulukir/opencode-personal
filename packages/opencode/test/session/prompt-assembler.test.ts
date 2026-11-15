import { describe, expect, test } from "bun:test"
import { assemblePromptSuffix, extractUserText } from "@/session/loop/prompt-assembler"
import { STRUCTURED_OUTPUT_SYSTEM_PROMPT } from "@/session/prompt/structured-output"

describe("session/loop/prompt-assembler", () => {
  test("extractUserText concatenates only text parts with space separator", () => {
    expect(extractUserText(undefined)).toBeUndefined()
    expect(extractUserText([])).toBe("")
    expect(
      extractUserText([
        { id: "1" as any, sessionID: "s" as any, messageID: "m" as any, type: "text", text: "Hello" },
        { id: "2" as any, sessionID: "s" as any, messageID: "m" as any, type: "step-start" } as any,
        { id: "3" as any, sessionID: "s" as any, messageID: "m" as any, type: "text", text: "world" },
      ]),
    ).toBe("Hello world")
  })

  test("assemblePromptSuffix handles basic env and skills", () => {
    const suffix = assemblePromptSuffix({
      env: ["<environment>linux</environment>"],
      skills: "<skills>git</skills>",
      modelHasToolcall: true,
      formatType: "text",
    })

    expect(suffix).toBe("<environment>linux</environment>\n<skills>git</skills>")
  })

  test("assemblePromptSuffix warns when model does not support tool calls", () => {
    const suffix = assemblePromptSuffix({
      env: ["<env/>"],
      modelHasToolcall: false,
      formatType: "text",
    })

    expect(suffix).toContain("The selected model does not support tool calls")
  })

  test("assemblePromptSuffix adds structured output instructions for json_schema", () => {
    const withTool = assemblePromptSuffix({
      env: [],
      modelHasToolcall: true,
      formatType: "json_schema",
    })
    expect(withTool).toContain(STRUCTURED_OUTPUT_SYSTEM_PROMPT)

    const withoutTool = assemblePromptSuffix({
      env: [],
      modelHasToolcall: false,
      formatType: "json_schema",
    })
    expect(withoutTool).toContain("This model cannot call the StructuredOutput tool")
  })
})
