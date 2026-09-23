import { afterEach, describe, expect, test } from "bun:test"
import { join } from "path"
import {
  applyTargets,
  collectPinnedDeps,
  isPinned,
  parseSemver,
  resolveRoot,
  sameChannelVersion,
  type ApplyUpdate,
} from "./check-updates"

const parsed = (v: string) => {
  const result = parseSemver(v)
  if (!result) throw new Error(`not a pinned semver: ${v}`)
  return result
}

const update = (overrides: Partial<ApplyUpdate>): ApplyUpdate => ({
  file: "package.json",
  name: "dep",
  from: "1.0.0",
  to: "1.0.1",
  section: "dependencies",
  ...overrides,
})

describe("isPinned / parseSemver", () => {
  test("hyphenated prerelease is pinned and parses to its channel", () => {
    expect(isPinned("1.0.0-beta.19-d95b7a4")).toBe(true)
    expect(parsed("1.0.0-beta.19-d95b7a4")).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: "beta.19-d95b7a4",
    })
    expect(parsed("1.0.0-beta.19-d95b7a4").prerelease?.split(".")[0]).toBe("beta")
  })

  test("plain prerelease parses", () => {
    expect(isPinned("4.0.0-beta.65")).toBe(true)
    expect(parsed("4.0.0-beta.65")).toEqual({ major: 4, minor: 0, patch: 0, prerelease: "beta.65" })
  })

  test("ranges and references are not pinned", () => {
    expect(isPinned("^1.0.0")).toBe(false)
    expect(isPinned("workspace:*")).toBe(false)
    expect(isPinned("catalog:")).toBe(false)
    expect(parseSemver("^1.0.0")).toBeNull()
  })
})

describe("sameChannelVersion", () => {
  test("prerelease: newest same-base, same-channel candidate wins", () => {
    expect(sameChannelVersion(parsed("4.0.0-beta.65"), ["4.0.0-beta.70", "4.0.0-rc.1", "4.0.0", "3.9.9"])).toBe(
      "4.0.0-beta.70",
    )
  })

  test("prerelease: no strictly-newer in-channel candidate returns null (emission contract)", () => {
    expect(sameChannelVersion(parsed("4.0.0-beta.65"), ["4.0.0-beta.65"])).toBeNull()
  })

  test("prerelease: never crosses to stable", () => {
    expect(sameChannelVersion(parsed("4.0.0-beta.65"), ["4.0.0", "4.0.1"])).toBeNull()
  })

  test("prerelease: same-base restriction excludes a newer base", () => {
    expect(sameChannelVersion(parsed("4.0.0-beta.65"), ["4.0.1-beta.1"])).toBeNull()
  })

  test("stable: maximum same-major stable candidate wins", () => {
    expect(sameChannelVersion(parsed("1.2.3"), ["1.2.9", "1.3.0", "2.0.0"])).toBe("1.3.0")
    expect(sameChannelVersion(parsed("1.2.3"), ["1.2.3"])).toBeNull()
  })

  test("within-channel ordering: numeric prerelease segments compare numerically", () => {
    expect(sameChannelVersion(parsed("4.0.0-beta.9"), ["4.0.0-beta.10"])).toBe("4.0.0-beta.10")
  })

  test("within-channel ordering: alphanumeric prerelease segments compare lexically", () => {
    expect(sameChannelVersion(parsed("4.0.0-beta.dev"), ["4.0.0-beta.fix"])).toBe("4.0.0-beta.fix")
  })
})

describe("collectPinnedDeps", () => {
  test("collects pinned literals from the four sections and the catalog, skipping references/ranges", () => {
    const { entries } = collectPinnedDeps([
      {
        file: "package.json",
        json: {
          workspaces: { catalog: { effect: "4.0.0-beta.65", typescript: "catalog:", "solid-start": "https://x" } },
          dependencies: { lodash: "4.17.20", ref: "catalog:", range: "^1.0.0" },
          devDependencies: { eslint: "9.1.0" },
          optionalDependencies: { fsevents: "2.3.3" },
          peerDependencies: { react: "18.2.0" },
        },
      },
    ])
    const found = entries.map((e) => `${e.section}:${e.name}@${e.version}`).sort()
    expect(found).toEqual(
      [
        "catalog:effect@4.0.0-beta.65",
        "dependencies:lodash@4.17.20",
        "devDependencies:eslint@9.1.0",
        "optionalDependencies:fsevents@2.3.3",
        "peerDependencies:react@18.2.0",
      ].sort(),
    )
  })

  test("within-file divergence: both entries kept and reported", () => {
    const { entries, divergent } = collectPinnedDeps([
      { file: "a/package.json", json: { dependencies: { foo: "1.0.0" }, devDependencies: { foo: "1.0.1" } } },
    ])
    expect(entries.filter((e) => e.name === "foo")).toHaveLength(2)
    expect(divergent).toEqual([
      {
        name: "foo",
        versions: [
          { file: "a/package.json", section: "dependencies", version: "1.0.0" },
          { file: "a/package.json", section: "devDependencies", version: "1.0.1" },
        ],
      },
    ])
  })

  test("cross-file divergence: independent entries, no collapsing", () => {
    const { entries, divergent } = collectPinnedDeps([
      { file: "a/package.json", json: { dependencies: { foo: "1.0.0" } } },
      { file: "b/package.json", json: { dependencies: { foo: "1.2.5" } } },
    ])
    expect(entries.filter((e) => e.name === "foo")).toHaveLength(2)
    expect(divergent).toEqual([
      {
        name: "foo",
        versions: [
          { file: "a/package.json", section: "dependencies", version: "1.0.0" },
          { file: "b/package.json", section: "dependencies", version: "1.2.5" },
        ],
      },
    ])
  })

  test("overrides: catalog: values skipped, literal divergence reported", () => {
    const { overrideMismatches } = collectPinnedDeps([
      {
        file: "package.json",
        json: {
          workspaces: { catalog: { "@types/bun": "1.3.12", "@types/node": "24.12.2" } },
          overrides: { "@types/bun": "catalog:", "@types/node": "22.0.0" },
        },
      },
    ])
    expect(overrideMismatches).toEqual([{ name: "@types/node", overrideVersion: "22.0.0", catalogVersion: "24.12.2" }])
  })

  test("patchedDependencies: key parsed, mismatch vs pinned version reported", () => {
    const { patchMismatches } = collectPinnedDeps([
      {
        file: "package.json",
        json: {
          workspaces: { catalog: { "solid-js": "1.9.10", "@opentui/core": "0.2.16" } },
          patchedDependencies: {
            "solid-js@1.9.10": "patches/solid-js@1.9.10.patch",
            "@opentui/core@0.2.20": "patches/@opentui%2Fcore@0.2.20.patch",
          },
        },
      },
    ])
    expect(patchMismatches).toEqual([
      {
        name: "@opentui/core",
        patchVersion: "0.2.20",
        foundVersion: "0.2.16",
        patchKey: "@opentui/core@0.2.20",
        patchPath: "patches/@opentui%2Fcore@0.2.20.patch",
      },
    ])
  })
})

