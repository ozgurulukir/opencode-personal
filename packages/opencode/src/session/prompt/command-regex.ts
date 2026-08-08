// Regexes used by the SessionPrompt.command slash-command parser.

export const bashRegex = /!`([^`]+)`/g
// Match [Image N] as single token, quoted strings, or non-space sequences
export const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
export const placeholderRegex = /\$(\d+)/g
export const quoteTrimRegex = /^["']|["']$/g
