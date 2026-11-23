let nav: ((href: string) => void) | undefined

export const setNavigate = (fn: (href: string) => void) => {
  nav = fn
}

function isSameOriginPath(href: string) {
  if (!href.startsWith("/") || href.startsWith("//")) return false
  try {
    // Parsing normalizes backslashes and tabs, which browsers treat as path
    // separators for special schemes (`/\evil.example` resolves to another origin).
    return new URL(href, window.location.origin).origin === window.location.origin
  } catch {
    return false
  }
}

export const handleNotificationClick = (href?: string) => {
  window.focus()
  if (!href) return
  if (nav) return nav(href)
  // Only same-origin paths may reach location.assign; absolute, scheme-relative,
  // and backslash-escaped URLs are refused.
  if (!isSameOriginPath(href)) return
  console.warn("notification-click: navigate function not set, falling back to window.location.assign")
  window.location.assign(href)
}
