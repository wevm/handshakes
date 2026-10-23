#!/usr/bin/env node
/** @module Command-line entry: resolves short-lived access tokens for shells, CI, and agents. */
import { Cli } from 'incur'
import authorize from './commands/authorize.js'
import * as Exec from './commands/exec.js'
import profiles from './commands/profiles.js'
import revoke from './commands/revoke.js'
import status from './commands/status.js'
import token from './commands/token.js'

// Incur reads no `--`, so the words after it are the command of `exec`.
const argv = process.argv.slice(2)
const separator = argv.indexOf('--')

const cli = Cli.create('handshakes', {
  description:
    'Resolves short-lived OAuth access tokens from the platform identity or a stored grant, in place of stored API keys.',
  // The CLI runs in CI and on servers, so Incur's background update check stays off.
  update: false,
})
  .command('authorize', authorize)
  .command('exec', Exec.create({ command: separator === -1 ? [] : argv.slice(separator + 1) }))
  .command('login', authorize)
  .command('logout', revoke)
  .command('profiles', profiles)
  .command('revoke', revoke)
  .command('status', status)
  .command('token', token)

await cli.serve(separator === -1 ? argv : argv.slice(0, separator))
