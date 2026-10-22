import { describe, expect, test } from "bun:test"
import { Result, Schema } from "effect"
import { toJsonSchema } from "@opencode-ai/core/effect-zod"

// Each tool exports its parameters schema at module scope so this test can
// import them without running the tool's Effect-based init. The JSON Schema
// snapshot captures what the LLM sees; the parse assertions pin down the
// accepts/rejects contract. `toJsonSchema` is the same helper `session/
// prompt.ts` uses to emit tool schemas to the LLM, so the snapshots stay
// byte-identical regardless of whether a tool has migrated from zod to Schema.

import { Parameters as ApplyPatch } from "../../src/tool/apply_patch"
import { Parameters as Edit } from "../../src/tool/edit"
import { Parameters as CodeSearch } from "../../src/tool/codesearch"
import { Parameters as Glob } from "../../src/tool/glob"
import { Parameters as Grep } from "../../src/tool/grep"
import { Parameters as IndexWorkspace } from "../../src/tool/index-workspace"
import { Parameters as Invalid } from "../../src/tool/invalid"
import { Parameters as Lsp } from "../../src/tool/lsp"
import { Parameters as Plan } from "../../src/tool/plan"
import { Parameters as Question } from "../../src/tool/question"
import { Parameters as Read } from "../../src/tool/read"
import { Parameters as RepoClone } from "../../src/tool/repo_clone"
import { Parameters as RepoOverview } from "../../src/tool/repo_overview"
import { Parameters as SemanticSearch } from "../../src/tool/semantic-search"
import { Parameters as Shell } from "../../src/tool/shell"
import { Parameters as Skill } from "../../src/tool/skill"
import { Parameters as Task } from "../../src/tool/task"
import { Parameters as Todo } from "../../src/tool/todo"
import { Parameters as WebFetch } from "../../src/tool/webfetch"
import { Parameters as WebSearch } from "../../src/tool/websearch"
import { Parameters as Write } from "../../src/tool/write"

const parse = <S extends Schema.Decoder<unknown>>(schema: S, input: unknown): S["Type"] =>
  Schema.decodeUnknownSync(schema)(input)

const accepts = (schema: Schema.Decoder<unknown>, input: unknown): boolean =>
  Result.isSuccess(Schema.decodeUnknownResult(schema)(input))

