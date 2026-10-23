/** @module Stores grants in files, and serializes refreshes across real processes. */
import * as ChildProcess from 'node:child_process'
import * as Fs from 'node:fs'
import * as Os from 'node:os'
import * as Path from 'node:path'
import * as Esbuild from 'esbuild'
import { Client } from 'handshakes'
import { NodeStore } from 'handshakes/node'
import * as Server from '../../test/Server.js'

describe('file', () => {
  let directory: string
  let server: Server.create.ReturnType

  beforeAll(async () => {
    directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'handshakes-'))
    server = await Server.create()
  })

  afterAll(async () => {
    Fs.rmSync(directory, { force: true, recursive: true })
    await server.close()
  })

  test('writes each grant to a file that only the user can read', async () => {
    const store = NodeStore.file({ directory: Path.join(directory, 'mode') })
    const grant = {
      accessToken: 'access',
      clientId: 'client',
      expiresAt: 2_000_000_000_000,
      issuedAt: 1_000_000_000_000,
      issuer: 'https://auth.example.com',
    }

    await store.set('key', grant)

    const files = Fs.readdirSync(Path.join(directory, 'mode'))
    expect(files.length).toMatchInlineSnapshot(`1`)
    expect(
      (Fs.statSync(Path.join(directory, 'mode', files[0]!)).mode & 0o777).toString(8),
    ).toMatchInlineSnapshot(`"600"`)
    expect(await store.get('key')).toEqual(grant)

    await store.delete('key')

    expect(await store.get('key')).toMatchInlineSnapshot(`undefined`)
  })

  test('refreshes an expiring grant once when several processes request a token', async () => {
    const grants = Path.join(directory, 'race')
    const store = NodeStore.file({ directory: grants })
    const key = `${server.url} ${server.clientId}`
    const approvals: Promise<void>[] = []
    const grant = await Client.create({
      clientId: server.clientId,
      issuer: server.url,
      onDeviceCode: (code) => approvals.push(server.approve(code.userCode)),
      scope: 'openid email offline_access',
      store,
    }).authorize()
    await store.set(key, { ...grant, expiresAt: Date.now() })

    // Node cannot resolve the source's `.js` specifiers to `.ts`, so the fixture runs as a bundle.
    const bin = Path.join(directory, 'token.mjs')
    await Esbuild.build({
      alias: {
        handshakes: Path.resolve(import.meta.dirname, '../index.ts'),
        'handshakes/node': Path.resolve(import.meta.dirname, 'index.ts'),
      },
      bundle: true,
      entryPoints: [Path.resolve(import.meta.dirname, '../../test/fixtures/token.ts')],
      format: 'esm',
      outfile: bin,
      platform: 'node',
    })

    const tokens = await Promise.all(
      Array.from(
        { length: 10 },
        () =>
          new Promise<string>((resolve, reject) => {
            const child = ChildProcess.spawn(process.execPath, [bin], {
              env: {
                HANDSHAKES_CLIENT_ID: server.clientId,
                HANDSHAKES_DIRECTORY: grants,
                HANDSHAKES_ISSUER: server.url,
                PATH: process.env['PATH'] ?? '',
              },
            })
            let stdout = ''
            let stderr = ''
            child.stdout.on('data', (chunk: Buffer) => (stdout += chunk))
            child.stderr.on('data', (chunk: Buffer) => (stderr += chunk))
            child.on('close', (status) =>
              status === 0 ? resolve(stdout) : reject(new Error(stderr)),
            )
          }),
      ),
    )

    const refreshed = await store.get(key)
    expect(new Set(tokens).size).toMatchInlineSnapshot(`1`)
    expect(tokens[0]).toBe(refreshed?.accessToken)
    expect(refreshed?.refreshToken).not.toBe(grant.refreshToken)

    // A second refresh succeeds, so the server revoked nothing.
    await store.set(key, { ...refreshed!, expiresAt: Date.now() })
    const again = await Client.create({
      clientId: server.clientId,
      interactive: false,
      issuer: server.url,
      store,
    }).token()
    expect(again.value).not.toBe(refreshed?.accessToken)
  })
})
