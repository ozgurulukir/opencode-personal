function getRandomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  const c = globalThis.crypto
  if (c && typeof c.getRandomValues === "function") {
    try {
      c.getRandomValues(bytes)
      return bytes
    } catch {
      // ignore and fallback
    }
  }
  for (let i = 0; i < size; i++) {
    bytes[i] = Math.floor(Math.random() * 256)
  }
  return bytes
}

const byteToHex: string[] = []
for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 0x100).toString(16).slice(1))
}

function fallback(): string {
  const bytes = getRandomBytes(16)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  return (
    byteToHex[bytes[0]] +
    byteToHex[bytes[1]] +
    byteToHex[bytes[2]] +
    byteToHex[bytes[3]] +
    "-" +
    byteToHex[bytes[4]] +
    byteToHex[bytes[5]] +
    "-" +
    byteToHex[bytes[6]] +
    byteToHex[bytes[7]] +
    "-" +
    byteToHex[bytes[8]] +
    byteToHex[bytes[9]] +
    "-" +
    byteToHex[bytes[10]] +
    byteToHex[bytes[11]] +
    byteToHex[bytes[12]] +
    byteToHex[bytes[13]] +
    byteToHex[bytes[14]] +
    byteToHex[bytes[15]]
  )
}

export function uuid() {
  const c = globalThis.crypto
  if (!c || typeof c.randomUUID !== "function") return fallback()
  if (typeof globalThis.isSecureContext === "boolean" && !globalThis.isSecureContext) return fallback()
  try {
    return c.randomUUID()
  } catch {
    return fallback()
  }
}
