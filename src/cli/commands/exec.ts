/** @module The `exec` command: runs a command with an access token in an environment variable. */
import * as ChildProcess from 'node:child_process'
import { Cli, z } from 'incur'
import * as Context from '../Context.js'

/**
 * Returns the `exec` command for `command`, the words after `--`. Incur reads no `--`, so the entry
 * splits the arguments before it serves them.
 */
export function create(options: { command: readonly string[] }) {
  return Cli.command({
    args: Context.args,
    description:
      'Runs the command after `--` with an access token in an environment variable, then exits with its code.',
    options: Context.options.extend({
      env: z
        .string()
        .optional()
        .describe('Variable for the token. Default: the env of the profile, else HANDSHAKES_TOKEN'),
    }),
    async run(c) {
      const [program, ...rest] = options.command
      if (!program)
        return c.error({ code: 'NO_COMMAND', exitCode: 2, message: 'Pass the command after `--`.' })

      const result = await (async () => {
        try {
          const resolved = Context.client(c)
          return { resolved, token: await resolved.client.token() }
        } catch (error) {
          return { error: Context.error(error) }
        }
      })()
      if ('error' in result) return c.error(result.error)

      const name = c.options.env ?? result.resolved.profile.env ?? 'HANDSHAKES_TOKEN'
      const status = await new Promise<number>((resolve) => {
        const child = ChildProcess.spawn(program, rest, {
          env: { ...process.env, [name]: result.token.value },
          stdio: 'inherit',
        })
        child.on('error', () => resolve(127))
        child.on('close', (code) => resolve(code ?? 1))
      })

      // The exit code of the child is the exit code of the run.
      process.exitCode = status
      return
    },
  })
}
