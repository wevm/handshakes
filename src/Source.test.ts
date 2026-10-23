/** @module Requests subject tokens from each platform source, against the local issuer and real platforms. */
import * as Crypto from 'node:crypto'
import { Identity, Source } from 'handshakes'
import { Issuer } from 'handshakes/test'

const audience = 'https://api.example.com'

let issuer: Issuer.Issuer

beforeAll(async () => {
  issuer = await Issuer.create()
})

afterAll(async () => {
  await issuer.close()
})

describe('gcp', () => {
  test('requests a token from the metadata server', async () => {
    const env = await issuer.env({ preset: 'gcp' })

    const token = await Identity.token({ audience, env, sources: [Source.gcp()] })

    expect(token.source).toMatchInlineSnapshot(`"gcp"`)
    expect(token.claims['email']).toMatchInlineSnapshot(`"ci@acme.iam.gserviceaccount.com"`)
  })
})

describe('githubActions', () => {
  test('requests a token from the runner', async () => {
    const env = await issuer.env({ preset: 'githubActions' })

    const token = await Identity.token({ audience, env, sources: [Source.githubActions()] })

    expect(token.claims['sub']).toMatchInlineSnapshot(`"repo:acme/app:ref:refs/heads/main"`)
  })

  test('throws when the job lacks the id-token permission', async () => {
    await expect(
      Identity.token({
        audience,
        env: { GITHUB_ACTIONS: 'true' },
        sources: [Source.githubActions()],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Source.RequestError: ACTIONS_ID_TOKEN_REQUEST_URL is not set. Add \`permissions: id-token: write\` to the job.]`,
    )
  })

  test('throws when the runner rejects the request token', async () => {
    const env = {
      ...(await issuer.env({ preset: 'githubActions' })),
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'wrong',
    }

    await expect(
      Identity.token({ audience, env, sources: [Source.githubActions()] }),
    ).rejects.toThrow(/returned HTTP 401\.$/)
  })

  // Runs only in GitHub Actions with `id-token: write`, against GitHub's own issuer and keys.
  test.runIf(process.env['ACTIONS_ID_TOKEN_REQUEST_URL'])(
    'returns a token that verifies against the keys of GitHub',
    async () => {
      const token = await Identity.token({
        audience: 'handshakes-ci',
        sources: [Source.githubActions()],
      })

      const [header, payload, signature] = token.value.split('.') as [string, string, string]
      const kid = (JSON.parse(Buffer.from(header, 'base64url').toString()) as { kid: string }).kid
      const jwks = (await (
        await fetch('https://token.actions.githubusercontent.com/.well-known/jwks')
      ).json()) as { keys: (Crypto.JsonWebKey & { kid: string })[] }
      const jwk = jwks.keys.find((key) => key.kid === kid)

      const valid = Crypto.verify(
        'RSA-SHA256',
        Buffer.from(`${header}.${payload}`),
        Crypto.createPublicKey({ format: 'jwk', key: jwk! }),
        Buffer.from(signature, 'base64url'),
      )

      expect(valid).toMatchInlineSnapshot(`true`)
      expect(token.claims['iss']).toMatchInlineSnapshot(
        `"https://token.actions.githubusercontent.com"`,
      )
      expect(token.claims['aud']).toMatchInlineSnapshot(`"handshakes-ci"`)
    },
  )
})

describe('gitlab', () => {
  test('reads the variable that id_tokens declares for the audience', async () => {
    const env = await issuer.env({ audience, preset: 'gitlab' })

    const token = await Identity.token({ audience, env, sources: [Source.gitlab()] })

    expect(token.claims['project_path']).toMatchInlineSnapshot(`"acme/app"`)
  })

  test('throws when the variable is not declared', async () => {
    await expect(
      Identity.token({ audience, env: { GITLAB_CI: 'true' }, sources: [Source.gitlab()] }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Source.RequestError: HTTPS___API_EXAMPLE_COM_ID_TOKEN is not set. Declare \`HTTPS___API_EXAMPLE_COM_ID_TOKEN\` under \`id_tokens\` in .gitlab-ci.yml, with \`aud: https://api.example.com\`.]`,
    )
  })
})

describe('vercel', () => {
  test('returns the token unchanged when it carries the audience', async () => {
    const env = await issuer.env({ audience: 'https://vercel.com/acme', preset: 'vercel' })

    const token = await Identity.token({
      audience: 'https://vercel.com/acme',
      env,
      sources: [Source.vercel()],
    })

    expect(token.value).toBe(env['VERCEL_OIDC_TOKEN'])
  })

  test('exchanges the token for another audience', async () => {
    const env = await issuer.env({ preset: 'vercel' })

    const token = await Identity.token({
      audience,
      env,
      sources: [Source.vercel({ exchangeUrl: `${issuer.url}/vercel/token` })],
    })

    expect(token.claims['aud']).toMatchInlineSnapshot(`"https://api.example.com"`)
    expect(token.claims['project_id']).toMatchInlineSnapshot(`"prj_app"`)
  })

  test('throws when no token is available', async () => {
    await expect(
      Identity.token({ audience, env: { VERCEL: '1' }, sources: [Source.vercel()] }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Source.RequestError: No Vercel OIDC token is available. Call it inside a request on Vercel Functions, or run \`vercel env pull\` for local development.]`,
    )
  })
})
