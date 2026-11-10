import { describe, expect, test } from "bun:test"
import { dict as en } from "./en"
import { dict as ar } from "./ar"
import { dict as br } from "./br"
import { dict as bs } from "./bs"
import { dict as da } from "./da"
import { dict as de } from "./de"
import { dict as es } from "./es"
import { dict as fr } from "./fr"
import { dict as ja } from "./ja"
import { dict as ko } from "./ko"
import { dict as no } from "./no"
import { dict as pl } from "./pl"
import { dict as ru } from "./ru"
import { dict as th } from "./th"
import { dict as zh } from "./zh"
import { dict as zht } from "./zht"
import { dict as tr } from "./tr"

const locales = { ar, br, bs, da, de, es, fr, ja, ko, no, pl, ru, th, tr, zh, zht } as const
const keys = ["command.session.previous.unseen", "command.session.next.unseen"] as const

describe("i18n parity", () => {
  test("non-English locales translate targeted unseen session keys", () => {
    for (const locale of Object.values(locales)) {
      for (const key of keys) {
        expect(locale[key]).toBeDefined()
        expect(locale[key]).not.toBe(en[key])
      }
    }
  })

  test("every locale has exactly the same key set as en", () => {
    const enKeys = Object.keys(en).sort()
    const enKeySet = new Set(enKeys)
    const drift = Object.fromEntries(
      Object.entries(locales)
        .map(([name, dict]) => {
          const keys = new Set(Object.keys(dict))
          return [name, {
            missing: enKeys.filter((k) => !keys.has(k)),
            extra: [...keys].filter((k) => !enKeySet.has(k)),
          }] as const
        })
        .filter(([, v]) => v.missing.length > 0 || v.extra.length > 0),
    )
    expect(drift).toEqual({})
  })
})
