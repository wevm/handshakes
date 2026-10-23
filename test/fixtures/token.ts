/** @module Prints the access token of a client that shares a file store, for tests across processes. */
import { Client } from 'handshakes'
import { Store } from 'handshakes/node'

const client = Client.create({
  clientId: process.env['HANDSHAKES_CLIENT_ID'],
  interactive: false,
  issuer: process.env['HANDSHAKES_ISSUER'],
  store: Store.file({ directory: process.env['HANDSHAKES_DIRECTORY'] }),
})

process.stdout.write((await client.token()).value)
