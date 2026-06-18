import { test, expect } from "bun:test"
import { hints } from "../../src/command/index"

test("returns empty array when template has no variables", () => {
  expect(hints("Hello world")).toEqual([])
})

test("returns a single numbered variable", () => {
  expect(hints("Run $1")).toEqual(["$1"])
})

test("returns multiple numbered variables sorted", () => {
  expect(hints("Run $2 and $1")).toEqual(["$1", "$2"])
})

test("deduplicates repeated numbered variables", () => {
  expect(hints("Run $1 and $1 again")).toEqual(["$1"])
})

test("includes $ARGUMENTS when present", () => {
  expect(hints("Run $ARGUMENTS")).toEqual(["$ARGUMENTS"])
})

test("combines numbered variables and $ARGUMENTS", () => {
  expect(hints("Run $1 and $ARGUMENTS")).toEqual(["$1", "$ARGUMENTS"])
})

test("handles only $ARGUMENTS with no numbered variables", () => {
  expect(hints("$ARGUMENTS")).toEqual(["$ARGUMENTS"])
})

test("handles mixed variables with gaps in numbering", () => {
  expect(hints("Run $3 and $1")).toEqual(["$1", "$3"])
})
