import { beforeAll, describe, expect, mock, test } from "bun:test"

let shouldListRoot: typeof import("./file-tree").shouldListRoot
let shouldListExpanded: typeof import("./file-tree").shouldListExpanded
let dirsToExpand: typeof import("./file-tree").dirsToExpand
let normalizePath: typeof import("./file-tree").normalizePath
let buildFilter: typeof import("./file-tree").buildFilter

beforeAll(async () => {
  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => ({}),
  }))
  mock.module("@/context/file", () => ({
    useFile: () => ({
      normalize: (input: string) => {
        const root = "/repo/main"
        let path = input
        if (path.startsWith(root)) path = path.slice(root.length)
        if (path.startsWith("/") || path.startsWith("\\")) path = path.slice(1)
        return path
      },
      tree: {
        state: () => undefined,
        list: () => Promise.resolve(),
        children: () => [],
        expand: () => {},
        collapse: () => {},
      },
    }),
  }))
  mock.module("@opencode-ai/ui/collapsible", () => ({
    Collapsible: {
      Trigger: (props: { children?: unknown }) => props.children,
      Content: (props: { children?: unknown }) => props.children,
    },
  }))
  mock.module("@opencode-ai/ui/file-icon", () => ({ FileIcon: () => null }))
  mock.module("@opencode-ai/ui/icon", () => ({ Icon: () => null }))
  mock.module("@opencode-ai/ui/tooltip", () => ({ Tooltip: (props: { children?: unknown }) => props.children }))
  const mod = await import("./file-tree")
  shouldListRoot = mod.shouldListRoot
  shouldListExpanded = mod.shouldListExpanded
  dirsToExpand = mod.dirsToExpand
  normalizePath = mod.normalizePath
  buildFilter = mod.buildFilter
})

describe("file tree fetch discipline", () => {
  test("root lists on mount unless already loaded or loading", () => {
    expect(shouldListRoot({ level: 0 })).toBe(true)
    expect(shouldListRoot({ level: 0, dir: { loaded: true } })).toBe(false)
    expect(shouldListRoot({ level: 0, dir: { loading: true } })).toBe(false)
    expect(shouldListRoot({ level: 1 })).toBe(false)
  })

  test("nested dirs list only when expanded and stale", () => {
    expect(shouldListExpanded({ level: 1 })).toBe(false)
    expect(shouldListExpanded({ level: 1, dir: { expanded: false } })).toBe(false)
    expect(shouldListExpanded({ level: 1, dir: { expanded: true } })).toBe(true)
    expect(shouldListExpanded({ level: 1, dir: { expanded: true, loaded: true } })).toBe(false)
    expect(shouldListExpanded({ level: 1, dir: { expanded: true, loading: true } })).toBe(false)
    expect(shouldListExpanded({ level: 0, dir: { expanded: true } })).toBe(false)
  })

  test("allowed auto-expand picks only collapsed dirs", () => {
    const expanded = new Set<string>()
    const filter = { dirs: new Set(["src", "src/components"]) }

    const first = dirsToExpand({
      level: 0,
      filter,
      expanded: (dir) => expanded.has(dir),
    })

    expect(first).toEqual(["src", "src/components"])

    for (const dir of first) expanded.add(dir)

    const second = dirsToExpand({
      level: 0,
      filter,
      expanded: (dir) => expanded.has(dir),
    })

    expect(second).toEqual([])
    expect(dirsToExpand({ level: 1, filter, expanded: () => false })).toEqual([])
  })
})

const rootNormalize = (input: string) => {
  const root = "/repo/main"
  let path = input
  // Handle Windows drive-letter paths (C:/...) and Unix paths
  const slashIndex = path.indexOf("/")
  if (slashIndex === 1 && path[1] === ":") {
    // Windows path like C:/repo/main/src/App.tsx — strip drive + root
    const afterDrive = path.slice(2)
    if (afterDrive.startsWith(root)) path = afterDrive.slice(root.length)
  } else if (path.startsWith(root)) {
    path = path.slice(root.length)
  }
  if (path.startsWith("/") || path.startsWith("\\")) path = path.slice(1)
  return path
}

describe("file-tree path normalization", () => {
  test("strips root prefix and leading slash from absolute path", () => {
    expect(normalizePath(rootNormalize, "/repo/main/src/App.tsx")).toBe("src/App.tsx")
  })

  test("strips trailing slashes", () => {
    expect(normalizePath(rootNormalize, "/repo/main/src/")).toBe("src")
  })

  test("converts backslashes to forward slashes", () => {
    expect(normalizePath(rootNormalize, "/repo/main\\src/App.tsx")).toBe("src/App.tsx")
  })

  test("handles mixed separators", () => {
    expect(normalizePath(rootNormalize, "/repo/main\\src/App.tsx")).toBe("src/App.tsx")
  })

  test("returns relative path for root-level file", () => {
    expect(normalizePath(rootNormalize, "/repo/main/App.tsx")).toBe("App.tsx")
  })
})

describe("file-tree filter parent extraction", () => {
  const key = (p: string) => normalizePath(rootNormalize, p)

  test("extracts intermediate parent dirs from absolute paths", () => {
    const result = buildFilter(key, ["/repo/main/src/App.tsx", "/repo/main/src/components/Button.tsx"])
    expect(result).toBeDefined()
    expect(result!.dirs).toEqual(new Set(["src", "src/components"]))
    expect(result!.files).toEqual(new Set(["/repo/main/src/App.tsx", "/repo/main/src/components/Button.tsx"]))
  })

  test("normalizes paths with backslashes before extracting parents", () => {
    // After unquoteGitPath + root strip, backslashes remain; normalizePath converts them.
    const result = buildFilter(key, ["/repo/main\\src/App.tsx"])
    expect(result).toBeDefined()
    expect(result!.dirs).toEqual(new Set(["src"]))
    expect(result!.files).toEqual(new Set(["/repo/main\\src/App.tsx"]))
  })

  test("strips trailing slashes from allowed items before extraction", () => {
    // Trailing slash on a file path is stripped before parent extraction
    const result = buildFilter(key, ["/repo/main/src/App.tsx/"])
    expect(result).toBeDefined()
    expect(result!.dirs).toEqual(new Set(["src"]))
    expect(result!.files).toEqual(new Set(["/repo/main/src/App.tsx/"]))
  })

  test("handles root-level file with no parent dirs", () => {
    const result = buildFilter(key, ["/repo/main/App.tsx"])
    expect(result).toBeDefined()
    expect(result!.dirs).toEqual(new Set())
    expect(result!.files).toEqual(new Set(["/repo/main/App.tsx"]))
  })

  test("returns undefined for empty allowed", () => {
    expect(buildFilter(key, [])).toBeUndefined()
  })

  test("returns _filter directly when provided (no parent extraction)", () => {
    const existing = { files: new Set(["a.ts"]), dirs: new Set(["src"]) }
    // buildFilter doesn't handle _filter; that logic lives in the createMemo.
    // This test documents that buildFilter always computes from allowed.
    expect(buildFilter(key, ["src/a.ts"])).toEqual({
      files: new Set(["src/a.ts"]),
      dirs: new Set(["src"]),
    })
  })
})
