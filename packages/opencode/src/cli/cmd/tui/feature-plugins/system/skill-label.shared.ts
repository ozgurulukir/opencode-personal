export function formatSkillLabel(input: Record<string, unknown>, pending?: string) {
  const names = Array.isArray(input.names)
    ? input.names.filter((name): name is string => typeof name === "string" && name.length > 0)
    : []
  const name = typeof input.name === "string" ? input.name : undefined
  if (name) names.push(name)
  const unique = [...new Set(names)]

  if (unique.length === 0) return pending !== undefined ? `Skill "${pending}"` : "Skill"
  if (unique.length === 1) return `Skill "${unique[0]}"`

  const joined = unique.length <= 3 ? unique.join(", ") : `${unique.slice(0, 3).join(", ")}, +${unique.length - 3}`
  return `${unique.length} Skills: ${joined}`
}
