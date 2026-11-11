export function isEditableTarget(target: EventTarget | null | undefined) {
  if (!(target instanceof HTMLElement)) return false
  return /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName) || target.isContentEditable
}

export function deepActiveElement() {
  let current: Element | null = document.activeElement
  while (current instanceof HTMLElement && current.shadowRoot?.activeElement) {
    current = current.shadowRoot.activeElement
  }
  return current instanceof HTMLElement ? current : undefined
}

export function sessionKeyGuardBlocked(input: {
  protectedTarget: boolean
  targetEditable: boolean
  activeElement: HTMLElement | undefined
  activeElementProtected: boolean
  activeElementEditable: boolean
  dialogActive: boolean
}) {
  if (input.protectedTarget || input.targetEditable) return true
  if (input.activeElement && (input.activeElementProtected || input.activeElementEditable)) return true
  if (input.dialogActive) return true
  return false
}

export function isScrollGestureKey(key: string) {
  return key === "PageUp" || key === "PageDown" || key === "Home" || key === "End"
}

export function shouldFocusComposer(input: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  composerBlocked: boolean
  childSession: boolean
}) {
  if (input.key.length !== 1 || input.key === "Unidentified") return false
  if (input.ctrlKey || input.metaKey) return false
  if (input.composerBlocked || input.childSession) return false
  return true
}
