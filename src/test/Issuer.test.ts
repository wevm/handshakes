/** @module Verifies the tokens of the local issuer against its published keys. */
import * as Crypto from 'node:crypto'
import { Issuer } from 'handshakes/test'

describe('create', () => {
  let issuer: Issuer.Issuer

  beforeAll(async () => {
    issuer = await Issuer.create()
  })

  afterAll(async () => {
    await issuer.close()
  })

  test('signs tokens that verify against the keys in its discovery document', async () => {
    const token = await issuer.sign({ audience: 'https://api.example.com', preset: 'vercel' })

    const configuration = (await (
      await fetch(`${issuer.url}/.well-known/openid-configuration`)
    ).json()) as { issuer: string; jwks_uri: string }
    const jwks = (await (await fetch(configuration.jwks_uri)).json()) as {
      keys: Crypto.JsonWebKey[]
    }
    const [header, payload, signature] = token.split('.') as [string, string, string]

    const valid = Crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${header}.${payload}`),
      Crypto.createPublicKey({ format: 'jwk', key: jwks.keys[0]! }),
      Buffer.from(signature, 'base64url'),
    )

    expect(configuration.issuer === issuer.url).toMatchInlineSnapshot(`true`)
    expect(valid).toMatchInlineSnapshot(`true`)
  })
})
