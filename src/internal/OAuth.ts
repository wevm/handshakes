/** @module Form-encoded requests to OAuth endpoints, and their RFC 6749 §5.2 error responses. */

/** The parsed response of an OAuth endpoint. */
export type Result =
  | { body: Readonly<Record<string, unknown>>; ok: true }
  | {
      /** RFC 6749 `error`, or `server_error` for a response without one. */
      error: string
      errorDescription: string | undefined
      ok: false
      status: number
    }

/** Sends `body` as `application/x-www-form-urlencoded` to `url`, and parses the JSON response. */
export async function post(options: post.Options): Promise<Result> {
  const response = await options.fetch(options.url, {
    body: new URLSearchParams(
      Object.entries(options.body).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  })

  const body = await (async () => {
    try {
      const json: unknown = await response.json()
      return typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  })()

  if (response.ok) return { body, ok: true }
  return {
    error: typeof body['error'] === 'string' ? body['error'] : 'server_error',
    errorDescription:
      typeof body['error_description'] === 'string' ? body['error_description'] : undefined,
    ok: false,
    status: response.status,
  }
}

export declare namespace post {
  type Options = {
    /** Form fields. Fields with `undefined` are left out. */
    body: Readonly<Record<string, string | undefined>>
    fetch: typeof globalThis.fetch
    url: string
  }
}
