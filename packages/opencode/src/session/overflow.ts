import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import type { MessageV2 } from "./message-v2"
import * as ContextBudget from "./context-budget"

export function usable(input: { cfg: Config.Info; model: Provider.Model }) {
  return ContextBudget.usable(input.cfg, input.model)
}

export function isOverflow(input: { cfg: Config.Info; tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
  return ContextBudget.isOverflow(input.cfg, input.tokens, input.model)
}
