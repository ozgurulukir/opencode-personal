import { describe, expect, test } from "bun:test"
import { isEditableTarget, isScrollGestureKey, sessionKeyGuardBlocked, shouldFocusComposer } from "./keyboard"

describe("session keyboard guard and classification", () => {
  test("isEditableTarget matches form controls and contenteditable", () => {
    const el = document.createElement("input")
    expect(isEditableTarget(el)).toBe(true)
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true)
    expect(isEditableTarget(document.createElement("select"))).toBe(true)
    expect(isEditableTarget(document.createElement("button"))).toBe(true)
    const editable = document.createElement("div")
    editable.setAttribute("contenteditable", "true")
    expect(isEditableTarget(editable)).toBe(true)
  })

  test("isEditableTarget rejects plain elements, documents and null targets", () => {
    expect(isEditableTarget(document.createElement("div"))).toBe(false)
    expect(isEditableTarget(document)).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
    expect(isEditableTarget(undefined)).toBe(false)
  })

  test("guard blocks protected targets and editable targets", () => {
    expect(sessionKeyGuardBlocked({
      protectedTarget: true,
      targetEditable: false,
      activeElement: undefined,
      activeElementProtected: false,
      activeElementEditable: false,
      dialogActive: false,
    })).toBe(true)
    expect(
      sessionKeyGuardBlocked({
        protectedTarget: false,
        targetEditable: true,
        activeElement: undefined,
        activeElementProtected: false,
        activeElementEditable: false,
        dialogActive: false,
      }),
    ).toBe(true)
  })

  test("guard blocks on the deep active element only when protected or editable", () => {
    const el = document.createElement("div")
    expect(
      sessionKeyGuardBlocked({
        protectedTarget: false,
        targetEditable: false,
        activeElement: el,
        activeElementProtected: false,
        activeElementEditable: false,
        dialogActive: false,
      }),
    ).toBe(false)
    expect(
      sessionKeyGuardBlocked({
        protectedTarget: false,
        targetEditable: false,
        activeElement: el,
        activeElementProtected: true,
        activeElementEditable: false,
        dialogActive: false,
      }),
    ).toBe(true)
    expect(
      sessionKeyGuardBlocked({
        protectedTarget: false,
        targetEditable: false,
        activeElement: el,
        activeElementProtected: false,
        activeElementEditable: true,
        dialogActive: false,
      }),
    ).toBe(true)
  })

  test("guard blocks while a dialog is active", () => {
    expect(
      sessionKeyGuardBlocked({
        protectedTarget: false,
        targetEditable: false,
        activeElement: undefined,
        activeElementProtected: false,
        activeElementEditable: false,
        dialogActive: true,
      }),
    ).toBe(true)
  })

  test("isScrollGestureKey matches exactly the four scroll keys", () => {
    expect(isScrollGestureKey("PageUp")).toBe(true)
    expect(isScrollGestureKey("PageDown")).toBe(true)
    expect(isScrollGestureKey("Home")).toBe(true)
    expect(isScrollGestureKey("End")).toBe(true)
    expect(isScrollGestureKey("ArrowUp")).toBe(false)
    expect(isScrollGestureKey("a")).toBe(false)
    expect(isScrollGestureKey("")).toBe(false)
  })

  test("shouldFocusComposer takes plain single characters only", () => {
    expect(
      shouldFocusComposer({ key: "a", ctrlKey: false, metaKey: false, composerBlocked: false, childSession: false }),
    ).toBe(true)
    expect(
      shouldFocusComposer({ key: "Escape", ctrlKey: false, metaKey: false, composerBlocked: false, childSession: false }),
    ).toBe(false)
    expect(
      shouldFocusComposer({ key: "a", ctrlKey: true, metaKey: false, composerBlocked: false, childSession: false }),
    ).toBe(false)
    expect(
      shouldFocusComposer({ key: "a", ctrlKey: false, metaKey: true, composerBlocked: false, childSession: false }),
    ).toBe(false)
  })

  test("shouldFocusComposer refuses blocked composers and child sessions", () => {
    expect(
      shouldFocusComposer({ key: "a", ctrlKey: false, metaKey: false, composerBlocked: true, childSession: false }),
    ).toBe(false)
    expect(
      shouldFocusComposer({ key: "a", ctrlKey: false, metaKey: false, composerBlocked: false, childSession: true }),
    ).toBe(false)
    expect(
      shouldFocusComposer({ key: "Unidentified", ctrlKey: false, metaKey: false, composerBlocked: false, childSession: false }),
    ).toBe(false)
  })
})
