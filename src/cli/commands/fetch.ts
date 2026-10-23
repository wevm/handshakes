/**
 * @module The `fetch` command: sends a request with an access token. Without a profile, it discovers
 * the authorization server from the RFC 9728 metadata of the API.
 */
import * as Fs from 'node:fs'
import { Cli, z } from 'incur'
import * as Client from '../../Client.js'
import * as Errors from '../../internal/Errors.js'
import * as Metadata from '../../Metadata.js'
import * as Source from '../../node/Source.js'
import * as Store from '../../node/Store.js'
import * as Context from '../Context.js'
import * as Profile from '../Profile.js'

export default Cli.command({
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
  options: z.object({
    ...Context.options.shape,
    data: z.string().optional().describe('Request body, or @file to read it from a file'),
    fail: z.boolean().optional().describe('Exits 22 on HTTP 400 or more, as curl does'),
    header: z.array(z.string()).optional().describe('Request header, as `Name: value`. Repeatable'),
    include: z.boolean().optional().describe('Prints the status and the headers before the body'),
    method: z.string().optional().describe('Default: GET, or POST with --data'),
  }),
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
      return data.startsWith('@') ? Fs.readFileSync(data.slice(1)) : data
    })()

    try {
      const client = Profile.resolve({ name, overrides: c.options })
        ? Context.client({ args: { profile: name }, options: c.options }).client
        : await Client.discover({
            clientId: c.options.clientId,
            scope: c.options.scope,
            sources: Source.defaults,
            store: Store.file(),
            url,
          })

      const response = await client.fetch(url, {
        ...(body === undefined ? {} : { body }),
        headers,
        method: c.options.method ?? (body === undefined ? 'GET' : 'POST'),
      })
      const text = await response.text()
      const failed = c.options.fail === true && response.status >= 400

      if (!c.formatExplicit) {
        if (c.options.include) {
          process.stdout.write(`HTTP ${response.status} ${response.statusText}\n`)
          for (const [key, value] of response.headers) process.stdout.write(`${key}: ${value}\n`)
          process.stdout.write('\n')
        }
        process.stdout.write(text)
        if (failed) process.exitCode = 22
        return
      }

      if (failed)
        return c.error({
          code: 'HTTP_ERROR',
          exitCode: 22,
          message: `The request returned HTTP ${response.status}. To resolve: Read \`body\` for the error of the API.`,
        })
      return {
        body: text,
        headers: Object.fromEntries(response.headers),
        status: response.status,
      }
    } catch (error) {
      if (error instanceof Client.DiscoveryError || error instanceof Metadata.ResourceNotFoundError)
        return c.error({
          code: 'NO_PROFILE',
          exitCode: 2,
          message: Errors.inline(error),
        })
      return c.error(Context.error(error))
    }
  },
})
