import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Session } from "@/session/session"
import { SessionRevert } from "@/session/revert"
import { Snapshot } from "@/snapshot"
import { SyncEvent } from "@/sync"
import { MessageV2 } from "@/session/message-v2"
import { LEGACY_MESSAGE_ID, SessionMessage } from "@/v2/session-message"
import { MessageID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { MessageTable, SessionMessageTable } from "@/session/session.sql"
import * as Database from "@/storage/db"
import { and, eq } from "@/storage/db"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

const env = Layer.mergeAll(
  Session.defaultLayer,
  SessionRevert.defaultLayer,
  Snapshot.defaultLayer,
  SyncEvent.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
)

const it = testEffect(env)

describe("revert seam — V2 dead rows", () => {
  it.live(
    "MessageV2.Event.Removed deletes both V1 and V2 rows",
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const sync = yield* SyncEvent.Service

          const info = yield* sessions.create({})
          const msg = yield* sessions.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: info.id,
            agent: "default",
            model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-4") },
            time: { created: Date.now() },
          })

          // A V2 projected row associated with the V1 message, as written by
          // session-message-updater.ts on prompted/step events.
          Database.use((db) =>
            db
              .insert(SessionMessageTable)
              .values({
                id: SessionMessage.ID.make(`evt_${msg.id.slice(4)}`),
                session_id: info.id,
                type: "user",
                time_created: msg.time.created,
                data: {
                  type: "user",
                  metadata: { [LEGACY_MESSAGE_ID]: msg.id },
                  time: { created: msg.time.created },
                } as (typeof SessionMessageTable.$inferInsert)["data"],
              })
              .run(),
          )

          // What SessionRevert.cleanup emits per reverted message.
          yield* sync.run(MessageV2.Event.Removed, {
            sessionID: info.id,
            messageID: msg.id,
          })

          // The removal event deletes the V1 row...
          const v1Row = Database.use((db) =>
            db
              .select()
              .from(MessageTable)
              .where(and(eq(MessageTable.id, msg.id), eq(MessageTable.session_id, info.id)))
              .get(),
          )
          expect(v1Row).toBeUndefined()

          // ...and the V2 read model row associated via LEGACY_MESSAGE_ID
          // alongside it.
          const v2Rows = Database.use((db) =>
            db
              .select()
              .from(SessionMessageTable)
              .where(eq(SessionMessageTable.session_id, info.id))
              .all(),
          )
          expect(v2Rows.length).toBe(0)
        }),
    ),
  )
})
