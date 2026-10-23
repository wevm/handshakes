/** @module The `status` command: names the source that applies here. Never prints a token. */
import { Cli } from 'incur'
import * as Identity from '../../Identity.js'
import * as Source from '../../Source.js'

export default Cli.command({
  description:
    'Names the source that detects its platform here, and the sources that were checked.',
  run() {
    return {
      checked: Source.defaults.map((source) => source.name),
      source: Identity.detect()?.name ?? null,
    }
  },
})
