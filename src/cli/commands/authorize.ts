/** @module The `authorize` command: runs the device grant and stores the grant. */
import { Cli, z } from 'incur'
import * as Context from '../Context.js'

export default Cli.command({
  args: z.object({ ...Context.args.shape }),
  description: 'Runs the device grant (RFC 8628) and stores the grant. Alias: login.',
  options: z.object({ ...Context.options.shape }),
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
