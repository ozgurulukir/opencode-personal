let nav: ((href: string) => void) | undefined

export const setNavigate = (fn: (href: string) => void) => {
  nav = fn
}

export const handleNotificationClick = (href?: string) => {
  window.focus()
  if (!href) return
  if (nav) return nav(href)
  // Only same-origin paths are valid here; refuse scheme-relative and absolute URLs.
  if (!href.startsWith("/") || href.startsWith("//")) return
  console.warn("notification-click: navigate function not set, falling back to window.location.assign")
  window.location.assign(href)
}
