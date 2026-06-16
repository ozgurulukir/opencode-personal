export async function fetchWith429Retry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
  retry = { count: 0 },
): Promise<Response> {
  const res = await fetch(url, options)
  if (res.status === 429 && retry.count < maxRetries) {
    await new Promise((resolve) => setTimeout(resolve, Math.pow(2, retry.count) * 500))
    return fetchWith429Retry(url, options, maxRetries, { count: retry.count + 1 })
  }
  return res
}
