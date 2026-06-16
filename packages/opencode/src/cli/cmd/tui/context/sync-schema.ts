import type {
  Message,
  Agent,
  Provider,
  Session,
  Part,
  Config,
  Todo,
  Command,
  PermissionRequest,
  QuestionRequest,
  LspStatus,
  McpStatus,
  McpResource,
  FormatterStatus,
  SessionStatus,
  ProviderListResponse,
  ProviderAuthMethod,
  VcsInfo,
} from "@opencode-ai/sdk/v2"
import type { Snapshot } from "@/snapshot"
import type { ConsoleState } from "@/config/console-state"

export type SyncStore = {
  status: "loading" | "partial" | "complete"
  provider: Provider[]
  provider_default: Record<string, string>
  provider_next: ProviderListResponse
  console_state: ConsoleState
  provider_auth: Record<string, ProviderAuthMethod[]>
  agent: Agent[]
  command: Command[]
  permission: {
    [sessionID: string]: PermissionRequest[]
  }
  question: {
    [sessionID: string]: QuestionRequest[]
  }
  config: Config
  session: Session[]
  session_status: {
    [sessionID: string]: SessionStatus
  }
  session_diff: {
    [sessionID: string]: Snapshot.FileDiff[]
  }
  todo: {
    [sessionID: string]: Todo[]
  }
  message: {
    [sessionID: string]: Message[]
  }
  part: {
    [messageID: string]: Part[]
  }
  lsp: LspStatus[]
  mcp: {
    [key: string]: McpStatus
  }
  mcp_resource: {
    [key: string]: McpResource
  }
  formatter: FormatterStatus[]
  vcs: VcsInfo | undefined
}
