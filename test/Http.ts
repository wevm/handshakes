/** @module Serves a fetch handler over real HTTP on a random port, for integration tests. */
import * as Http from 'node:http'

/**
 * Starts a server on `127.0.0.1`. `create` receives the origin before the handler exists, since a
 * handler such as `Server` needs its own URL as its issuer.
 */
export async function serve(
  create: (url: string) => (request: Request) => Promise<Response>,
): Promise<{ close: () => Promise<void>; url: string }> {
  const server = Http.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address.')
  const url = `http://127.0.0.1:${address.port}`
  const handler = create(url)

  server.on('request', (incoming, outgoing) => {
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of incoming) chunks.push(chunk as Buffer)

      const method = incoming.method ?? 'GET'
      const request = new Request(new URL(incoming.url ?? '/', url), {
        ...(method === 'GET' || method === 'HEAD' ? {} : { body: Buffer.concat(chunks) }),
        headers: Object.entries(incoming.headers).flatMap((entry): [string, string][] =>
          typeof entry[1] === 'string' ? [[entry[0], entry[1]]] : [],
        ),
        method,
      })

      const response = await handler(request)
      outgoing.writeHead(response.status, Object.fromEntries(response.headers))
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    })()
  })

  return {
    // Clients keep connections alive, so `close` ends them instead of waiting for them to idle.
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      }),
    url,
  }
}
