import { describe, expect, test } from "bun:test"
import { buttonState } from "./button.shared"

describe("buttonState", () => {
  test("returns not disabled and no loading attrs by default", () => {
    const state = buttonState({})
    expect(state.disabled).toBe(false)
    expect(state.ariaBusy).toBeUndefined()
    expect(state.dataLoading).toBeUndefined()
  })

  test("disables button and sets busy/data-loading when loading is true", () => {
    const state = buttonState({ loading: true })
    expect(state.disabled).toBe(true)
    expect(state.ariaBusy).toBe("true")
    expect(state.dataLoading).toBe("")
  })

  test("disables button when disabled is true without loading", () => {
    const state = buttonState({ disabled: true })
    expect(state.disabled).toBe(true)
    expect(state.ariaBusy).toBeUndefined()
    expect(state.dataLoading).toBeUndefined()
  })

  test("loading=false does not set dataLoading or ariaBusy", () => {
    const state = buttonState({ loading: false })
    expect(state.disabled).toBe(false)
    expect(state.ariaBusy).toBeUndefined()
    expect(state.dataLoading).toBeUndefined()
  })

  test("disabled=true and loading=true both preserve disabled", () => {
    const state = buttonState({ disabled: true, loading: true })
    expect(state.disabled).toBe(true)
    expect(state.ariaBusy).toBe("true")
    expect(state.dataLoading).toBe("")
  })
})
