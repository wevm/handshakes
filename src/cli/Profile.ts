/**
 * @module Profiles of the CLI: named client settings, read from `handshakes.json` in the nearest
 * ancestor directory, then from the user configuration.
 */
import * as Fs from 'node:fs'
import * as Os from 'node:os'
import * as Path from 'node:path'
import { z } from 'incur'
import type * as Client from '../Client.js'

/** Schemas of the configuration file. */
namespace schema {
  export const profile = z.object({
    clientId: z.string().optional(),
    endpoints: z
      .object({
        deviceAuthorization: z.string().optional(),
        revocation: z.string().optional(),
        token: z.string(),
      })
      .optional(),
    env: z.string().optional(),
    issuer: z.string().optional(),
    resource: z.string().optional(),
    scope: z.string().optional(),
  })

  export const file = z.object({
    default: z.string().optional(),
    profiles: z.record(z.string(), profile).optional(),
  })

  export type Profile = z.output<typeof profile>
}

/** Thrown when a profile does not exist, or a configuration file is invalid. */
export class ConfigError extends Error {
  override name = 'Profile.ConfigError'
}

/** Settings of one profile, and the file that defines it. */
export type Profile = schema.Profile & {
  /** The file that defines the profile. Absent for settings from flags only. */
  file?: string | undefined
  /** Name of the profile. */
  name?: string | undefined
}

/** Returns every profile, with the file of each. A project profile replaces a user profile of the same name. */
export function list(options: list.Options = {}): {
  default: string | undefined
  profiles: Profile[]
} {
  const files = paths(options).filter((path) => Fs.existsSync(path))
  const profiles = new Map<string, Profile>()
  let fallback: string | undefined

  // User configuration first, so the project file replaces its profiles.
  for (const file of [...files].reverse()) {
    const parsed = schema.file.safeParse(JSON.parse(Fs.readFileSync(file, 'utf8')))
    if (!parsed.success) throw new ConfigError(`${file} is not a valid configuration file.`)

    fallback = parsed.data.default ?? fallback
    for (const [name, profile] of Object.entries(parsed.data.profiles ?? {}))
      profiles.set(name, { ...profile, file, name })
  }

  return { default: fallback, profiles: [...profiles.values()] }
}

export declare namespace list {
  type Options = {
    /** Directory to search from. Default: the working directory. */
    cwd?: string | undefined
    /** Default: `process.env`. */
    env?: Readonly<Record<string, string | undefined>> | undefined
  }
}

/**
 * Returns the profile of `name`, else of `HANDSHAKES_PROFILE`, else the default profile, with
 * `overrides` applied. Returns `undefined` when no profile and no `issuer` apply.
 */
export function resolve(options: resolve.Options): Profile | undefined {
  const env = options.env ?? process.env
  const all = list(options)
  const name = options.name ?? env['HANDSHAKES_PROFILE'] ?? all.default
  const profile = name ? all.profiles.find((entry) => entry.name === name) : undefined
  if (name && !profile && options.name) throw new ConfigError(`No profile is named ${name}.`)

  const merged = {
    ...profile,
    ...Object.fromEntries(
      Object.entries(options.overrides ?? {}).filter((entry) => entry[1] !== undefined),
    ),
  } as Profile
  if (!merged.issuer && !merged.endpoints) return undefined
  return merged
}

export declare namespace resolve {
  type Options = list.Options & {
    /** Name of the profile. */
    name?: string | undefined
    /** Settings from flags, which replace the settings of the profile. */
    overrides?:
      | Partial<Pick<Client.create.Options, 'clientId' | 'issuer' | 'resource' | 'scope'>>
      | undefined
  }
}

/** Returns the configuration files, project first: `HANDSHAKES_CONFIG`, else the nearest `handshakes.json` and the user file. */
function paths(options: list.Options): string[] {
  const env = options.env ?? process.env
  if (env['HANDSHAKES_CONFIG']) return [env['HANDSHAKES_CONFIG']]

  const files: string[] = []
  let directory = options.cwd ?? process.cwd()
  while (true) {
    const file = Path.join(directory, 'handshakes.json')
    if (Fs.existsSync(file)) {
      files.push(file)
      break
    }
    const parent = Path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }

  files.push(
    Path.join(
      env['XDG_CONFIG_HOME'] ?? Path.join(Os.homedir(), '.config'),
      'handshakes',
      'config.json',
    ),
  )
  return files
}
