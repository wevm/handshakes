/** @module The `profiles` command: lists the profiles and the file of each. */
import { Cli } from 'incur'
import * as Context from '../Context.js'
import * as Profile from '../Profile.js'

export default Cli.command({
  description: 'Lists the profiles, the file of each, and the default profile.',
  run(c) {
    try {
      const all = Profile.list()
      return {
        default: all.default ?? null,
        profiles: all.profiles.map((profile) => ({
          file: profile.file,
          issuer: profile.issuer ?? profile.endpoints?.token,
          name: profile.name,
        })),
      }
    } catch (error) {
      return c.error(Context.error(error))
    }
  },
})
