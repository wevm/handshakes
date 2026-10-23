/** @module The `revoke` command: revokes the refresh token and deletes the grant. */
import { Cli, z } from 'incur'
import * as Context from '../Context.js'

export default Cli.command({
  args: z.object({ ...Context.args.shape }),
  description: 'Revokes the refresh token (RFC 7009) and deletes the stored grant.',
  // The command requests no access token, so `interactive` and `source` do not apply.
  options: Context.options.omit({ interactive: true, source: true }),
  async run(c) {
    try {
      await Context.client(c).client.revoke()
      return { revoked: true }
    } catch (error) {
      return c.error(Context.error(error))
    }
  },
})
