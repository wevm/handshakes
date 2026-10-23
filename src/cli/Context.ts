/** @module Builds the client of a CLI run from a profile and flags, and maps library errors to CLI errors. */
import { z } from 'incur'
import * as Client from '../Client.js'
import * as Exchange from '../Exchange.js'
import * as Errors from '../internal/Errors.js'
import * as NodeSource from '../node/Source.js'
import * as Store from '../node/Store.js'
import type * as Source from '../Source.js'
import * as Profile from './Profile.js'

/** Arguments of the commands that take a profile. */
export const args = z.object({
  profile: z
    .string()
    .optional()
    .describe('Name of the profile. Default: HANDSHAKES_PROFILE, else the default profile'),
})

/**
 * Returns the client and the profile of a CLI run. Grants persist in the file store. For the
 * detected source, a setting of the profile's `sources` replaces the setting of the profile.
 */
export function client(input: { args: z.output<typeof args>; options: z.output<typeof options> }): {
  client: Client.Client
  profile: Profile.Profile
} {
  const profile = Profile.resolve({ name: input.args.profile, overrides: input.options })
  if (!profile) throw new NoProfileError()

  return {
    client: Client.create({
      clientId: profile.clientId,
      clientSecret: clientSecret(input.options),
      endpoints: profile.endpoints,
      interactive: input.options.interactive,
      issuer: profile.issuer,
      parameters: (source) => profile.sources?.[source.name]?.parameters ?? profile.parameters,
      resource: profile.resource,
      scope: profile.scope,
      sources: sources(input.options),
      store: Store.file(),
      subjectAudience: (source) =>
        profile.sources?.[source.name]?.subjectAudience ?? profile.subjectAudience,
    }),
    profile,
  }
}

/** Returns the value of the variable that `clientSecretEnv` names. A secret never comes from argv. */
export function clientSecret(options: {
  clientSecretEnv?: string | undefined
}): string | undefined {
  if (options.clientSecretEnv === undefined) return undefined

  const value = process.env[options.clientSecretEnv]
  if (!value) throw new ClientSecretError({ name: options.clientSecretEnv })
  return value
}

/** Thrown when the variable that `--client-secret-env` names is not set. */
export class ClientSecretError extends Errors.BaseError {
  override name = 'Context.ClientSecretError'

  constructor(options: { name: string }) {
    super(`The variable ${options.name} is not set.`, {
      steps: [
        `Set ${options.name} to the client secret, or pass the variable that holds it to \`--client-secret-env\`.`,
      ],
    })
  }
}

/** Returns the CLI error of a library error: its code, and the exit code of the CLI. */
export function error(cause: unknown): { code: string; exitCode?: number; message: string } {
  if (cause instanceof Client.AuthorizationRequiredError)
    return { code: 'AUTHORIZATION_REQUIRED', exitCode: 3, message: Errors.inline(cause) }
  // A refresh that the server rejects deletes the grant, so it ends in `AuthorizationRequiredError`.
  if (cause instanceof Exchange.RejectedError && cause.error === 'invalid_grant')
    return { code: 'REJECTED', exitCode: 4, message: Errors.inline(cause) }
  if (cause instanceof ClientSecretError)
    return { code: 'NO_CLIENT_SECRET', exitCode: 2, message: Errors.inline(cause) }
  if (cause instanceof NoProfileError || cause instanceof Profile.ConfigError)
    return { code: 'NO_PROFILE', exitCode: 2, message: Errors.inline(cause) }
  if (cause instanceof SourceError)
    return { code: 'INVALID_SOURCE', exitCode: 2, message: Errors.inline(cause) }
  if (cause instanceof Error) return { code: 'FAILED', message: Errors.inline(cause) }
  throw cause
}

/** Thrown when no profile applies and no `--issuer` is set. */
export class NoProfileError extends Errors.BaseError {
  override name = 'Context.NoProfileError'

  constructor() {
    super('No profile applies.', {
      steps: [
        'Name a profile, such as `handshakes token <profile>`. Run `handshakes profiles` to list them.',
        'Or set `default` in handshakes.json, or pass `--issuer`.',
      ],
    })
  }
}

/** Options of the commands that take a profile. Each replaces the setting of the profile. */
export const options = z.object({
  clientId: z.string().optional().describe('OAuth client for the device grant and refresh'),
  clientSecretEnv: z
    .string()
    .optional()
    .describe('Variable that holds the client secret. The CLI reads no secret from argv'),
  interactive: z
    .boolean()
    .optional()
    .describe(
      'Runs the device grant when no grant is stored. Default: when stdin is a TTY and CI is not set. --no-interactive turns it off',
    ),
  issuer: z.string().optional().describe('Authorization server'),
  resource: z.string().optional().describe('RFC 8707 resource'),
  scope: z.string().optional().describe('Space-separated scopes'),
  source: z
    .array(z.string())
    .optional()
    .describe(
      `Uses only this source: ${NodeSource.defaults.map((source) => source.name).join(', ')}. Repeatable`,
    ),
})

/** Thrown when `--source` names no source of the CLI. */
export class SourceError extends Errors.BaseError {
  override name = 'Context.SourceError'

  constructor(options: { name: string }) {
    super(`No source is named ${options.name}.`, {
      steps: [
        `Name one of these sources: ${NodeSource.defaults.map((source) => source.name).join(', ')}.`,
      ],
    })
  }
}

/**
 * Returns the sources of the CLI, or only the sources that `source` names. The priority order of
 * the defaults stays, whatever the order of the names.
 */
export function sources(options: {
  source?: readonly string[] | undefined
}): readonly Source.Source[] {
  const names = options.source
  if (names === undefined) return NodeSource.defaults

  const unknown = names.find((name) => !NodeSource.defaults.some((source) => source.name === name))
  if (unknown !== undefined) throw new SourceError({ name: unknown })
  return NodeSource.defaults.filter((source) => names.includes(source.name))
}
