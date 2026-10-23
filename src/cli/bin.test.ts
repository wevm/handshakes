/** @module Runs the command-line entry as a real process. */
import * as ChildProcess from 'node:child_process'
import * as Fs from 'node:fs'
import * as Path from 'node:path'
import * as Esbuild from 'esbuild'
import { Issuer } from 'handshakes/test'

describe('handshakes', () => {
  let bin: string
  let dir: string

  // Node cannot resolve the source's `.js` specifiers to `.ts`, so the CLI runs as a bundle. The
  // bundle stays inside the repository, so it resolves the package's dependencies.
  beforeAll(async () => {
    dir = Fs.mkdtempSync(Path.join(import.meta.dirname, '.bin-'))
    bin = Path.join(dir, 'bin.mjs')
    await Esbuild.build({
      bundle: true,
      entryPoints: [Path.join(import.meta.dirname, 'bin.ts')],
      format: 'esm',
      outfile: bin,
      packages: 'external',
      platform: 'node',
    })
  })

  afterAll(() => {
    Fs.rmSync(dir, { force: true, recursive: true })
  })

  /**
   * Runs the CLI with `env` in place of the environment of the test process. The child runs
   * asynchronously, so servers in the test process keep answering its requests.
   */
  function run(args: readonly string[], env: Readonly<Record<string, string>> = {}) {
    return new Promise<{ status: number | null; stderr: string; stdout: string }>((resolve) => {
      const child = ChildProcess.spawn(process.execPath, [bin, ...args], {
        env: { PATH: process.env['PATH'] ?? '', ...env },
      })
      let stderr = ''
      let stdout = ''
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk))
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk))
      child.on('close', (status) => resolve({ status, stderr, stdout }))
    })
  }

  test('--help', async () => {
    const result = await run(['--help'])

    expect(result.status).toMatchInlineSnapshot(`0`)
    expect(result.stdout).toMatchInlineSnapshot(`
      "handshakes — Resolves short-lived OAuth access tokens from the platform identity or a stored grant, in place of stored API keys.

      Usage: handshakes <command>

      Commands:
        status  Names the source that detects its platform here, and the sources that were checked.
        token   Prints the OIDC token that the platform signs for this code, with the requested audience.

      Integrations:
        completions  Generate shell completion script
        mcp          Register as MCP server (add, doctor)
        skills       Sync skill files to agents (add, list)

      Global Options:
        --filter-output <keys>              Filter output by key paths (e.g. foo,bar.baz,a[0,3])
        --format <toon|json|yaml|md|jsonl>  Output format
        --full-output                       Show full output envelope
        --help                              Show help
        --llms, --llms-full                 Print LLM-readable manifest
        --mcp                               Start as MCP stdio server
        --schema                            Show JSON Schema for command
        --token-count                       Print token count of output (instead of output)
        --token-limit <n>                   Limit output to n tokens
        --token-offset <n>                  Skip first n tokens of output
        --update                            Update to latest version
        --version                           Show version
      "
    `)
  })

  describe('with the local issuer', () => {
    let issuer: Issuer.Issuer

    beforeAll(async () => {
      issuer = await Issuer.create()
    })

    afterAll(async () => {
      await issuer.close()
    })

    test('token --audience prints the subject token', async () => {
      const result = await run(
        ['token', '--audience', 'https://api.example.com'],
        await issuer.env({ preset: 'githubActions' }),
      )

      expect(result.status).toMatchInlineSnapshot(`0`)
      expect(result.stdout).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+\n$/)
    })

    test('status --json names the detected source', async () => {
      const result = await run(['status', '--json'], await issuer.env({ preset: 'githubActions' }))

      expect(JSON.parse(result.stdout)).toMatchInlineSnapshot(`
        {
          "checked": [
            "vercel",
            "githubActions",
            "gitlab",
            "gcp",
          ],
          "source": "githubActions",
        }
      `)
    })
  })

  test('token --audience exits with 3 when no source detects its platform', async () => {
    const result = await run(['token', '--audience', 'https://api.example.com'])

    expect(result.status).toMatchInlineSnapshot(`3`)
    expect(result.stdout + result.stderr).toMatchInlineSnapshot(`
      "code: SOURCE_NOT_FOUND
      message: "No source detected its platform for audience https://api.example.com. Checked: vercel, githubActions, gitlab, gcp."
      "
    `)
  })
})
