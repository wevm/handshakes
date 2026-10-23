/**
 * @module Exchanges the GitHub Actions token of a CI job at real authorization servers, then calls
 * the API with the access token. Each suite runs only when its repository variables are set, as the
 * Platforms workflow sets them. No suite reads a secret.
 */
import { Client, Source } from 'handshakes'

const github = process.env['ACTIONS_ID_TOKEN_REQUEST_URL'] !== undefined

/** Full name of a Google workload identity provider: `projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`. */
const provider = process.env['GCP_WORKLOAD_PROVIDER']
/** A Cloud Storage bucket that the provider's principals may list. */
const bucket = process.env['GCP_BUCKET']

describe.runIf(github && provider && bucket)('Google STS', () => {
  test('lists a Cloud Storage bucket with a federated access token', async () => {
    const client = Client.create({
      endpoints: { token: 'https://sts.googleapis.com/v1/token' },
      // Google STS names the provider in `audience`, and expects it as the `aud` of the subject token too.
      parameters: { audience: `//iam.googleapis.com/${provider}` },
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      sources: [Source.githubActions()],
      subjectAudience: `https://iam.googleapis.com/${provider}`,
    })

    const token = await client.token()
    const response = await client.fetch(
      `https://storage.googleapis.com/storage/v1/b/${bucket}/o?maxResults=1`,
    )

    expect(token.method).toMatchInlineSnapshot(`"exchange"`)
    expect(response.status).toMatchInlineSnapshot(`200`)
  })
})

/** ID of an OpenRouter federation policy that trusts this repository. */
const policy = process.env['OPENROUTER_FEDERATION_POLICY_ID']
/** The audience of the policy, which the subject token carries. */
const audience = process.env['OPENROUTER_AUDIENCE']

describe.runIf(github && policy && audience)('OpenRouter', () => {
  test('reads the key of a federated access token', async () => {
    const client = Client.create({
      endpoints: { token: 'https://openrouter.ai/api/v1/oauth/token' },
      parameters: { federation_policy_id: policy ?? '' },
      sources: [Source.githubActions()],
      subjectAudience: audience,
    })

    const token = await client.token()
    const response = await client.fetch('https://openrouter.ai/api/v1/key')

    expect(token.method).toMatchInlineSnapshot(`"exchange"`)
    expect(response.status).toMatchInlineSnapshot(`200`)
  })
})
