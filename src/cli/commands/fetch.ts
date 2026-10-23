/**
 * @module The `fetch` command: sends a request with an access token. Without a profile, it discovers
 * the authorization server from the RFC 9728 metadata of the API.
 */
import * as Fs from 'node:fs'
import { Cli, z } from 'incur'
import * as Client from '../../Client.js'
import * as Errors from '../../internal/Errors.js'
import * as Metadata from '../../Metadata.js'
import * as Store from '../../node/Store.js'
import * as Context from '../Context.js'
import * as Profile from '../Profile.js'

/** Options of a request. An agent, through MCP, receives only these. */
const request = z.object({
  data: z.string().optional().describe('Request body'),
  header: z.array(z.string()).optional().describe('Request header, as `Name: value`. Repeatable'),
  method: z.string().optional().describe('Default: GET, or POST with --data'),
})

/** Options of the command in a shell. */
const shell = z.object({
  ...Context.options.shape,
  ...request.shape,
  data: z.string().optional().describe('Request body, or @file to read it from a file'),
  fail: z
    .boolean()
    .optional()
    .describe('Exits 22 on HTTP 400 or more, as curl does. The output still holds the response'),
  include: z.boolean().optional().describe('Prints the status and the headers before the body'),
})

/**
 * Returns the `fetch` command. For an agent (`--mcp`), it accepts only the options of a request,
 * and reads no file through `--data @file`, so a prompt cannot redirect a token, read a local file,
 * or name a variable that holds a secret. The agent reads the HTTP status from the result.
 */
export function create(options: { agent: boolean }) {
  return Cli.command({
    alias: { data: 'd', header: 'H', include: 'i', method: 'X' },
    args: z.object({
      profile: z
        .string()
        .optional()
        .describe('Name of the profile, or the URL when no profile applies'),
      url: z.string().optional().describe('URL of the request'),
    }),
    description:
      'Sends a request with an access token, and prints the response body. Without a profile, discovers the authorization server from the API.',
    // The agent schema holds a subset of the optional fields. Parsing strips other keys, so they read as absent.
    options: (options.agent ? request : shell) as typeof shell,
    async run(c) {
      // `fetch <url>` and `fetch <profile> <url>` share the positions.
      const name = c.args.url === undefined ? undefined : c.args.profile
      const url = c.args.url ?? c.args.profile
      if (!url)
        return c.error({
          code: 'NO_URL',
          exitCode: 2,
          message:
            'No URL is set. To resolve: Pass the URL, such as `handshakes fetch https://api.example.com/v1/items`.',
        })

      const headers = new Headers()
      for (const header of c.options.header ?? []) {
        const index = header.indexOf(':')
        if (index < 1)
          return c.error({
            code: 'INVALID_HEADER',
            exitCode: 2,
            message: `Invalid header: ${header}. To resolve: Write each header as \`Name: value\`.`,
          })
        headers.append(header.slice(0, index).trim(), header.slice(index + 1).trim())
      }

      const body = (() => {
        const data = c.options.data
        if (data === undefined) return undefined
        return !options.agent && data.startsWith('@') ? Fs.readFileSync(data.slice(1)) : data
      })()

      try {
        const profile = Profile.resolve({ name, overrides: c.options })
        const client = profile
          ? Context.client({ args: { profile: name }, options: c.options }).client
          : await Client.discover({
              clientId: c.options.clientId,
              clientSecret: Context.clientSecret(c.options),
              interactive: c.options.interactive,
              scope: c.options.scope,
              sources: Context.sources(c.options),
              store: Store.file(),
              url,
            })

        // `Client.fetch` keeps a token within its `resource`. Without one, the token stays on the origin of the server.
        const server = profile?.resource
          ? undefined
          : (profile?.issuer ?? profile?.endpoints?.token)
        if (server && new URL(server).origin !== new URL(url).origin)
          return c.error({
            code: 'OUTSIDE_RESOURCE',
            exitCode: 2,
            message: `The URL ${url} is outside the origin of the profile, ${new URL(server).origin}. To resolve: Set \`resource\` in the profile to the API that the token is for.`,
          })

        const response = await client.fetch(url, {
          ...(body === undefined ? {} : { body }),
          headers,
          method: c.options.method ?? (body === undefined ? 'GET' : 'POST'),
        })
        const text = await response.text()

        // As with `curl --fail-with-body`, the output still holds the response, so the error of the
        // API stays readable.
        if (c.options.fail === true && response.status >= 400) process.exitCode = 22

        if (!c.formatExplicit) {
          if (c.options.include) {
            process.stdout.write(`HTTP ${response.status} ${response.statusText}\n`)
            for (const [key, value] of response.headers) process.stdout.write(`${key}: ${value}\n`)
            process.stdout.write('\n')
          }
          process.stdout.write(text)
          return
        }
        return {
          body: text,
          headers: Object.fromEntries(response.headers),
          status: response.status,
        }
      } catch (error) {
        if (error instanceof Client.ResourceError)
          return c.error({ code: 'OUTSIDE_RESOURCE', exitCode: 2, message: Errors.inline(error) })
        if (
          error instanceof Client.DiscoveryError ||
          error instanceof Metadata.ResourceNotFoundError
        )
          return c.error({ code: 'NO_PROFILE', exitCode: 2, message: Errors.inline(error) })
        return c.error(Context.error(error))
      }
    },
  })
}
