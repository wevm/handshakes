/** @module Exchanges the subject token of each platform at a `Server` with the policy preset of that platform. */
import { Policy, Server } from 'handshakes/server'
import { Issuer } from 'handshakes/test'
import * as Http from '../../test/Http.js'

let issued: Server.IssueContext[]
let issuer: Issuer.Issuer
let server: Awaited<ReturnType<typeof Http.serve>>

beforeAll(async () => {
  issued = []
  issuer = await Issuer.create()
  server = await Http.serve(
    (url) =>
      Server.create({
        issue: async (context) => {
          issued.push(context)
          return { accessToken: `key_${issued.length}`, expiresAt: context.expiresAt }
        },
        issuer: url,
        policies: [
          Policy.azure({
            audience: url,
            issuer: issuer.url,
            objectId: '9a8b7c6d-0000-4000-8000-000000000000',
            scopes: ['data:read'],
            tenantId: '72f988bf-0000-4000-8000-000000000000',
          }),
          Policy.circleci({
            issuer: issuer.url,
            organizationId: 'b6a6b6f0-0000-4000-8000-000000000000',
            projectId: 'c1d2e3f4-0000-4000-8000-000000000000',
            ref: 'refs/heads/main',
            scopes: ['data:read'],
          }),
          Policy.gcp({
            audience: url,
            issuer: issuer.url,
            scopes: ['data:read'],
            serviceAccountId: '104857600000000000000',
          }),
          Policy.githubActions({
            audience: url,
            issuer: issuer.url,
            maxAge: 600,
            repositoryId: '812345',
            scopes: ['data:read'],
          }),
          Policy.gitlab({
            audience: url,
            issuer: issuer.url,
            projectId: '812345',
            ref: 'main',
            refType: 'branch',
            scopes: ['data:read'],
          }),
          Policy.kubernetes({
            audience: url,
            issuer: issuer.url,
            namespace: 'default',
            scopes: ['data:read'],
            serviceAccount: 'app',
          }),
        ],
      }).fetch,
  )
})

afterAll(async () => {
  await Promise.all([issuer.close(), server.close()])
})

/** Exchanges `subjectToken`, and returns the status and the ID of the matched policy. */
async function exchange(subjectToken: string) {
  const count = issued.length
  const response = await fetch(`${server.url}/oauth2/token`, {
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: subjectToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    }),
    method: 'POST',
  })
  await response.body?.cancel()
  return {
    policy: issued.length > count ? issued.at(-1)?.policy.id : undefined,
    status: response.status,
  }
}

describe('azure', () => {
  test('exchanges a token of the managed identity', async () => {
    const result = await exchange(await issuer.sign({ audience: server.url, preset: 'azure' }))

    expect(result).toMatchInlineSnapshot(`
      {
        "policy": "azure:72f988bf-0000-4000-8000-000000000000:9a8b7c6d-0000-4000-8000-000000000000",
        "status": 200,
      }
    `)
  })

  test('refuses a token of another tenant', async () => {
    const result = await exchange(
      await issuer.sign({
        audience: server.url,
        claims: { tid: '00000000-0000-4000-8000-000000000000' },
        preset: 'azure',
      }),
    )

    expect(result).toMatchInlineSnapshot(`
      {
        "policy": undefined,
        "status": 400,
      }
    `)
  })
})

describe('circleci', () => {
  test('exchanges a token whose audience is the organization', async () => {
    const result = await exchange(
      await issuer.sign({ audience: 'b6a6b6f0-0000-4000-8000-000000000000', preset: 'circleci' }),
    )

    expect(result).toMatchInlineSnapshot(`
      {
        "policy": "circleci:c1d2e3f4-0000-4000-8000-000000000000:refs/heads/main",
        "status": 200,
      }
    `)
  })

  test('refuses a token of another ref', async () => {
    const result = await exchange(
      await issuer.sign({
        audience: 'b6a6b6f0-0000-4000-8000-000000000000',
        claims: { 'oidc.circleci.com/vcs-ref': 'refs/heads/feature' },
        preset: 'circleci',
      }),
    )

    expect(result).toMatchInlineSnapshot(`
      {
        "policy": undefined,
        "status": 400,
      }
    `)
  })
})

describe('gcp', () => {
  test('exchanges a token of the service account', async () => {
    const result = await exchange(await issuer.sign({ audience: server.url, preset: 'gcp' }))

    expect(result).toMatchInlineSnapshot(`
      {
        "policy": "gcp:104857600000000000000",
        "status": 200,
      }
    `)
  })

  test('refuses a token of another service account with the same email', async () => {
    const result = await exchange(
      await issuer.sign({
        audience: server.url,
        claims: { sub: '104857600000000000001' },
        preset: 'gcp',
      }),
    )

    expect(result).toMatchInlineSnapshot(`
      {
        "policy": undefined,
        "status": 400,
      }
    `)
  })
})

describe('githubActions', () => {
  test('exchanges a token within maxAge', async () => {
    const result = await exchange(
      await issuer.sign({ audience: server.url, preset: 'githubActions' }),
    )

    expect(result).toMatchInlineSnapshot(`
      {
        "policy": "githubActions:812345:*",
        "status": 200,
      }
    `)
  })

  test('refuses a token older than maxAge', async () => {
    const result = await exchange(
      await issuer.sign({
        audience: server.url,
        claims: { iat: Math.floor(Date.now() / 1000) - 900 },
        expiresIn: 600,
        preset: 'githubActions',
      }),
    )

    expect(result).toMatchInlineSnapshot(`
      {
        "policy": undefined,
        "status": 400,
      }
    `)
  })

  test('refuses a token without iat when the policy sets maxAge', async () => {
    const result = await exchange(
      await issuer.sign({
        audience: server.url,
        claims: { iat: undefined },
        preset: 'githubActions',
      }),
    )

    expect(result).toMatchInlineSnapshot(`
      {
        "policy": undefined,
        "status": 400,
      }
    `)
  })
})

describe('gitlab', () => {
  test('exchanges a token of the branch', async () => {
    const result = await exchange(await issuer.sign({ audience: server.url, preset: 'gitlab' }))

    expect(result).toMatchInlineSnapshot(`
      {
        "policy": "gitlab:812345:main",
        "status": 200,
      }
    `)
  })

  test('refuses a token of a tag with the name of the branch', async () => {
    const result = await exchange(
      await issuer.sign({ audience: server.url, claims: { ref_type: 'tag' }, preset: 'gitlab' }),
    )

    expect(result).toMatchInlineSnapshot(`
      {
        "policy": undefined,
        "status": 400,
      }
    `)
  })
})

describe('kubernetes', () => {
  test('exchanges a token of the service account', async () => {
    const result = await exchange(await issuer.sign({ audience: server.url, preset: 'kubernetes' }))

    expect(result).toMatchInlineSnapshot(`
      {
        "policy": "kubernetes:default:app",
        "status": 200,
      }
    `)
  })

  test('refuses a token of a service account in another namespace', async () => {
    const result = await exchange(
      await issuer.sign({
        audience: server.url,
        claims: { sub: 'system:serviceaccount:other:app' },
        preset: 'kubernetes',
      }),
    )

    expect(result).toMatchInlineSnapshot(`
      {
        "policy": undefined,
        "status": 400,
      }
    `)
  })
})
