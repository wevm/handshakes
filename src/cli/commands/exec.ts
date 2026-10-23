/** @module The `exec` command: runs a command with an access token in an environment variable. */
import * as ChildProcess from 'node:child_process'
import { Cli, z } from 'incur'
import * as Context from '../Context.js'

/** Variables that load code or change how a program runs, such as `NODE_OPTIONS` and `LD_PRELOAD`. */
const reserved =
  /^(BASH_ENV|BROWSER|EDITOR|ENV|HOME|IFS|NODE_OPTIONS|PAGER|PATH|PERL5OPT|PYTHONPATH|PYTHONSTARTUP|RUBYOPT|SHELL|VISUAL|(DYLD|LD|NODE|NPM_CONFIG|GIT)_.*|.*_PROXY)$/

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
        return c.error({
          code: 'NO_COMMAND',
          exitCode: 2,
          message:
            'No command follows `--`. To resolve: Write the command after `--`, such as `handshakes exec -- pnpm test`.',
        })

      const resolved = (() => {
        try {
          return Context.client(c)
        } catch (error) {
          return { error: Context.error(error) }
        }
      })()
      if ('error' in resolved) return c.error(resolved.error)

      // A project file can set `env`, so it must not name a variable that changes how the child runs.
      const name = c.options.env ?? resolved.profile.env ?? 'HANDSHAKES_TOKEN'
      if (!/^[A-Z][A-Z0-9_]*$/.test(name) || reserved.test(name))
        return c.error({
          code: 'INVALID_ENV',
          exitCode: 2,
          message: `The variable ${name} cannot hold the token. To resolve: Name a variable for the token alone, such as API_TOKEN.`,
        })

      const token = await resolved.client.token().catch((error: unknown) => ({
        error: Context.error(error),
      }))
      if ('error' in token) return c.error(token.error)

      const status = await new Promise<number>((resolve) => {
        const child = ChildProcess.spawn(program, rest, {
          env: { ...process.env, [name]: token.value },
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
