/** @module The `token` command: prints an access token, or with `--audience`, a subject token. */
import { Cli, z } from 'incur'
import * as Identity from '../../Identity.js'
import * as Source from '../../Source.js'
import * as Context from '../Context.js'

export default Cli.command({
  args: Context.args,
  description:
    'Prints the access token of a profile. With --audience, prints the OIDC token that the platform signs for this code.',
  options: Context.options.extend({
    audience: z.string().optional().describe('`aud` of a subject token. Prints the subject token'),
  }),
  async run(c) {
    try {
      const token = c.options.audience
        ? await Identity.token({ audience: c.options.audience })
        : { ...(await Context.client(c).client.token()), source: undefined }

      // Plain output is the token alone, so `$(handshakes token …)` reads it directly.
      if (!c.formatExplicit) {
        process.stdout.write(`${token.value}\n`)
        return
      }
      return { expiresAt: token.expiresAt, source: token.source ?? null, value: token.value }
    } catch (error) {
      if (error instanceof Identity.NotFoundError)
        return c.error({ code: 'SOURCE_NOT_FOUND', exitCode: 3, message: error.message })
      if (error instanceof Identity.AudienceError)
        return c.error({ code: 'AUDIENCE_MISMATCH', message: error.message })
      if (error instanceof Source.RequestError)
        return c.error({ code: 'SOURCE_FAILED', message: error.message })
      return c.error(Context.error(error))
    }
  },
})
