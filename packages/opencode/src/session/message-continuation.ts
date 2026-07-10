export function wrapMessageContinuation<
  T extends {
    info: { id: string; role: string }
    parts: Array<{ type: string; ignored?: boolean; synthetic?: boolean; text?: string }>
  },
>(messages: T[], lastFinishedID: string): T[] {
  return messages.map((m) => {
    if (m.info.role !== "user" || m.info.id <= lastFinishedID) return m
    return {
      ...m,
      parts: m.parts.map((p) => {
        if (p.type !== "text" || p.ignored || p.synthetic || !p.text?.trim()) return p
        return {
          ...p,
          text: [
            "<system-reminder>",
            "The user sent the following message:",
            p.text,
            "",
            "Please address this message and continue with your tasks.",
            "</system-reminder>",
          ].join("\n"),
        }
      }),
    }
  })
}
