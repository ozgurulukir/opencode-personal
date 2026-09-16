import type { AgentSideConnection, TerminalHandle } from "@agentclientprotocol/sdk"

export type ACPClientTerminal = {
  sessionID: string
  callID: string
  terminal: TerminalHandle
}

const sessions = new Map<string, { connection: AgentSideConnection; terminal: boolean }>()
const terminals = new Map<string, ACPClientTerminal>()

type TerminalBackendMode = "auto" | "client" | "local"

function mode(): TerminalBackendMode {
  const value = process.env.OPENCODE_ACP_TERMINAL_BACKEND
  return value === "client" || value === "local" ? value : "auto"
}

export function registerConnection(sessionID: string, connection: AgentSideConnection, terminal: boolean) {
  sessions.set(sessionID, { connection, terminal })
}

export async function unregisterConnection(sessionID: string) {
  sessions.delete(sessionID)
  await Promise.all(Array.from(terminals.values()).filter((value) => value.sessionID === sessionID).map((value) => terminateClientTerminal(value)))
}

export async function unregisterConnectionTerminals(connection: AgentSideConnection) {
  await Promise.all(
    Array.from(sessions.entries())
      .filter(([, state]) => state.connection === connection)
      .map(([sessionID]) => unregisterConnection(sessionID)),
  )
}

export function terminalId(sessionID: string, callID: string) {
  return terminals.get(`${sessionID}:${callID}`)?.terminal.id
}

export async function createClientTerminal(request: {
  sessionID: string
  callID: string
  command: string
  args: string[]
  cwd: string
  env: Record<string, string | undefined>
  outputByteLimit?: number
}) {
  const state = sessions.get(request.sessionID)
  const selected = mode()
  if (selected === "local") return undefined
  if (!state?.terminal) {
    if (selected === "client") throw new Error("ACP client terminal capability is unavailable")
    return undefined
  }
  const terminal = await state.connection.createTerminal({
    sessionId: request.sessionID,
    command: request.command,
    args: request.args,
    cwd: request.cwd,
    env: Object.entries(request.env)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([name, value]) => ({ name, value })),
    ...(request.outputByteLimit !== undefined && { outputByteLimit: request.outputByteLimit }),
  })
  const execution = { sessionID: request.sessionID, callID: request.callID, terminal }
  terminals.set(`${request.sessionID}:${request.callID}`, execution)
  return execution
}

export async function releaseClientTerminal(execution: ACPClientTerminal) {
  const key = `${execution.sessionID}:${execution.callID}`
  if (terminals.get(key) !== execution) return
  terminals.delete(key)
  await execution.terminal.release().catch(() => undefined)
}

export async function terminateClientTerminal(execution: ACPClientTerminal) {
  const key = `${execution.sessionID}:${execution.callID}`
  if (terminals.get(key) !== execution) return
  terminals.delete(key)
  await execution.terminal.kill().catch(() => undefined)
  await execution.terminal.release().catch(() => undefined)
}
