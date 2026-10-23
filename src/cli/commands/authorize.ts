/** @module The `authorize` command: runs the device grant and stores the grant. */
import { Cli, z } from 'incur'
import * as Context from '../Context.js'

export default Cli.command({
  args: z.object({ ...Context.args.shape }),
  description: 'Runs the device grant (RFC 8628) and stores the grant.',
  // The command always runs the device grant, so `interactive` and `source` do not apply.
  options: Context.options.omit({ interactive: true, source: true }),
  async run(c) {
    try {
      const grant = await Context.client(c).client.authorize()
      return {
        expiresAt: grant.expiresAt,
        refreshable: grant.refreshToken !== undefined,
        scope: grant.scope ?? null,
      }
    } catch (error) {
      return c.error(Context.error(error))
    }
  },
})
