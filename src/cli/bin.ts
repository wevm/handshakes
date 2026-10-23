#!/usr/bin/env node
/** @module Command-line entry: resolves short-lived access tokens for shells, CI, and agents. */
import * as Fs from 'node:fs'
import { Cli } from 'incur'
import authorize from './commands/authorize.js'
import * as Exec from './commands/exec.js'
import * as Fetch from './commands/fetch.js'
import profiles from './commands/profiles.js'
import revoke from './commands/revoke.js'
import status from './commands/status.js'
import token from './commands/token.js'

// Incur reads no `--`, so the words after it are the command of `exec`.
const argv = process.argv.slice(2)
const separator = argv.indexOf('--')

// `src/cli/bin.ts` and `dist/cli/bin.js` both lie two directories below the package root.
const version = (() => {
  try {
    const manifest = JSON.parse(
      Fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
})()

const cli = Cli.create('handshakes', {
  description:
    'Resolves short-lived OAuth access tokens from the platform identity or a stored grant, in place of stored API keys.',
  // An agent receives responses and status, never a token, so only these two commands are tools.
  mcp: { tools: { discovery: 'direct', include: ['fetch', 'status'] } },
  // The CLI runs in CI and on servers, so Incur's background update check stays off.
  update: false,
  version,
})
  .command('authorize', authorize)
  .command('exec', Exec.create({ command: separator === -1 ? [] : argv.slice(separator + 1) }))
  .command('fetch', Fetch.create({ agent: argv.includes('--mcp') }))
  // Help prints the name that was typed, so each alias has a description that names its command.
  .command('login', {
    ...authorize,
    description: 'Runs the device grant (RFC 8628) and stores the grant. Alias of authorize.',
  })
  .command('logout', {
    ...revoke,
    description:
      'Revokes the refresh token (RFC 7009) and deletes the stored grant. Alias of revoke.',
  })
  .command('profiles', profiles)
  .command('revoke', revoke)
  .command('status', status)
  .command('token', token)

await cli.serve(separator === -1 ? argv : argv.slice(0, separator))
