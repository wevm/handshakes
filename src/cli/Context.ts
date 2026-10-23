/** @module Builds the client of a CLI run from a profile and flags, and maps library errors to CLI errors. */
import { z } from 'incur'
import * as Client from '../Client.js'
import * as NodeStore from '../node/NodeStore.js'
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
export class NoProfileError extends Error {
  override name = 'Context.NoProfileError'

  constructor() {
    super('No profile applies. Name a profile, set a default profile, or pass --issuer.')
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
      store: NodeStore.file(),
    }),
    profile,
  }
}

/** Returns the CLI error of a library error: its code, and the exit code from the plan. */
export function error(cause: unknown): { code: string; exitCode?: number; message: string } {
  if (cause instanceof Client.AuthorizationRequiredError)
    return { code: 'AUTHORIZATION_REQUIRED', exitCode: 3, message: cause.message }
  if (cause instanceof Client.RejectedError && cause.error === 'invalid_grant')
    return { code: 'REJECTED', exitCode: 4, message: cause.message }
  if (cause instanceof NoProfileError || cause instanceof Profile.ConfigError)
    return { code: 'NO_PROFILE', exitCode: 2, message: cause.message }
  if (cause instanceof Error) return { code: 'FAILED', message: cause.message }
  throw cause
}
