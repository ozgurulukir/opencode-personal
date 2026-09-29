import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { useRouteData } from "@tui/context/route"
import { For, Show, createMemo, createResource } from "solid-js"
import { fetchUsageReports } from "@/provider/usage/registry"
import { resolveUsedFraction } from "@/provider/usage/types"
import type { UsageReport, UsageLimit } from "@/provider/usage/types"

export type DialogUsageProps = {}

type ModelBreakdown = {
  model: string
  messages: number
  cost: number
  tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number }
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return num.toLocaleString()
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00"
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}

function renderBar(fraction: number | undefined, width = 18): string {
  if (fraction === undefined) return `[${"░".repeat(width)}]   —`
  const clamped = Math.min(Math.max(fraction, 0), 1)
  const filled = Math.round(clamped * width)
  const pct = Math.round(clamped * 100)
    .toString()
    .padStart(3)
  return `[${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}] ${pct}%`
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

function formatProviderName(provider: string): string {
  return provider
    .split(/[-_]/g)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
    .join(" ")
}

export function DialogUsage() {
  const sync = useSync()
  const { theme } = useTheme()
  const dialog = useDialog()
  const route = useRouteData("session")
  const dimensions = useTerminalDimensions()

  // The dialog host offsets content down by ~1/4 of the terminal height, so the
  // usable height for the body is the remainder minus the header row + paddings.
  const bodyHeight = createMemo(() => Math.max(6, dimensions().height - Math.ceil(dimensions().height / 4) - 5))

  const [providerReports] = createResource(async () => {
    try {
      return await fetchUsageReports()
    } catch {
      return [] as UsageReport[]
    }
  })

  const sessionStats = createMemo(() => {
    if (!route) return null
    const messages = sync.data.messages[route.sessionID] ?? []

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
      if (msg.type === "assistant") {
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

        const modelKey = `${msg.model.providerID}/${msg.model.id}`
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

      if (msg.type !== "assistant") continue
      for (const content of msg.content) {
        if (content.type === "tool") {
          toolMap[content.name] = (toolMap[content.name] ?? 0) + 1
        }
      }
    }

    const models = Object.values(modelMap).sort((a, b) => b.cost - a.cost)
    const tools = Object.entries(toolMap)
      .map(([tool, count]) => ({ tool, count }))
      .sort((a, b) => b.count - a.count)

    return {
      totalCost,
      totalTokens: totalInput + totalOutput + totalReasoning + totalCacheRead + totalCacheWrite,
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

      <scrollbox height={bodyHeight()} scrollbarOptions={{ visible: true }}>
        <box flexDirection="column" gap={1}>
          {/* Provider Quota Reports */}
          <Show when={!providerReports.loading} fallback={<text fg={theme.textMuted}>Loading provider usage…</text>}>
            <Show
              when={providerReports()?.length}
              fallback={<text fg={theme.textMuted}>No provider quota data (requires OAuth auth)</text>}
            >
              <For each={providerReports()}>
                {(report: UsageReport) => (
                  <box gap={0}>
                    <box flexDirection="row" justifyContent="space-between" alignItems="center">
                      <text fg={theme.text} attributes={TextAttributes.BOLD}>
                        {formatProviderName(report.provider)}
                      </text>
                      <Show when={report.metadata?.email}>
                        <text fg={theme.textMuted}>{String(report.metadata!.email)}</text>
                      </Show>
                    </box>
                    <For each={report.limits}>
                      {(limit: UsageLimit) => {
                        const fraction = resolveUsedFraction(limit)
                        const window = limit.window?.label ?? limit.scope.windowId
                        const tier = limit.scope.tier ? ` (${limit.scope.tier})` : ""
                        const statusColor =
                          limit.status === "exhausted"
                            ? theme.error
                            : limit.status === "warning"
                              ? theme.warning
                              : theme.success
                        const resets =
                          limit.window?.resetsAt && limit.window.resetsAt > Date.now()
                            ? ` · resets in ${formatDuration(limit.window!.resetsAt! - Date.now())}`
                            : ""
                        return (
                          <box flexDirection="row" justifyContent="space-between" alignItems="center">
                            <text fg={theme.text}>
                              {limit.label}
                              {tier}
                              {window ? ` — ${window}` : ""}
                              <Show when={resets}>
                                <span style={{ fg: theme.textMuted }}>{resets}</span>
                              </Show>
                              <Show when={limit.notes?.length}>
                                <span style={{ fg: theme.textMuted }}>{"\n" + limit.notes!.join("\n")}</span>
                              </Show>
                            </text>
                            <text fg={statusColor}>
                              {limit.amount.unit === "usd" && fraction === undefined && limit.amount.remaining !== undefined
                                ? `$${limit.amount.remaining.toFixed(2)} left`
                                : fraction === undefined && limit.amount.unit !== "usd"
                                  ? ""
                                  : renderBar(fraction)}
                            </text>
                          </box>
                        )
                      }}
                    </For>
                  </box>
                )}
              </For>
            </Show>
          </Show>

          {/* Session Usage */}
          <Show when={sessionStats()} fallback={<text fg={theme.textMuted}>No active session</text>}>
            {(s) => (
              <box flexDirection="column" gap={0}>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  Session
                </text>
                <text fg={theme.text}>
                  <b>Cost:</b> {formatCost(s().totalCost)}
                  {"  "}
                  <b>Messages:</b> {s().assistantCount}
                  {"  "}
                  <b>Total Tokens:</b> {formatNumber(s().totalTokens)}
                </text>

                <box flexDirection="row" gap={2}>
                  <text fg={theme.textMuted} style={{ width: 8 }}>
                    Input
                  </text>
                  <text fg={theme.text} style={{ width: 10 }}>
                    {formatNumber(s().totalInput)}
                  </text>
                  <text fg={theme.textMuted} style={{ width: 8 }}>
                    Output
                  </text>
                  <text fg={theme.text}>{formatNumber(s().totalOutput)}</text>
                </box>
                <box flexDirection="row" gap={2}>
                  <text fg={theme.textMuted} style={{ width: 8 }}>
                    Cache R
                  </text>
                  <text fg={theme.text} style={{ width: 10 }}>
                    {formatNumber(s().totalCacheRead)}
                  </text>
                  <text fg={theme.textMuted} style={{ width: 8 }}>
                    Cache W
                  </text>
                  <text fg={theme.text}>{formatNumber(s().totalCacheWrite)}</text>
                </box>
                <Show when={s().totalReasoning > 0}>
                  <box flexDirection="row" gap={2}>
                    <text fg={theme.textMuted} style={{ width: 8 }}>
                      Reasoning
                    </text>
                    <text fg={theme.text}>{formatNumber(s().totalReasoning)}</text>
                  </box>
                </Show>

                <Show when={s().models.length > 0}>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    Models
                  </text>
                  <For each={s().models}>
                    {(m: ModelBreakdown) => (
                      <box flexDirection="row" gap={1}>
                        <text fg={theme.text} flexShrink={0} style={{ width: 26 }}>
                          {m.model}
                        </text>
                        <text fg={theme.textMuted} style={{ width: 9 }}>
                          {m.messages} msgs
                        </text>
                        <text fg={theme.text} style={{ width: 9 }}>
                          {formatCost(m.cost)}
                        </text>
                        <text fg={theme.textMuted}>
                          {formatNumber(m.tokens.input)} in · {formatNumber(m.tokens.output)} out
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
                    {(t: { tool: string; count: number }) => {
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
              </box>
            )}
          </Show>
        </box>
      </scrollbox>
    </box>
  )
}
