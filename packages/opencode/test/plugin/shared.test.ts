import { describe, expect, test } from "bun:test"
import { isPathPluginSpec, parsePluginSpecifier } from "../../src/plugin/shared"

describe("parsePluginSpecifier", () => {
  test("parses standard npm package without version", () => {
    expect(parsePluginSpecifier("acme")).toEqual({
      pkg: "acme",
      version: "latest",
    })
  })

  test("parses standard npm package with version", () => {
    expect(parsePluginSpecifier("acme@1.0.0")).toEqual({
      pkg: "acme",
      version: "1.0.0",
    })
  })

  test("parses scoped npm package without version", () => {
    expect(parsePluginSpecifier("@opencode/acme")).toEqual({
      pkg: "@opencode/acme",
      version: "latest",
    })
  })

  test("parses scoped npm package with version", () => {
    expect(parsePluginSpecifier("@opencode/acme@1.0.0")).toEqual({
      pkg: "@opencode/acme",
      version: "1.0.0",
    })
  })

  test("parses package with git+https url", () => {
    expect(parsePluginSpecifier("acme@git+https://github.com/opencode/acme.git")).toEqual({
      pkg: "acme",
      version: "git+https://github.com/opencode/acme.git",
    })
  })

  test("parses scoped package with git+https url", () => {
    expect(parsePluginSpecifier("@opencode/acme@git+https://github.com/opencode/acme.git")).toEqual({
      pkg: "@opencode/acme",
      version: "git+https://github.com/opencode/acme.git",
    })
  })

  test("parses package with git+ssh url containing another @", () => {
    expect(parsePluginSpecifier("acme@git+ssh://git@github.com/opencode/acme.git")).toEqual({
      pkg: "acme",
      version: "git+ssh://git@github.com/opencode/acme.git",
    })
  })

  test("parses scoped package with git+ssh url containing another @", () => {
    expect(parsePluginSpecifier("@opencode/acme@git+ssh://git@github.com/opencode/acme.git")).toEqual({
      pkg: "@opencode/acme",
      version: "git+ssh://git@github.com/opencode/acme.git",
    })
  })

  test("parses unaliased git+ssh url", () => {
    expect(parsePluginSpecifier("git+ssh://git@github.com/opencode/acme.git")).toEqual({
      pkg: "git+ssh://git@github.com/opencode/acme.git",
      version: "",
    })
  })

  test("parses npm alias using the alias name", () => {
    expect(parsePluginSpecifier("acme@npm:@opencode/acme@1.0.0")).toEqual({
      pkg: "acme",
      version: "npm:@opencode/acme@1.0.0",
    })
  })

  test("parses bare npm protocol specifier using the target package", () => {
    expect(parsePluginSpecifier("npm:@opencode/acme@1.0.0")).toEqual({
      pkg: "@opencode/acme",
      version: "1.0.0",
    })
  })

  test("parses unversioned npm protocol specifier", () => {
    expect(parsePluginSpecifier("npm:@opencode/acme")).toEqual({
      pkg: "@opencode/acme",
      version: "latest",
    })
  })
})

describe("isPathPluginSpec", () => {
  test("returns true for relative paths starting with .", () => {
    expect(isPathPluginSpec(".")).toBe(true)
    expect(isPathPluginSpec("./plugin")).toBe(true)
    expect(isPathPluginSpec("../plugin")).toBe(true)
    expect(isPathPluginSpec("./path/to/plugin.ts")).toBe(true)
  })

  test("returns true for file:// URLs", () => {
    expect(isPathPluginSpec("file:///path/to/plugin")).toBe(true)
    expect(isPathPluginSpec("file://./plugin")).toBe(true)
    expect(isPathPluginSpec("file://C:/path/to/plugin")).toBe(true)
  })

  test("returns true for POSIX absolute paths", () => {
    expect(isPathPluginSpec("/path/to/plugin")).toBe(true)
    expect(isPathPluginSpec("/usr/local/lib/plugin")).toBe(true)
  })

  test("returns true for Windows absolute paths", () => {
    expect(isPathPluginSpec("C:\\path\\to\\plugin")).toBe(true)
    expect(isPathPluginSpec("D:/path/to/plugin")).toBe(true)
    expect(isPathPluginSpec("z:\\plugin")).toBe(true)
  })

  test("returns false for non-path npm plugin specifiers", () => {
    expect(isPathPluginSpec("my-plugin")).toBe(false)
    expect(isPathPluginSpec("@scope/my-plugin")).toBe(false)
    expect(isPathPluginSpec("opencode-plugin-test")).toBe(false)
    expect(isPathPluginSpec("my-plugin@1.0.0")).toBe(false)
  })
})
