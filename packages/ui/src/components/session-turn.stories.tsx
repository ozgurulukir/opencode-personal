// @ts-nocheck
/**
 * Storybook stories for SessionTurn and sub-components.
 * Covers critical user journeys and edge cases for visual regression testing.
 */

import { DataProvider } from "../context/data"
import { FileComponentProvider } from "../context/file"
import { SessionTurn } from "./session-turn"
import { SessionTurnDiffs } from "./session-turn-diffs"
import { SessionTurnHeader } from "./session-turn-header"
import { SessionTurnThinking } from "./session-turn-thinking"
import {
  mkUser,
  mkAssistant,
  textPart,
  reasoningPart,
  toolPart,
  mkDiff,
  mkError,
  mkSessionStatus,
  TOOL_SAMPLES,
  DIFF_SAMPLES,
  mkTurn,
} from "./session-turn-mock"

const SESSION_ID = "story-session"
const USER_ID = "story-user-1"
const ASST_ID = "story-asst-1"

// File viewer stub - avoids loading real @pierre/diffs web component
const FileStub = () => (
  <div
    style={{
      padding: "8px",
      color: "var(--text-weak)",
      fontSize: "13px",
      fontFamily: "monospace",
      background: "var(--bg-subtle)",
      borderRadius: "4px",
    }}
  >
    File viewer stub
  </div>
)

// Helper: wrap children in required providers
function wrap(children, data = {}) {
  return (
    <DataProvider
      data={{
        session: [{ id: SESSION_ID, title: "Story Session" }],
        session_status: { [SESSION_ID]: mkSessionStatus("idle") },
        session_diff: {},
        message: { [SESSION_ID]: [] },
        part: {},
        provider: {
          all: [
            {
              id: "anthropic",
              models: {
                "claude-sonnet-4-20250514": { name: "Claude Sonnet", id: "claude-sonnet-4-20250514" },
              },
            },
          ],
        },
        ...data,
      }}
      directory="/project"
    >
      <FileComponentProvider component={FileStub}>{children}</FileComponentProvider>
    </DataProvider>
  )
}

// =============================================================================
// SessionTurn Stories (6 stories)
// =============================================================================

export default {
  title: "UI/SessionTurn",
  component: SessionTurn,
  parameters: {
    layout: "fullscreen",
  },
}

// Story 1: Turn_UserMessage
export const Turn_UserMessage = () => {
  const turn = mkTurn({ text: "Fix the bug in the login form", active: true })
  
  return wrap(
    <div style={{ "max-width": "800px", margin: "0 auto", padding: "20px" }}>
      <SessionTurn sessionID={SESSION_ID} messageID={USER_ID} showReasoningSummaries={false} />
    </div>,
    {
      message: { [SESSION_ID]: [turn.user] },
      part: { [USER_ID]: turn.userParts },
      session_status: { [SESSION_ID]: turn.status },
    },
  )
}

// Story 2: Turn_AssistantText
export const Turn_AssistantText = () => {
  const turn = mkTurn({ text: "I've fixed the bug by updating the validation logic.", active: false })
  
  return wrap(
    <div style={{ "max-width": "800px", margin: "0 auto", padding: "20px" }}>
      <SessionTurn sessionID={SESSION_ID} messageID={ASST_ID} showReasoningSummaries={false} />
    </div>,
    {
      message: { [SESSION_ID]: [turn.user, turn.assistant] },
      part: { [USER_ID]: turn.userParts, [ASST_ID]: turn.assistantParts },
      session_status: { [SESSION_ID]: turn.status },
    },
  )
}

// Story 3: Turn_ToolCalls
export const Turn_ToolCalls = () => {
  const turn = mkTurn({
    text: "I've run the tests and fixed the issues:",
    toolCount: 4,
    toolNames: ["bash", "edit", "read", "glob"],
    active: false,
  })
  
  return wrap(
    <div style={{ "max-width": "800px", margin: "0 auto", padding: "20px" }}>
      <SessionTurn sessionID={SESSION_ID} messageID={ASST_ID} showReasoningSummaries={false} />
    </div>,
    {
      message: { [SESSION_ID]: [turn.user, turn.assistant] },
      part: { [USER_ID]: turn.userParts, [ASST_ID]: turn.assistantParts },
      session_status: { [SESSION_ID]: turn.status },
      session_diff: {
        [ASST_ID]: {
          files: turn.diffs,
          additions: 25,
          deletions: 10,
        },
      },
    },
  )
}

// Story 4: Turn_Interrupted
export const Turn_Interrupted = () => {
  const turn = mkTurn({
    text: "Let me analyze the codebase...",
    toolCount: 2,
    compaction: true,
    active: false,
  })
  
  return wrap(
    <div style={{ "max-width": "800px", margin: "0 auto", padding: "20px" }}>
      <SessionTurn sessionID={SESSION_ID} messageID={ASST_ID} showReasoningSummaries={false} />
    </div>,
    {
      message: { [SESSION_ID]: [turn.user, turn.assistant] },
      part: { [USER_ID]: turn.userParts, [ASST_ID]: turn.assistantParts },
      session_status: { [SESSION_ID]: turn.status },
    },
  )
}

