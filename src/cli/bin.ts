#!/usr/bin/env node
/** @module Command-line entry: resolves short-lived access tokens for shells, CI, and agents. */
import { Cli } from 'incur'

const cli = Cli.create('handshakes', {
  description:
    'Resolves short-lived OAuth access tokens from the platform identity or a stored grant, in place of stored API keys.',
  // The CLI runs in CI and on servers, so Incur's background update check stays off.
  update: false,
})

await cli.serve()
