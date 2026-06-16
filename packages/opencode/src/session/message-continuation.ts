export function wrapMessageContinuation(
  messages: Array<{
    info: { id: string; role: string }
    parts: Array<{ type: string; ignored?: boolean; synthetic?: boolean; text?: string }>
  }>,
  lastFinishedID: string,
): void {
  for (const m of messages) {
    if (m.info.role !== "user" || m.info.id <= lastFinishedID) continue
    for (const p of m.parts) {
      if (p.type !== "text" || p.ignored || p.synthetic) continue
      if (!p.text?.trim()) continue
      p.text = [
        "<system-reminder>",
        "The user sent the following message:",
        p.text,
        "",
        "Please address this message and continue with your tasks.",
        "</system-reminder>",
      ].join("\n")
    }
  }
}
