import { InvalidServerUrlError } from "./schema"

export const normalizeServerUrl = (input: string): string => {
  let url: URL
  try {
    url = new URL(input)
  } catch (cause) {
    throw new InvalidServerUrlError({ message: `Invalid server URL: "${input}"`, cause })
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new InvalidServerUrlError({ message: `Server URL must use http or https: "${input}"` })
  }
  url.search = ""
  url.hash = ""

  const pathname = url.pathname.replace(/\/+$/, "")
  return pathname.length === 0 ? url.origin : `${url.origin}${pathname}`
}