// Story 5: Turn_Error
export const Turn_Error = () => {
  const turn = mkTurn({
    text: "",
    error: mkError("ProviderAuthError", "Invalid API key. Please check your credentials."),
    active: false,
  })
  
  return wrap(
    <div style={{ "max-width": "800px", margin: "0 auto", padding: "20px" }}>
      <SessionTurn sessionID={SESSION_ID} messageID={ASST_ID} showReasoningSummaries={false} />
    </div>,
    {
      message: { [SESSION_ID]: [turn.user, turn.assistant] },
      part: { [USER_ID]: turn.userParts, [ASST_ID]: turn.assistantParts },
      session_status: { [SESSION_ID]: turn.status },
    },
  )
}

// Story 6: Turn_Thinking
export const Turn_Thinking = () => {
  const turn = mkTurn({
    text: "",
    reasoningText: "**Analyzing the request**\n\nThe user wants to fix a bug. Let me find the relevant files.",
    active: true,
  })
  
  return wrap(
    <div style={{ "max-width": "800px", margin: "0 auto", padding: "20px" }}>
      <SessionTurn sessionID={SESSION_ID} messageID={ASST_ID} showReasoningSummaries={true} />
    </div>,
    {
      message: { [SESSION_ID]: [turn.user, turn.assistant] },
      part: { [USER_ID]: turn.userParts, [ASST_ID]: turn.assistantParts },
      session_status: { [SESSION_ID]: turn.status },
    },
  )
}

// =============================================================================
// SessionTurnDiffs Stories (5 stories)
// =============================================================================

export const Diffs_Empty = () => (
  <div style={{ "max-width": "800px", margin: "0 auto", padding: "20px" }}>
    <SessionTurnDiffs
      diffs={[]}
      edited={0}
      working={false}
      fileComponent={FileStub}
      autoScroll={{ pause: () => {} }}
      t={(key) => key}
    />
  </div>
)

export const Diffs_SingleFile = () => {
  const diffs = DIFF_SAMPLES.single
  return (
    <div style={{ "max-width": "800px", margin: "0 auto", padding: "20px" }}>
      <SessionTurnDiffs
        diffs={diffs}
        edited={diffs.length}
        working={false}
        fileComponent={FileStub}
        autoScroll={{ pause: () => {} }}
        t={(key) => key}
      />
    </div>
  )
}

export const Diffs_MultipleFiles = () => {
  const diffs = DIFF_SAMPLES.multi
  return (
    <div style={{ "max-width": "800px", margin: "0 auto", padding: "20px" }}>
      <SessionTurnDiffs
        diffs={diffs}
        edited={diffs.length}
        working={false}
        fileComponent={FileStub}
        autoScroll={{ pause: () => {} }}
        t={(key) => key}
      />
    </div>
  )
}

export const Diffs_Overflow = () => {
  const diffs = DIFF_SAMPLES.overflow
  return (
    <div style={{ "max-width": "800px", margin: "0 auto", padding: "20px" }}>
      <SessionTurnDiffs
        diffs={diffs}
        edited={diffs.length}
        working={false}
        fileComponent={FileStub}
        autoScroll={{ pause: () => {} }}
        t={(key) => key}
      />
    </div>
  )
}

export const Diffs_Working = () => {
  const diffs = DIFF_SAMPLES.multi
  return (
    <div style={{ "max-width": "800px", margin: "0 auto", padding: "20px" }}>
      <SessionTurnDiffs
        diffs={diffs}
        edited={diffs.length}
        working={true}
        fileComponent={FileStub}
        autoScroll={{ pause: () => {} }}
        t={(key) => key}
      />
    </div>
  )
}

// =============================================================================
// SessionTurnHeader Stories (2 stories)
// =============================================================================

export const Header_Divider = () => (
  <div style={{ "max-width": "800px", margin: "0 auto", padding: "20px" }}>
    <SessionTurnHeader divider="Session compacted" error={undefined} errorText="" />
  </div>
)

export const Header_Error = () => (
  <div style={{ "max-width": "800px", margin: "0 auto", padding: "20px" }}>
    <SessionTurnHeader
      divider=""
      error={mkError("ProviderAuthError", "Invalid API key")}
      errorText="ProviderAuthError: Invalid API key. Please check your credentials."
    />
  </div>
)

// =============================================================================
// SessionTurnThinking Stories (2 stories)
// =============================================================================

export const Thinking_Visible = () => (
  <div style={{ "max-width": "800px", margin: "0 auto", padding: "20px" }}>
    <SessionTurnThinking
      show={true}
      showReasoningSummaries={false}
      reasoningHeading="Analyzing the request"
      t={(key) => key}
    />
  </div>
)

export const Thinking_Hidden = () => (
  <div style={{ "max-width": "800px", margin: "0 auto", padding: "20px" }}>
    <SessionTurnThinking
      show={false}
      showReasoningSummaries={false}
      reasoningHeading=""
      t={(key) => key}
    />
  </div>
)
