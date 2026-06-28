import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"

export type InternalTuiPlugin = Omit<TuiPluginModule, "id"> & {
  id: string
  tui: TuiPlugin
  enabled?: boolean
}
