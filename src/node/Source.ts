/**
 * @module Sources that use the file system or child processes: a projected token file, such as a
 * Kubernetes service account token, and the Buildkite agent.
 */
import * as ChildProcess from 'node:child_process'
import * as Fs from 'node:fs'
import * as Source from '../Source.js'

/**
 * Buildkite. Runs `buildkite-agent oidc request-token --audience`, which returns a token for any
 * audience. The agent reads its job token from the environment.
 */
export function buildkite(): Source.Source {
  const name = 'buildkite'

  return {
    detect: (env) => env['BUILDKITE'] === 'true',
    name,
    token(context) {
      return new Promise((resolve, reject) => {
        ChildProcess.execFile(
          'buildkite-agent',
          ['oidc', 'request-token', '--audience', context.audience],
          { env: { ...context.env }, timeout: 30_000 },
          (error, stdout) => {
            if (!error) return resolve(stdout.trim())
            reject(
              new Source.RequestError({
                cause: error,
                hint:
                  (error as NodeJS.ErrnoException).code === 'ENOENT'
                    ? 'Run the job on a Buildkite agent, which provides `buildkite-agent`.'
                    : 'Check that the agent version supports `oidc request-token`.',
                message: 'buildkite-agent did not return an OIDC token.',
                source: name,
              }),
            )
          },
        )
      })
    },
  }
}

/** The sources of the core entry and `buildkite`, in priority order. The first detected source wins. */
export const defaults: readonly Source.Source[] = [
  ...Source.defaults.filter((source) => source.name !== 'gcp'),
  buildkite(),
  // `gcp` stays last, as in the core defaults.
  ...Source.defaults.filter((source) => source.name === 'gcp'),
]

/**
 * Reads a token from a file, such as a Kubernetes projected service account token. The audience is
 * fixed where the file is projected, so the token must already carry the requested audience.
 */
export function file(options: file.Options): Source.Source {
  return {
    detect: () => Fs.existsSync(options.path),
    name: options.name ?? 'file',
    async token() {
      return (await Fs.promises.readFile(options.path, 'utf8')).trim()
    },
  }
}

export declare namespace file {
  type Options = {
    /** Name in `Token.source` and errors. Default: `file`. */
    name?: string | undefined
    /** Path of the token file. */
    path: string
  }
}
