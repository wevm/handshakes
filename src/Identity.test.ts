/** @module Resolves subject tokens through the default sources, against the local issuer. */
import { Identity, Source } from 'handshakes'
import { Issuer } from 'handshakes/test'

describe('token', () => {
  let issuer: Issuer.Issuer

  beforeAll(async () => {
    issuer = await Issuer.create()
  })

  afterAll(async () => {
    await issuer.close()
  })

  test('returns the token of the detected source', async () => {
    const env = await issuer.env({ preset: 'githubActions' })

    const token = await Identity.token({ audience: 'https://api.example.com', env })

    expect(token.source).toMatchInlineSnapshot(`"githubActions"`)
    expect(token.claims['aud']).toMatchInlineSnapshot(`"https://api.example.com"`)
    expect(token.claims['repository_id']).toMatchInlineSnapshot(`"812345"`)
    expect(token.expiresAt).toBe((token.claims['exp'] as number) * 1000)
  })

  test('throws when no source detects its platform', async () => {
    await expect(
      Identity.token({ audience: 'https://api.example.com', env: {} }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Identity.NotFoundError: No source detected its platform for audience https://api.example.com. Checked: vercel, githubActions, gitlab, gcp.]`,
    )
  })

  test('throws the error of the detected source, and tries no other source', async () => {
    const env = { ...(await issuer.env({ preset: 'gcp' })), GITHUB_ACTIONS: 'true' }

    await expect(
      Identity.token({ audience: 'https://api.example.com', env }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Source.RequestError: ACTIONS_ID_TOKEN_REQUEST_URL is not set. Add \`permissions: id-token: write\` to the job.]`,
    )
  })

  test('throws when a fixed-audience token has another audience', async () => {
    const env = await issuer.env({ audience: 'https://other.example.com', preset: 'gitlab' })

    await expect(
      Identity.token({
        audience: 'https://api.example.com',
        env,
        sources: [Source.gitlab({ variable: 'HTTPS___OTHER_EXAMPLE_COM_ID_TOKEN' })],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Identity.AudienceError: The gitlab token has aud ["https://other.example.com"], not "https://api.example.com".]`,
    )
  })

  test('throws when a source returns a value that is not a JWT', async () => {
    const source = Source.from({ detect: () => true, name: 'custom', token: async () => 'opaque' })

    await expect(
      Identity.token({ audience: 'https://api.example.com', env: {}, sources: [source] }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Source.RequestError: The source returned a value that is not a JWT with \`exp\`.]`,
    )
  })
})

describe('detect', () => {
  test('returns the first source that detects its platform', () => {
    const source = Identity.detect({ env: { GITHUB_ACTIONS: 'true', K_SERVICE: 'app' } })

    expect(source?.name).toMatchInlineSnapshot(`"githubActions"`)
  })

  test('returns undefined when no source detects its platform', () => {
    expect(Identity.detect({ env: {} })).toMatchInlineSnapshot(`undefined`)
  })
})
