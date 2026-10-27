import { randomBytes } from "crypto"

export namespace Identifier {
  const LENGTH = 28

  // State for monotonic ID generation
  let lastTimestamp = 0
  let counter = 0

  export function ascending() {
    return create(false)
  }

  export function descending() {
    return create(true)
  }

  function randomBase62(length: number): string {
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    let result = ""
    while (result.length < length) {
      const bytes = randomBytes(length - result.length)
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] < 248) {
          result += chars[bytes[i] % 62]
          if (result.length === length) break
        }
      }
    }
    return result
  }

  export function create(descending: boolean, timestamp?: number): string {
    const currentTimestamp = timestamp ?? Date.now()

    if (currentTimestamp !== lastTimestamp) {
      lastTimestamp = currentTimestamp
      counter = 0
    }
    counter++

    let now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(counter)

    if (descending) {
      now = ~now & BigInt("0xffffffffffffff")
    }

    const timeBytes = Buffer.alloc(7)
    for (let i = 0; i < 7; i++) {
      timeBytes[i] = Number((now >> BigInt(48 - 8 * i)) & BigInt(0xff))
    }

    return timeBytes.toString("hex") + randomBase62(LENGTH - 14)
  }
}
