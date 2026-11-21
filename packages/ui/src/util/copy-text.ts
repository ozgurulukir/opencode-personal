/**
 * Shared clipboard write with a boolean result: copy buttons flip their
 * "copied" state only on success, and a rejected write (permission denied,
 * non-secure context, document not focused) must not surface as an unhandled
 * promise rejection inside an event handler.
 */
export async function copyText(value: string): Promise<boolean> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
  if (!clipboard) return false
  return clipboard.writeText(value).then(
    () => true,
    () => false,
  )
}
