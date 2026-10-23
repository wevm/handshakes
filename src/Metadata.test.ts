/** @module Reads the RFC 9728 metadata and the challenge of a local API that uses `Resource`. */
import { Metadata } from 'handshakes'
import { Resource } from 'handshakes/server'
import * as Http from '../test/Http.js'

let api: Awaited<ReturnType<typeof Http.serve>>

beforeAll(async () => {
  api = await Http.serve((url) => {
    const resource = Resource.create({
      authorizationServers: ['https://auth.example.com'],
      resource: `${url}/v1`,
      scopes: ['data:read'],
    })
    return async (request) => {
      if (new URL(request.url).href === resource.metadataUrl) return resource.metadata()

      const result = await resource.verify(request)
      return result.status === 'valid' ? new Response('ok') : resource.challenge(result)
    }
  })
})

afterAll(async () => {
  await api.close()
})

describe('protectedResource', () => {
  test('reads the metadata at the well-known path of the resource', async () => {
    const metadata = await Metadata.protectedResource({ resource: `${api.url}/v1` })

    expect(metadata.authorizationServers).toMatchInlineSnapshot(`
      [
        "https://auth.example.com",
      ]
    `)
    expect(metadata.scopesSupported).toMatchInlineSnapshot(`
      [
        "data:read",
      ]
    `)
  })

  test('reads the metadata at the URL of the challenge', async () => {
    const response = await fetch(`${api.url}/v1/items`)
    const url = Metadata.challenge(response)?.resourceMetadata

    const metadata = await Metadata.protectedResource({ resource: `${api.url}/v1`, url })

    expect(metadata.resource === `${api.url}/v1`).toMatchInlineSnapshot(`true`)
  })

  test('throws when the metadata names another resource', async () => {
    await expect(
      Metadata.protectedResource({
        resource: `${api.url}/v2`,
        url: `${api.url}/.well-known/oauth-protected-resource/v1`,
      }),
    ).rejects.toThrow(Metadata.ResourceNotFoundError)
  })
})

describe('challenge', () => {
  test('parses the challenge of a request without a token', async () => {
    const response = await fetch(`${api.url}/v1/items`)

    const challenge = Metadata.challenge(response)

    expect(challenge?.error).toMatchInlineSnapshot(`undefined`)
    expect(challenge?.scope).toMatchInlineSnapshot(`"data:read"`)
    expect(challenge?.resourceMetadata?.replace(api.url, '<api>')).toMatchInlineSnapshot(
      `"<api>/.well-known/oauth-protected-resource/v1"`,
    )
  })

  test('parses the error of a request with an invalid token', async () => {
    const response = await fetch(`${api.url}/v1/items`, {
      headers: { authorization: 'Bearer x.y' },
    })

    expect(Metadata.challenge(response)?.error).toMatchInlineSnapshot(`"invalid_token"`)
  })

  test('returns undefined for a response without a challenge', async () => {
    const response = await fetch(`${api.url}/.well-known/oauth-protected-resource/v1`)

    expect(Metadata.challenge(response)).toMatchInlineSnapshot(`undefined`)
  })
})
