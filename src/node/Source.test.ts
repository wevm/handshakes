/** @module Reads subject tokens from files, as Kubernetes projects them, and from the Buildkite agent. */
import * as Fs from 'node:fs'
import * as Os from 'node:os'
import * as Path from 'node:path'
import { Identity } from 'handshakes'
import { Source } from 'handshakes/node'
import { Issuer } from 'handshakes/test'

describe('buildkite', () => {
  test('throws with a hint when the job has no agent', async () => {
    await expect(
      Identity.token({
        audience: 'https://api.example.com',
        env: { BUILDKITE: 'true', PATH: '' },
        sources: [Source.buildkite()],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Source.RequestError: buildkite-agent did not return an OIDC token. Run the job on a Buildkite agent, which provides \`buildkite-agent\`.]`,
    )
  })
})

describe('defaults', () => {
  test('adds buildkite to the defaults of the core entry, before gcp', () => {
    expect(Source.defaults.map((source) => source.name)).toMatchInlineSnapshot(`
      [
        "vercel",
        "githubActions",
        "gitlab",
        "circleci",
        "buildkite",
        "gcp",
      ]
    `)
  })
})

describe('file', () => {
  let directory: string
  let issuer: Issuer.Issuer

  beforeAll(async () => {
    directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'handshakes-'))
    issuer = await Issuer.create()
  })

  afterAll(async () => {
    Fs.rmSync(directory, { force: true, recursive: true })
    await issuer.close()
  })

  test('reads the token from the file', async () => {
    const path = Path.join(directory, 'token')
    Fs.writeFileSync(
      path,
      `${await issuer.sign({ audience: 'https://api.example.com', preset: 'gcp' })}\n`,
    )

    const token = await Identity.token({
      audience: 'https://api.example.com',
      env: {},
      sources: [Source.file({ name: 'kubernetes', path })],
    })

    expect(token.source).toMatchInlineSnapshot(`"kubernetes"`)
  })

  test('detects nothing when the file does not exist', async () => {
    await expect(
      Identity.token({
        audience: 'https://api.example.com',
        env: {},
        sources: [Source.file({ path: Path.join(directory, 'missing') })],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Identity.NotFoundError: No source detected its platform for audience https://api.example.com. Checked: file.]`,
    )
  })
})