describe("applyTargets", () => {
  test("rewrites a single occurrence", () => {
    const content = `{\n  "dependencies": {\n    "lodash": "4.17.20"\n  }\n}`
    const { content: out, missed } = applyTargets(content, [update({ name: "lodash", from: "4.17.20", to: "4.17.21" })])
    expect(out).toContain(`"lodash": "4.17.21"`)
    expect(missed).toEqual([])
  })

  test("section-scoped: only the matching section + version token is rewritten", () => {
    const content = `{\n  "workspaces": {\n    "catalog": {\n      "semver": "7.7.4"\n    }\n  },\n  "devDependencies": {\n    "semver": "^7.8.5"\n  }\n}`
    const { content: out, missed } = applyTargets(content, [
      update({ name: "semver", from: "7.7.4", to: "7.7.5", section: "catalog" }),
    ])
    expect(out).toContain(`"semver": "7.7.5"`)
    expect(out).toContain(`"semver": "^7.8.5"`)
    expect(missed).toEqual([])
  })

  test("substring dep names are not cross-matched", () => {
    const content = `{\n  "dependencies": {\n    "marked": "17.0.1",\n    "marked-shiki": "1.2.1"\n  }\n}`
    const { content: out } = applyTargets(content, [update({ name: "marked", from: "17.0.1", to: "17.0.2" })])
    expect(out).toContain(`"marked": "17.0.2"`)
    expect(out).toContain(`"marked-shiki": "1.2.1"`)
  })

  test("a literal in overrides equal to a scanned pin is NOT rewritten", () => {
    const content = `{\n  "workspaces": {\n    "catalog": {\n      "foo": "1.0.0"\n    }\n  },\n  "overrides": {\n    "foo": "1.0.0"\n  }\n}`
    const { content: out, missed } = applyTargets(content, [
      update({ name: "foo", from: "1.0.0", to: "1.0.1", section: "catalog" }),
    ])
    expect(out).toContain(`"foo": "1.0.1"`)
    // The overrides literal is still present, proving the rewrite was catalog-scoped.
    expect(out).toContain(`"foo": "1.0.0"`)
    expect(out.match(/"foo": "1\.0\.1"/g)).toHaveLength(1)
    expect(missed).toEqual([])
  })

  test("zero-match records missed and leaves content unchanged", () => {
    const content = `{\n  "dependencies": {\n    "lodash": "4.17.20"\n  }\n}`
    const { content: out, missed } = applyTargets(content, [
      update({ name: "lodash", from: "4.17.19", to: "4.17.21" }),
    ])
    expect(out).toBe(content)
    expect(missed).toEqual(["lodash@4.17.19 in package.json"])
  })

  test("missing section records every update as missed", () => {
    const content = `{\n  "dependencies": {\n    "lodash": "4.17.20"\n  }\n}`
    const { content: out, missed } = applyTargets(content, [
      update({ name: "effect", from: "4.0.0-beta.65", to: "4.0.0-beta.70", section: "catalog" }),
    ])
    expect(out).toBe(content)
    expect(missed).toEqual(["effect@4.0.0-beta.65 in package.json"])
  })
})

describe("resolveRoot", () => {
  const original = process.env.CHECK_UPDATES_ROOT

  afterEach(() => {
    if (original === undefined) delete process.env.CHECK_UPDATES_ROOT
    else process.env.CHECK_UPDATES_ROOT = original
  })

  test("honors CHECK_UPDATES_ROOT", () => {
    process.env.CHECK_UPDATES_ROOT = join("C:", "tmp", "fixture")
    expect(resolveRoot()).toBe(join("C:", "tmp", "fixture"))
  })

  test("defaults to the repo root (parent of script/)", () => {
    delete process.env.CHECK_UPDATES_ROOT
    expect(resolveRoot()).toBe(join(import.meta.dir, ".."))
  })
})
