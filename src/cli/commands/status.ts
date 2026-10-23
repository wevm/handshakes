/** @module The `status` command: names the method that applies here. Never prints a token. */
import { Cli, z } from 'incur'
import * as Identity from '../../Identity.js'
import * as Source from '../../node/Source.js'
import * as Context from '../Context.js'
import * as Profile from '../Profile.js'

export default Cli.command({
  args: z.object({ ...Context.args.shape }),
  description:
    'Names the source that detects its platform here and, for a profile, the stored grant and its expiry.',
  options: z.object({ ...Context.options.shape }),
  async run(c) {
    try {
      const source = {
        checked: Source.defaults.map((entry) => entry.name),
        source: Identity.detect({ sources: Source.defaults })?.name ?? null,
      }
      if (!Profile.resolve({ name: c.args.profile, overrides: c.options })) return source

      const resolved = Context.client(c)
      return {
        ...source,
        grant: await resolved.client.status(),
        issuer: resolved.profile.issuer ?? resolved.profile.endpoints?.token,
        profile: resolved.profile.name ?? null,
      }
    } catch (error) {
      return c.error(Context.error(error))
    }
  },
})
