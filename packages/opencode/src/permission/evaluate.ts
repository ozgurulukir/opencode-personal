import { Wildcard } from "@/util/wildcard"

type Rule = {
  permission: string
  pattern: string
  action: "allow" | "deny" | "ask"
}

export function evaluate(permission: string, pattern: string, ...rulesets: Rule[][]): Rule {
  const rules = rulesets.flat()
  const match = rules.findLast(
    (rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern),
  )
  return match ?? { action: "ask", permission, pattern: "*" }
}

export interface LabeledRuleset {
  source: string
  rules: Rule[]
}

export function evaluateWithSource(
  permission: string,
  pattern: string,
  ...rulesets: LabeledRuleset[]
): Rule & { source?: string } {
  const flat: (Rule & { source?: string })[] = []
  for (const rs of rulesets) {
    for (const rule of rs.rules) {
      flat.push({ ...rule, source: rs.source })
    }
  }
  const match = flat.findLast(
    (rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern),
  )
  return match ?? { action: "ask", permission, pattern: "*" }
}
