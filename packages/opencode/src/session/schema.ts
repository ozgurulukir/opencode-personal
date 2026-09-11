import { Schema } from "effect"

import { Identifier } from "@/id/id"
import { withStatics } from "@opencode-ai/core/schema"
import { EventV2 } from "@/v2/event"

export const SessionID = Schema.String.check(Schema.isStartsWith("ses")).pipe(
  Schema.brand("SessionID"),
  withStatics((s) => ({
    descending: (id?: string) => s.make(Identifier.descending("session", id)),
  })),
)

export type SessionID = Schema.Schema.Type<typeof SessionID>

export const MessageID = Schema.String.check(Schema.isStartsWith("msg")).pipe(
  Schema.brand("MessageID"),
  withStatics((s) => ({
    ascending: (id?: string) => s.make(Identifier.ascending("message", id)),
  })),
)

export type MessageID = Schema.Schema.Type<typeof MessageID>

// V1 messages use msg_* identifiers while V2 projected messages use the
// event id that created each message (evt_*). Revert is shared by both APIs.
const RevertEventID = Schema.String.check(Schema.isStartsWith("evt"))
export const RevertMessageID = Schema.Union([MessageID, RevertEventID])
export type RevertMessageID = Schema.Schema.Type<typeof RevertMessageID>

export const PartID = Schema.String.check(Schema.isStartsWith("prt")).pipe(
  Schema.brand("PartID"),
  withStatics((s) => ({
    ascending: (id?: string) => s.make(Identifier.ascending("part", id)),
  })),
)

export type PartID = Schema.Schema.Type<typeof PartID>
