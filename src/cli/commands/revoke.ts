/** @module The `revoke` command: revokes the refresh token and deletes the grant. */
import { Cli, z } from 'incur'
import * as Context from '../Context.js'

export default Cli.command({
  args: z.object({ ...Context.args.shape }),
  description: 'Revokes the refresh token (RFC 7009) and deletes the stored grant. Alias: logout.',
  options: z.object({ ...Context.options.shape }),
  async run(c) {
    try {
      await Context.client(c).client.revoke()
      return { revoked: true }
    } catch (error) {
      return c.error(Context.error(error))
    }
  },
})
