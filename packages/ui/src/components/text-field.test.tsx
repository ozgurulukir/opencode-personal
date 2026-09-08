import { describe, expect, test, mock, beforeAll, afterAll } from "bun:test"
import { TextField } from "./text-field"
import { render, fireEvent, screen } from "@solidjs/testing-library"
import { JSDOM } from "jsdom"

let dom: JSDOM
beforeAll(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>')
  global.window = dom.window as any
  global.document = dom.window.document as any
  global.navigator = dom.window.navigator as any
})

afterAll(() => {
  dom.window.close()
})

describe("TextField", () => {
  test("calls onClear when Escape is pressed and there is a value", () => {
    let cleared = false
    const handleClear = () => {
      cleared = true
    }

    render(() => (
      <TextField value="test value" onClear={handleClear} />
    ))

    const input = screen.getByRole("textbox")

    // Simulate Escape key press
    fireEvent.keyDown(input, { key: "Escape" })

    expect(cleared).toBe(true)
  })

  test("does not call onClear when Escape is pressed and there is no value", () => {
    let cleared = false
    const handleClear = () => {
      cleared = true
    }

    render(() => (
      <TextField value="" onClear={handleClear} />
    ))

    const input = screen.getByRole("textbox")

    // Simulate Escape key press
    fireEvent.keyDown(input, { key: "Escape" })

    expect(cleared).toBe(false)
  })
})
