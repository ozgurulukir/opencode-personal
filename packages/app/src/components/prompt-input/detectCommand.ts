export type DetectedCommand = {
  name: string
  arguments: string
  raw: string
}

export const detectCommand = (text: string, commands: { name: string }[]): DetectedCommand | undefined => {
  if (!text.startsWith("/")) return
  const [head, ...tail] = text.split(" ")
  const name = head.slice(1)
  if (!name || !commands.find((cmd) => cmd.name === name)) return
  return { name, arguments: tail.join(" "), raw: text }
}
