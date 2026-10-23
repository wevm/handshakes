/** @module Verifies access tokens of the local Better Auth server and subject tokens of the local issuer at an API. */
import { Client } from 'handshakes'
import { Policy, Resource } from 'handshakes/server'
import { Issuer } from 'handshakes/test'
import * as Server from '../../test/Server.js'

/** The resource identifier of the API. Tokens name it as `aud`. */
const api = 'https://api.example.com'

describe('create', () => {
  let issuer: Issuer.Issuer
  let other: Issuer.Issuer
  let resource: Resource.Resource
  let server: Server.create.ReturnType

  beforeAll(async () => {
    issuer = await Issuer.create()
    other = await Issuer.create()
    server = await Server.create({ resources: [api] })
    await server.trust(
      Policy.githubActions({
        audience: server.url,
        issuer: issuer.url,
        repositoryId: '812345',
        resources: [api],
        scopes: ['data:read'],
      }),
    )
    resource = Resource.create({
      authorizationServers: [server.url, other.url],
      policies: [
        Policy.vercel({
          audience: api,
          issuer: issuer.url,
          ownerId: 'team_acme',
          projectId: 'prj_app',
          scopes: ['data:read'],
        }),
      ],
      resource: api,
      scopes: ['data:read'],
    })
  })

  afterAll(async () => {
    await Promise.all([issuer.close(), other.close(), server.close()])
  })

  /** Returns a request to the API with `token` as its bearer token. */
  function request(token?: string) {
    return new Request(`${api}/v1/items`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  }

  test('serves the protected resource metadata', async () => {
    const metadata = (await resource.metadata().json()) as Record<string, unknown>

    expect(resource.metadataUrl).toMatchInlineSnapshot(
      `"https://api.example.com/.well-known/oauth-protected-resource"`,
    )
    expect(metadata['resource']).toMatchInlineSnapshot(`"https://api.example.com"`)
    expect(metadata['scopes_supported']).toMatchInlineSnapshot(`
      [
        "data:read",
      ]
    `)
  })

  test('accepts an access token of the authorization server for the resource', async () => {
    const client = Client.create({
      env: await issuer.env({ preset: 'githubActions' }),
      issuer: server.url,
      resource: api,
    })
    const token = await client.token()

    const result = await resource.verify(request(token.value))

    if (result.status !== 'valid') throw new Error(`Expected a principal, not ${result.error}.`)
    expect(result.principal.scopes).toMatchInlineSnapshot(`
      [
        "data:read",
      ]
    `)
    expect(result.principal.policy).toMatchInlineSnapshot(`undefined`)
  })

  test('accepts a subject token that a policy matches, without an exchange', async () => {
    const token = await issuer.sign({ audience: api, preset: 'vercel' })

    const result = await resource.verify(request(token))

    if (result.status !== 'valid') throw new Error(`Expected a principal, not ${result.error}.`)
    expect(result.principal.subject).toMatchInlineSnapshot(
      `"owner:acme:project:app:environment:production"`,
    )
    expect(result.principal.policy?.id).toMatchInlineSnapshot(`"vercel:prj_app:*"`)
  })

  test('refuses an ID token of an authorization server', async () => {
    const token = await other.sign({ audience: api, preset: 'githubActions' })

    const result = await resource.verify(request(token))

    expect(result).toMatchInlineSnapshot(`
      {
        "error": "invalid_token",
        "status": "invalid",
      }
    `)
  })

  test('refuses a subject token for another audience', async () => {
    const token = await issuer.sign({ audience: 'https://other.example.com', preset: 'vercel' })

    const result = await resource.verify(request(token))

    expect(result).toMatchInlineSnapshot(`
      {
        "error": "invalid_token",
        "status": "invalid",
      }
    `)
  })

  test('refuses a token without the required scope', async () => {
    const strict = Resource.create({
      policies: [
        Policy.vercel({
          audience: api,
          issuer: issuer.url,
          ownerId: 'team_acme',
          projectId: 'prj_app',
          scopes: ['data:read'],
        }),
      ],
      resource: api,
      scopes: ['data:write'],
    })
    const token = await issuer.sign({ audience: api, preset: 'vercel' })

    const result = await strict.verify(request(token))
    if (result.status === 'valid') throw new Error('Expected a refusal.')

    expect(result).toMatchInlineSnapshot(`
      {
        "error": "insufficient_scope",
        "status": "invalid",
      }
    `)
    expect(strict.challenge(result).status).toMatchInlineSnapshot(`403`)
    expect(strict.challenge(result).headers.get('www-authenticate')).toMatchInlineSnapshot(
      `"Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource", error="insufficient_scope", scope="data:write""`,
    )
  })

  test('challenges a request without a token, without an error code', async () => {
    const result = await resource.verify(request())
    if (result.status === 'valid') throw new Error('Expected a refusal.')

    const response = resource.challenge(result)

    expect(response.status).toMatchInlineSnapshot(`401`)
    expect(response.headers.get('www-authenticate')).toMatchInlineSnapshot(
      `"Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource", scope="data:read""`,
    )
  })

  test('rejects a policy for another audience', () => {
    expect(() =>
      Resource.create({
        policies: [
          Policy.vercel({
            audience: 'https://other.example.com',
            issuer: 'https://oidc.vercel.com/acme',
            ownerId: 'team_acme',
            projectId: 'prj_app',
            scopes: [],
          }),
        ],
        resource: api,
      }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[TypeError: The audience of policy vercel:prj_app:* must be https://api.example.com. Set the audience of the policy to the resource, or create one \`Resource\` for each audience.]`,
    )
  })
})
