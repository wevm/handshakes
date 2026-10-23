/** @module Builds the client of a CLI run from a profile and flags, and maps library errors to CLI errors. */
import { z } from 'incur'
import * as Client from '../Client.js'
import * as Errors from '../internal/Errors.js'
import * as Source from '../node/Source.js'
import * as Store from '../node/Store.js'
import * as Profile from './Profile.js'

/** Arguments of the commands that take a profile. */
export const args = z.object({
  profile: z
    .string()
    .optional()
    .describe('Name of the profile. Default: HANDSHAKES_PROFILE, else the default profile'),
})

/** Options of the commands that take a profile. Each replaces the setting of the profile. */
export const options = z.object({
  clientId: z.string().optional().describe('OAuth client for the device grant and refresh'),
  issuer: z.string().optional().describe('Authorization server'),
  resource: z.string().optional().describe('RFC 8707 resource'),
  scope: z.string().optional().describe('Space-separated scopes'),
})

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

/** Returns the client and the profile of a CLI run. Grants persist in the file store. */
export function client(input: { args: z.output<typeof args>; options: z.output<typeof options> }): {
  client: Client.Client
  profile: Profile.Profile
} {
  const profile = Profile.resolve({ name: input.args.profile, overrides: input.options })
  if (!profile) throw new NoProfileError()

  return {
    client: Client.create({
      clientId: profile.clientId,
      endpoints: profile.endpoints,
      issuer: profile.issuer,
      resource: profile.resource,
      scope: profile.scope,
      sources: Source.defaults,
      store: Store.file(),
    }),
    profile,
  }
}

/** Returns the CLI error of a library error: its code, and the exit code from the plan. */
export function error(cause: unknown): { code: string; exitCode?: number; message: string } {
  if (cause instanceof Client.AuthorizationRequiredError)
    return { code: 'AUTHORIZATION_REQUIRED', exitCode: 3, message: Errors.inline(cause) }
  if (cause instanceof Client.RejectedError && cause.error === 'invalid_grant')
    return { code: 'REJECTED', exitCode: 4, message: Errors.inline(cause) }
  if (cause instanceof NoProfileError || cause instanceof Profile.ConfigError)
    return { code: 'NO_PROFILE', exitCode: 2, message: Errors.inline(cause) }
  if (cause instanceof Error) return { code: 'FAILED', message: Errors.inline(cause) }
  throw cause
}
