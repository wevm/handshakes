/** @module The `token` command: prints a subject token. */
import { Cli, z } from 'incur'
import * as Identity from '../../Identity.js'
import * as Source from '../../Source.js'

export default Cli.command({
  description:
    'Prints the OIDC token that the platform signs for this code, with the requested audience.',
  options: z.object({
    audience: z.string().describe('`aud` of the token'),
  }),
  async run(c) {
    // `c.error` returns the error result, so each failure returns it from `run` directly.
    try {
      const token = await Identity.token({ audience: c.options.audience })

      // Plain output is the JWT alone, so `$(handshakes token …)` reads it directly.
      if (!c.formatExplicit) {
        process.stdout.write(`${token.value}\n`)
        return
      }
      return { expiresAt: token.expiresAt, source: token.source, value: token.value }
    } catch (error) {
      if (error instanceof Identity.NotFoundError)
        return c.error({ code: 'SOURCE_NOT_FOUND', exitCode: 3, message: error.message })
      if (error instanceof Identity.AudienceError)
        return c.error({ code: 'AUDIENCE_MISMATCH', message: error.message })
      if (error instanceof Source.RequestError)
        return c.error({ code: 'SOURCE_FAILED', message: error.message })
      throw error
    }
  },
})
