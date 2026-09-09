import type { TextFieldProps } from "./text-field"

/**
 * Escape clears a clearable field instead of bubbling to the parent dialog.
 * Returns true when the field has a value and an onClear handler, meaning the
 * caller must stop propagation so the dialog does not close underneath.
 */
export function shouldClearOnEscape(key: string, hasOnClear: boolean, hasValue: boolean): boolean {
  return key === "Escape" && hasOnClear && hasValue
}

/**
 * Invokes a user-supplied onKeyDown, supporting SolidJS bound handler tuples
 * ([handler, argument]) in addition to plain functions.
 */
export function forwardKeyDown(onKeyDown: TextFieldProps["onKeyDown"], e: KeyboardEvent) {
  if (typeof onKeyDown === "function") {
    onKeyDown(e)
  } else if (Array.isArray(onKeyDown)) {
    onKeyDown[0](onKeyDown[1], e)
  }
}
