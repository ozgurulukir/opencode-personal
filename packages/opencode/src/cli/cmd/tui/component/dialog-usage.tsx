import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { useRouteData } from "@tui/context/route"
import { For, Show, createMemo } from "solid-js"

export type DialogUsageProps = {}

type ModelBreakdown = {
  model: string
  messages: number
  cost: number
  tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number }
}

type ToolUsage = { tool: string; count: number }

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return num.toLocaleString()
}

function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(6)}`
  return `$${cost.toFixed(2)}`
}

function renderBar(fraction: number, width = 20): string {
  const clamped = Math.min(Math.max(fraction, 0), 1)
  const filled = Math.round(clamped * width)
  return `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}`
}

export function DialogUsage() {
  const sync = useSync()
  const { theme } = useTheme()
  const dialog = useDialog()
  const route = useRouteData("session")

  const stats = createMemo(() => {
    if (!route) return null
    const messages = sync.data.message[route.sessionID] ?? []

    let totalCost = 0
    let totalInput = 0
    let totalOutput = 0
    let totalReasoning = 0
    let totalCacheRead = 0
    let totalCacheWrite = 0
    let assistantCount = 0
    const modelMap: Record<string, ModelBreakdown> = {}
    const toolMap: Record<string, number> = {}

    for (const msg of messages) {
      if (msg.role === "assistant") {
        assistantCount++
        totalCost += msg.cost ?? 0
        const tokens = msg.tokens
        if (tokens) {
          totalInput += tokens.input ?? 0
          totalOutput += tokens.output ?? 0
          totalReasoning += tokens.reasoning ?? 0
          totalCacheRead += tokens.cache?.read ?? 0
          totalCacheWrite += tokens.cache?.write ?? 0
        }

        const modelKey = `${msg.providerID}/${msg.modelID}`
        if (!modelMap[modelKey]) {
          modelMap[modelKey] = {
            model: modelKey,
            messages: 0,
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
          }
        }
        const entry = modelMap[modelKey]
        entry.messages++
        entry.cost += msg.cost ?? 0
        if (tokens) {
          entry.tokens.input += tokens.input ?? 0
          entry.tokens.output += tokens.output ?? 0
          entry.tokens.reasoning += tokens.reasoning ?? 0
          entry.tokens.cacheRead += tokens.cache?.read ?? 0
          entry.tokens.cacheWrite += tokens.cache?.write ?? 0
        }
      }

      const parts = sync.data.part[msg.id] ?? []
      for (const part of parts) {
        if (part.type === "tool" && part.tool) {
          toolMap[part.tool] = (toolMap[part.tool] ?? 0) + 1
        }
      }
    }

    const models = Object.values(modelMap).sort((a, b) => b.cost - a.cost)
    const tools = Object.entries(toolMap)
      .map(([tool, count]) => ({ tool, count }))
      .sort((a, b) => b.count - a.count)

    const totalTokens = totalInput + totalOutput + totalReasoning + totalCacheRead + totalCacheWrite

    return {
      totalCost,
      totalTokens,
      totalInput,
      totalOutput,
      totalReasoning,
      totalCacheRead,
      totalCacheWrite,
      assistantCount,
      models,
      tools,
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Usage
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <Show when={stats()} fallback={<text fg={theme.textMuted}>No active session</text>}>
        {(s) => (
          <>
            <text fg={theme.text}>
              <b>Cost:</b> {formatCost(s().totalCost)}
              {"  "}
              <b>Messages:</b> {s().assistantCount}
              {"  "}
              <b>Total Tokens:</b> {formatNumber(s().totalTokens)}
            </text>

            <box flexDirection="row" gap={2}>
              <text fg={theme.textMuted}>Input</text>
              <text fg={theme.text}>{formatNumber(s().totalInput)}</text>
              <text fg={theme.textMuted}>Output</text>
              <text fg={theme.text}>{formatNumber(s().totalOutput)}</text>
            </box>
            <box flexDirection="row" gap={2}>
              <text fg={theme.textMuted}>Cache R</text>
              <text fg={theme.text}>{formatNumber(s().totalCacheRead)}</text>
              <text fg={theme.textMuted}>Cache W</text>
              <text fg={theme.text}>{formatNumber(s().totalCacheWrite)}</text>
            </box>
            <Show when={s().totalReasoning > 0}>
              <text fg={theme.textMuted}>Reasoning: {formatNumber(s().totalReasoning)}</text>
            </Show>

            <Show when={s().models.length > 0}>
              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                Models
              </text>
              <For each={s().models}>
                {(m: ModelBreakdown) => (
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.text} flexShrink={0}>
                      <b>{m.model}</b>
                    </text>
                    <text fg={theme.textMuted}>
                      {m.messages} msgs · {formatCost(m.cost)} · in:{formatNumber(m.tokens.input)} out:
                      {formatNumber(m.tokens.output)}
                    </text>
                  </box>
                )}
              </For>
            </Show>

            <Show when={s().tools.length > 0}>
              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                Tools
              </text>
              <For each={s().tools.slice(0, 10)}>
                {(t: ToolUsage) => {
                  const maxCount = s().tools[0]?.count ?? 1
                  const fraction = t.count / maxCount
                  return (
                    <box flexDirection="row" gap={1}>
                      <text fg={theme.text} flexShrink={0} style={{ width: 20 }}>
                        {t.tool}
                      </text>
                      <text fg={theme.textMuted}>{renderBar(fraction)}</text>
                      <text fg={theme.text}>{t.count}</text>
                    </box>
                  )
                }}
              </For>
            </Show>
          </>
        )}
      </Show>
    </box>
  )
}
