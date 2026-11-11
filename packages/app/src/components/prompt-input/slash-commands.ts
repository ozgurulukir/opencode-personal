export type BuiltinCommandOption = {
  id: string
  title: string
  description?: string
  keybind?: string
  slash?: string
  disabled?: boolean
}

export type CustomCommand = {
  name: string
  description?: string
  source?: "command" | "mcp" | "skill"
}

export function buildSlashCommands(builtin: BuiltinCommandOption[], custom: CustomCommand[]) {
  const mappedBuiltin = builtin
    .filter((opt) => !opt.disabled && !opt.id.startsWith("suggested.") && opt.slash)
    .map((opt) => ({
      id: opt.id,
      trigger: opt.slash!,
      title: opt.title,
      description: opt.description,
      keybind: opt.keybind,
      type: "builtin" as const,
    }))

  const mappedCustom = custom.map((cmd) => ({
    id: `custom.${cmd.name}`,
    trigger: cmd.name,
    title: cmd.name,
    description: cmd.description,
    type: "custom" as const,
    source: cmd.source,
  }))

  return [...mappedCustom, ...mappedBuiltin]
}