describe("tool parameters", () => {
  describe("JSON Schema (wire shape)", () => {
    test("apply_patch", () => expect(toJsonSchema(ApplyPatch)).toMatchSnapshot())
    test("bash", () => expect(toJsonSchema(Shell)).toMatchSnapshot())
    test("edit", () => expect(toJsonSchema(Edit)).toMatchSnapshot())
    test("codesearch", () => expect(toJsonSchema(CodeSearch)).toMatchSnapshot())
    test("glob", () => expect(toJsonSchema(Glob)).toMatchSnapshot())
    test("grep", () => expect(toJsonSchema(Grep)).toMatchSnapshot())
    test("invalid", () => expect(toJsonSchema(Invalid)).toMatchSnapshot())
    test("index_workspace", () => expect(toJsonSchema(IndexWorkspace)).toMatchSnapshot())
    test("lsp", () => expect(toJsonSchema(Lsp)).toMatchSnapshot())
    test("plan", () => expect(toJsonSchema(Plan)).toMatchSnapshot())
    test("question", () => expect(toJsonSchema(Question)).toMatchSnapshot())
    test("read", () => expect(toJsonSchema(Read)).toMatchSnapshot())
    test("repo_clone", () => expect(toJsonSchema(RepoClone)).toMatchSnapshot())
    test("repo_overview", () => expect(toJsonSchema(RepoOverview)).toMatchSnapshot())
    test("semantic_search", () => expect(toJsonSchema(SemanticSearch)).toMatchSnapshot())
    test("skill", () => expect(toJsonSchema(Skill)).toMatchSnapshot())
    test("task", () => expect(toJsonSchema(Task)).toMatchSnapshot())
    test("todo", () => expect(toJsonSchema(Todo)).toMatchSnapshot())
    test("webfetch", () => expect(toJsonSchema(WebFetch)).toMatchSnapshot())
    test("websearch", () => expect(toJsonSchema(WebSearch)).toMatchSnapshot())
    test("write", () => expect(toJsonSchema(Write)).toMatchSnapshot())
  })

  describe("apply_patch", () => {
    test("accepts patchText", () => {
      expect(parse(ApplyPatch, { patchText: "*** Begin Patch\n*** End Patch" })).toEqual({
        patchText: "*** Begin Patch\n*** End Patch",
      })
    })
    test("rejects missing patchText", () => {
      expect(accepts(ApplyPatch, {})).toBe(false)
    })
    test("rejects non-string patchText", () => {
      expect(accepts(ApplyPatch, { patchText: 123 })).toBe(false)
    })
  })

  describe("shell", () => {
    test("accepts minimum: command + description", () => {
      expect(parse(Shell, { command: "ls", description: "list" })).toEqual({ command: "ls", description: "list" })
    })
    test("accepts optional timeout + workdir", () => {
      const parsed = parse(Shell, { command: "ls", description: "list", timeout: 5000, workdir: "/tmp" })
      expect(parsed.timeout).toBe(5000)
      expect(parsed.workdir).toBe("/tmp")
    })
    test("rejects missing description", () => {
      expect(accepts(Shell, { command: "ls" })).toBe(false)
    })
    test("rejects missing command", () => {
      expect(accepts(Shell, { description: "list" })).toBe(false)
    })
  })

  describe("edit", () => {
    test("accepts all four fields", () => {
      expect(parse(Edit, { filePath: "/a", oldString: "x", newString: "y", replaceAll: true })).toEqual({
        filePath: "/a",
        oldString: "x",
        newString: "y",
        replaceAll: true,
      })
    })
    test("replaceAll is optional", () => {
      const parsed = parse(Edit, { filePath: "/a", oldString: "x", newString: "y" })
      expect(parsed.replaceAll).toBeUndefined()
    })
    test("rejects missing filePath", () => {
      expect(accepts(Edit, { oldString: "x", newString: "y" })).toBe(false)
    })
  })

  describe("glob", () => {
    test("accepts pattern-only", () => {
      expect(parse(Glob, { pattern: "**/*.ts" })).toEqual({ pattern: "**/*.ts" })
    })
    test("accepts optional path", () => {
      expect(parse(Glob, { pattern: "**/*.ts", path: "/tmp" }).path).toBe("/tmp")
    })
    test("rejects missing pattern", () => {
      expect(accepts(Glob, {})).toBe(false)
    })
  })

  describe("grep", () => {
    test("accepts pattern-only", () => {
      expect(parse(Grep, { pattern: "TODO" })).toEqual({ pattern: "TODO" })
    })
    test("accepts optional path + include", () => {
      const parsed = parse(Grep, { pattern: "TODO", path: "/tmp", include: "*.ts" })
      expect(parsed.path).toBe("/tmp")
      expect(parsed.include).toBe("*.ts")
    })
    test("rejects missing pattern", () => {
      expect(accepts(Grep, {})).toBe(false)
    })
  })

  describe("invalid", () => {
    test("accepts tool + error", () => {
      expect(parse(Invalid, { tool: "foo", error: "bar" })).toEqual({ tool: "foo", error: "bar" })
    })
    test("rejects missing fields", () => {
      expect(accepts(Invalid, { tool: "foo" })).toBe(false)
      expect(accepts(Invalid, { error: "bar" })).toBe(false)
    })
  })

  describe("lsp", () => {
    test("accepts all fields", () => {
      const parsed = parse(Lsp, { operation: "hover", filePath: "/a.ts", line: 1, character: 1 })
      expect(parsed.operation).toBe("hover")
    })
    test("accepts documentSymbol without a position", () => {
      expect(accepts(Lsp, { operation: "documentSymbol", filePath: "/a.ts" })).toBe(true)
    })
    test("accepts workspaceSymbol without a position", () => {
      expect(accepts(Lsp, { operation: "workspaceSymbol", filePath: "/a.ts", query: "Widget" })).toBe(true)
    })
    test("rejects unknown operation", () => {
      expect(accepts(Lsp, { operation: "bogus", filePath: "/a.ts", line: 1, character: 1 })).toBe(false)
    })
  })

  describe("plan", () => {
    test("accepts empty object", () => {
      expect(parse(Plan, {})).toEqual({})
    })
  })

  describe("question", () => {
    test("accepts questions array", () => {
      const parsed = parse(Question, {
        questions: [
          {
            question: "pick one",
            header: "Header",
            custom: false,
            options: [{ label: "a", description: "desc" }],
          },
        ],
      })
      expect(parsed.questions.length).toBe(1)
    })
    test("rejects missing questions", () => {
      expect(accepts(Question, {})).toBe(false)
    })
  })

  describe("read", () => {
    test("accepts filePath-only", () => {
      expect(parse(Read, { filePath: "/a" }).filePath).toBe("/a")
    })
    test("accepts optional offset + limit", () => {
      const parsed = parse(Read, { filePath: "/a", offset: 10, limit: 100 })
      expect(parsed.offset).toBe(10)
      expect(parsed.limit).toBe(100)
    })
    test("rejects zero offset", () => {
      expect(accepts(Read, { filePath: "/a", offset: 0 })).toBe(false)
    })
  })

  describe("codesearch", () => {
    test("defaults to an integer token count", () => {
      expect(parse(CodeSearch, { query: "effect schema" }).tokensNum).toBe(5000)
    })
    test("rejects fractional and out-of-range token counts", () => {
      expect(accepts(CodeSearch, { query: "effect schema", tokensNum: 5000.5 })).toBe(false)
      expect(accepts(CodeSearch, { query: "effect schema", tokensNum: 50001 })).toBe(false)
    })
  })

  describe("skill", () => {
    test("accepts one to ten names", () => {
      expect(parse(Skill, { names: ["foo"] }).names).toEqual(["foo"])
      expect(parse(Skill, { names: ["foo", "bar"] }).names).toEqual(["foo", "bar"])
    })
    test("rejects missing or empty names", () => {
      expect(accepts(Skill, {})).toBe(false)
      expect(accepts(Skill, { names: [] })).toBe(false)
      expect(accepts(Skill, { names: Array.from({ length: 11 }, (_, index) => `skill-${index}`) })).toBe(false)
      expect(accepts(Skill, { name: "foo" })).toBe(false)
    })
  })

  describe("repo_overview", () => {
    test("accepts a required target and optional depth", () => {
      expect(parse(RepoOverview, { target: "owner/repo", depth: 4 })).toEqual({
        target: "owner/repo",
        depth: 4,
      })
    })
    test("rejects missing target and invalid depth", () => {
      expect(accepts(RepoOverview, {})).toBe(false)
      expect(accepts(RepoOverview, { target: "owner/repo", depth: 1.5 })).toBe(false)
      expect(accepts(RepoOverview, { target: "owner/repo", depth: 7 })).toBe(false)
    })
  })

  describe("semantic_search", () => {
    test("defaults to an integer result count", () => {
      expect(parse(SemanticSearch, { query: "find the API" }).topK).toBe(10)
    })
    test("rejects non-positive or fractional result counts", () => {
      expect(accepts(SemanticSearch, { query: "find the API", topK: 0 })).toBe(false)
      expect(accepts(SemanticSearch, { query: "find the API", topK: 1.5 })).toBe(false)
    })
  })

  describe("task", () => {
    test("accepts description + prompt + subagent_type", () => {
      const parsed = parse(Task, { description: "d", prompt: "p", subagent_type: "general" })
      expect(parsed.subagent_type).toBe("general")
    })
    test("rejects missing prompt", () => {
      expect(accepts(Task, { description: "d", subagent_type: "general" })).toBe(false)
    })
  })

  describe("todo", () => {
    test("accepts todos array", () => {
      const parsed = parse(Todo, {
        todos: [{ id: "t1", content: "do x", status: "pending", priority: "medium" }],
      })
      expect(parsed.todos.length).toBe(1)
    })
    test("rejects missing todos", () => {
      expect(accepts(Todo, {})).toBe(false)
    })
  })

  describe("webfetch", () => {
    test("accepts url-only", () => {
      expect(parse(WebFetch, { url: "https://example.com" }).url).toBe("https://example.com")
    })
    test("requires a positive timeout when provided", () => {
      expect(accepts(WebFetch, { url: "https://example.com", timeout: 0 })).toBe(false)
      expect(accepts(WebFetch, { url: "https://example.com", timeout: -1 })).toBe(false)
      expect(accepts(WebFetch, { url: "https://example.com", timeout: 0.5 })).toBe(false)
      expect(accepts(WebFetch, { url: "https://example.com", timeout: 121 })).toBe(true)
    })
  })

  describe("websearch", () => {
    test("accepts query", () => {
      expect(parse(WebSearch, { query: "opencode" }).query).toBe("opencode")
    })
  })

  describe("write", () => {
    test("accepts content + filePath", () => {
      expect(parse(Write, { content: "hi", filePath: "/a" })).toEqual({ content: "hi", filePath: "/a" })
    })
    test("rejects missing filePath", () => {
      expect(accepts(Write, { content: "hi" })).toBe(false)
    })
  })
})
