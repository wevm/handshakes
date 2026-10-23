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

describe('circleci', () => {
  const organization = 'b6a6b6f0-0000-4000-8000-000000000000'

  test('reads the token of the job, whose audience is the organization', async () => {
    const env = await issuer.env({ preset: 'circleci' })

    const token = await Identity.token({
      audience: organization,
      env,
      sources: [Source.circleci()],
    })

    expect(token.claims['oidc.circleci.com/project-id']).toMatchInlineSnapshot(
      `"c1d2e3f4-0000-4000-8000-000000000000"`,
    )
  })

  test('throws before it sends a token for another audience', async () => {
    const env = await issuer.env({ preset: 'circleci' })

    await expect(Identity.token({ audience, env, sources: [Source.circleci()] })).rejects.toThrow(
      Identity.AudienceError,
    )
  })

  test('throws when the job has no token', async () => {
    await expect(
      Identity.token({ audience, env: { CIRCLECI: 'true' }, sources: [Source.circleci()] }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `
      [Source.RequestError: CIRCLE_OIDC_TOKEN_V2 is not set.

      To resolve: Check that CircleCI issues OIDC tokens to this job.]
    `,
    )
  })
})

describe('gcp', () => {
  test('requests a token from the metadata server', async () => {
    const env = await issuer.env({ preset: 'gcp' })

    const token = await Identity.token({ audience, env, sources: [Source.gcp()] })

    expect(token.source).toMatchInlineSnapshot(`"gcp"`)
    expect(token.claims['email']).toMatchInlineSnapshot(`"ci@acme.iam.gserviceaccount.com"`)
  })

  test('requests a token on Compute Engine and GKE, which set no K_SERVICE', async () => {
    const env = { ...(await issuer.env({ preset: 'gcp' })), K_SERVICE: undefined }

    const token = await Identity.token({
      audience,
      env,
      sources: [Source.githubActions(), Source.gcp({ detect: 'always' })],
    })

    expect(token.source).toMatchInlineSnapshot(`"gcp"`)
    expect(token.claims['email']).toMatchInlineSnapshot(`"ci@acme.iam.gserviceaccount.com"`)
  })

  test('detects nothing without K_SERVICE in the default sources', async () => {
    const env = { ...(await issuer.env({ preset: 'gcp' })), K_SERVICE: undefined }

    await expect(Identity.token({ audience, env })).rejects.toThrowErrorMatchingInlineSnapshot(`
      [Identity.NotFoundError: No source detected its platform for audience https://api.example.com. Checked: vercel, githubActions, gitlab, circleci, gcp.

      To resolve:
      1. Run the code on a platform that issues OIDC tokens, such as GitHub Actions or Vercel.
      2. On another platform, pass a custom source in \`sources\`, built with \`Source.from\`.]
    `)
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
      `
      [Source.RequestError: ACTIONS_ID_TOKEN_REQUEST_URL is not set.

      To resolve: Add \`permissions: id-token: write\` to the job, or to the workflow.]
    `,
    )
  })

  test('throws when the runner rejects the request token', async () => {
    const env = {
      ...(await issuer.env({ preset: 'githubActions' })),
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'wrong',
    }

    const error = await Identity.token({ audience, env, sources: [Source.githubActions()] }).then(
      () => undefined,
      (error: Source.RequestError) => error,
    )
    if (!error) throw new Error('Expected a refusal.')

    expect(error.details.endsWith('returned HTTP 401.')).toMatchInlineSnapshot(`true`)
    expect(error.steps).toMatchInlineSnapshot(`
      [
        "Check that the job may request OIDC tokens, such as \`permissions: id-token: write\` on GitHub Actions.",
      ]
    `)
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
      `
      [Source.RequestError: HTTPS___API_EXAMPLE_COM_ID_TOKEN is not set.

      To resolve: Declare \`HTTPS___API_EXAMPLE_COM_ID_TOKEN\` under \`id_tokens\` in .gitlab-ci.yml, with \`aud: https://api.example.com\`.]
    `,
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
      `
      [Source.RequestError: No Vercel OIDC token is available.

      To resolve:
      1. On Vercel Functions, request the token inside a request.
      2. For local development, run \`vercel env pull\` to write \`VERCEL_OIDC_TOKEN\`.]
    `,
    )
  })
})
