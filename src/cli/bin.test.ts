/** @module Runs the command-line entry as a real process. */
import * as ChildProcess from 'node:child_process'
import * as Fs from 'node:fs'
import * as Path from 'node:path'
import * as Esbuild from 'esbuild'
import { Policy, Resource } from 'handshakes/server'
import { Issuer } from 'handshakes/test'
import * as Http from '../../test/Http.js'
import * as Server from '../../test/Server.js'

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
   * asynchronously, so servers in the test process keep answering its requests. `onStderr`
   * receives the error output as it arrives.
   */
  function run(
    args: readonly string[],
    env: Readonly<Record<string, string>> = {},
    onStderr: (stderr: string) => void = () => {},
  ) {
    return new Promise<{ status: number | null; stderr: string; stdout: string }>((resolve) => {
      const child = ChildProcess.spawn(process.execPath, [bin, ...args], {
        env: { PATH: process.env['PATH'] ?? '', ...env },
      })
      let stderr = ''
      let stdout = ''
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk
        onStderr(stderr)
      })
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
        authorize  Runs the device grant (RFC 8628) and stores the grant. Alias: login.
        exec       Runs the command after \`--\` with an access token in an environment variable, then exits with its code.
        fetch      Sends a request with an access token, and prints the response body. Without a profile, discovers the authorization server from the API.
        login      Runs the device grant (RFC 8628) and stores the grant. Alias: login.
        logout     Revokes the refresh token (RFC 7009) and deletes the stored grant. Alias: logout.
        profiles   Lists the profiles, the file of each, and the default profile.
        revoke     Revokes the refresh token (RFC 7009) and deletes the stored grant. Alias: logout.
        status     Names the source that detects its platform here and, for a profile, the stored grant and its expiry.
        token      Prints the access token of a profile. With --audience, prints the OIDC token that the platform signs for this code.

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
            "circleci",
            "buildkite",
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
      message: "No source detected its platform for audience https://api.example.com. Checked: vercel, githubActions, gitlab, circleci, buildkite, gcp. To resolve: 1. Run the code on a platform that issues OIDC tokens, such as GitHub Actions or Vercel. 2. On another platform, pass a custom source in \`sources\`, built with \`Source.from\`."
      "
    `)
  })

  describe('with a profile', () => {
    let env: Record<string, string>
    let server: Server.create.ReturnType

    beforeAll(async () => {
      server = await Server.create()
      const config = Path.join(dir, 'handshakes.json')
      Fs.writeFileSync(
        config,
        JSON.stringify({
          default: 'local',
          profiles: {
            local: {
              clientId: server.clientId,
              env: 'API_TOKEN',
              issuer: server.url,
              scope: 'openid email offline_access',
            },
          },
        }),
      )
      env = { HANDSHAKES_CONFIG: config, XDG_CONFIG_HOME: Path.join(dir, 'config') }
    })

    afterAll(async () => {
      await server.close()
    })

    test('authorize, token, exec, status, and revoke', async () => {
      // The CLI prints the user code to stderr, and the test approves it as the user would.
      let approval: Promise<void> | undefined
      const authorize = await run(['authorize', '--json'], env, (stderr) => {
        const code = /confirm ([A-Z0-9-]+)\./.exec(stderr)?.[1]
        if (code && !approval) approval = server.approve(code)
      })
      await approval

      expect(authorize.status).toMatchInlineSnapshot(`0`)
      expect(JSON.parse(authorize.stdout)).toMatchInlineSnapshot(
        { expiresAt: expect.any(Number) },
        `
        {
          "expiresAt": Any<Number>,
          "refreshable": true,
          "scope": "openid email offline_access",
        }
      `,
      )

      const token = await run(['token'], env)
      const userinfo = await fetch(`${server.url}/oauth2/userinfo`, {
        headers: { authorization: `Bearer ${token.stdout.trim()}` },
      })

      expect(token.status).toMatchInlineSnapshot(`0`)
      expect(userinfo.status).toMatchInlineSnapshot(`200`)

      const exec = await run(
        ['exec', '--', process.execPath, '-e', 'process.stdout.write(process.env.API_TOKEN ?? "")'],
        env,
      )

      expect(exec.status).toMatchInlineSnapshot(`0`)
      expect(exec.stdout).toBe(token.stdout.trim())

      const exit = await run(['exec', '--', process.execPath, '-e', 'process.exit(7)'], env)

      expect(exit.status).toMatchInlineSnapshot(`7`)

      const status = await run(['status', '--json'], env)

      expect(JSON.parse(status.stdout)).toMatchInlineSnapshot(
        {
          grant: { expiresAt: expect.any(Number) },
          issuer: expect.any(String),
        },
        `
        {
          "checked": [
            "vercel",
            "githubActions",
            "gitlab",
            "circleci",
            "buildkite",
            "gcp",
          ],
          "grant": {
            "expiresAt": Any<Number>,
            "method": "grant",
            "refreshable": true,
          },
          "issuer": Any<String>,
          "profile": "local",
          "source": null,
        }
      `,
      )

      const revoke = await run(['revoke', '--json'], env)
      const after = await run(['token'], env)

      expect(revoke.status).toMatchInlineSnapshot(`0`)
      expect(after.status).toMatchInlineSnapshot(`3`)
      expect(after.stdout.replace(server.url, '<issuer>')).toMatchInlineSnapshot(`
        "code: AUTHORIZATION_REQUIRED
        message: "Authorization is required for <issuer>. To resolve: 1. On a device, run \`authorize\` (\`handshakes authorize\` in the CLI) to run the device grant. 2. In CI, check that the platform is detected with \`handshakes status\`."
        "
      `)
    }, 30_000)

    test('fetch refuses a URL outside the origin of the profile', async () => {
      const result = await run(['fetch', 'https://other.example.com/v1/items'], env)

      expect(result.status).toMatchInlineSnapshot(`2`)
      expect((result.stdout + result.stderr).replace(server.url, '<issuer>'))
        .toMatchInlineSnapshot(`
        "code: OUTSIDE_RESOURCE
        message: "The URL https://other.example.com/v1/items is outside the origin of the profile, <issuer>. To resolve: Set \`resource\` in the profile to the API that the token is for."
        "
      `)
    })

    test('profiles lists the profiles and the default', async () => {
      const result = await run(['profiles', '--json'], env)

      expect(JSON.parse(result.stdout)).toMatchInlineSnapshot(
        {
          profiles: [{ file: expect.any(String), issuer: expect.any(String) }],
        },
        `
        {
          "default": "local",
          "profiles": [
            {
              "file": Any<String>,
              "issuer": Any<String>,
              "name": "local",
            },
          ],
        }
      `,
      )
    })

    test('names an unknown profile', async () => {
      const result = await run(['token', 'missing'], env)

      expect(result.status).toMatchInlineSnapshot(`2`)
      expect(result.stdout).toMatchInlineSnapshot(`
        "code: NO_PROFILE
        message: "No profile is named missing. To resolve: Run \`handshakes profiles\` to list the profiles."
        "
      `)
    })
  })

  describe('with an API that uses Resource', () => {
    let api: Awaited<ReturnType<typeof Http.serve>>
    let env: Record<string, string>
    let issuer: Issuer.Issuer
    let server: Server.create.ReturnType

    beforeAll(async () => {
      let resource: Resource.Resource | undefined
      issuer = await Issuer.create()
      api = await Http.serve(() => async (request) => {
        if (!resource) return new Response(null, { status: 503 })
        if (request.url === resource.metadataUrl) return resource.metadata()

        const result = await resource.verify(request)
        if (result.status === 'invalid') return resource.challenge(result)
        if (new URL(request.url).pathname !== '/v1/items')
          return new Response(null, { status: 404 })
        return Response.json({
          items: [],
          method: request.method,
          subject: result.principal.subject,
        })
      })
      server = await Server.create({ resources: [`${api.url}/v1`] })
      await server.trust(
        Policy.githubActions({
          audience: server.url,
          issuer: issuer.url,
          repositoryId: '812345',
          scopes: ['data:read'],
        }),
      )
      resource = Resource.create({
        authorizationServers: [server.url],
        resource: `${api.url}/v1`,
        scopes: ['data:read'],
      })

      // No profile applies: no project file, and an empty user configuration.
      env = {
        ...(await issuer.env({ preset: 'githubActions' })),
        XDG_CONFIG_HOME: Path.join(dir, 'empty'),
      }
    })

    afterAll(async () => {
      await Promise.all([api.close(), issuer.close(), server.close()])
    })

    test('fetch discovers the authorization server and sends the access token', async () => {
      const result = await run(['fetch', `${api.url}/v1/items`], env)

      expect(result.status).toMatchInlineSnapshot(`0`)
      expect(JSON.parse(result.stdout)).toMatchInlineSnapshot(
        { subject: expect.any(String) },
        `
        {
          "items": [],
          "method": "GET",
          "subject": Any<String>,
        }
      `,
      )
    })

    test('fetch sends the method, headers, and body', async () => {
      const result = await run(
        [
          'fetch',
          `${api.url}/v1/items`,
          '-X',
          'PUT',
          '-H',
          'content-type: application/json',
          '-d',
          '{}',
          '--json',
        ],
        env,
      )

      expect(result.status).toMatchInlineSnapshot(`0`)
      expect(JSON.parse(JSON.parse(result.stdout).body).method).toMatchInlineSnapshot(`"PUT"`)
    })

    test('fetch --fail exits with 22 on HTTP 404', async () => {
      const result = await run(['fetch', `${api.url}/v1/missing`, '--fail'], env)

      expect(result.status).toMatchInlineSnapshot(`22`)
    })

    test('fetch exits with 3 when no source detects its platform', async () => {
      const result = await run(['fetch', `${api.url}/v1/items`], {
        XDG_CONFIG_HOME: Path.join(dir, 'empty'),
      })

      expect(result.status).toMatchInlineSnapshot(`3`)
    })

    test('--mcp serves fetch and status, and no token tool', async () => {
      const child = ChildProcess.spawn(process.execPath, [bin, '--mcp'], {
        env: { PATH: process.env['PATH'] ?? '', ...env },
      })
      const responses = new Map<number, (message: Record<string, unknown>) => void>()
      let buffer = ''
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk
        for (let index = buffer.indexOf('\n'); index !== -1; index = buffer.indexOf('\n')) {
          const message = JSON.parse(buffer.slice(0, index)) as Record<string, unknown>
          buffer = buffer.slice(index + 1)
          responses.get(message['id'] as number)?.(message)
        }
      })

      /** Sends a JSON-RPC request over stdio, and returns its result. */
      let id = 0
      function call(method: string, params: Record<string, unknown> = {}) {
        id += 1
        const current = id
        return new Promise<Record<string, unknown>>((resolve) => {
          responses.set(current, (message) => resolve(message['result'] as Record<string, unknown>))
          child.stdin.write(`${JSON.stringify({ id: current, jsonrpc: '2.0', method, params })}\n`)
        })
      }

      await call('initialize', {
        capabilities: {},
        clientInfo: { name: 'test', version: '0.0.0' },
        protocolVersion: '2025-06-18',
      })
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
      )

      const tools = await call('tools/list')
      const result = await call('tools/call', {
        arguments: { url: `${api.url}/v1/items` },
        name: 'fetch',
      })
      child.kill()

      const fetchTool = (
        tools['tools'] as { inputSchema: { properties: object }; name: string }[]
      ).find((tool) => tool.name === 'fetch')
      // An agent cannot redirect a token with `issuer` or `resource`, or read a file with `@file`.
      expect(Object.keys(fetchTool?.inputSchema.properties ?? {})).toMatchInlineSnapshot(`
        [
          "profile",
          "url",
          "data",
          "fail",
          "header",
          "method",
        ]
      `)
      expect((tools['tools'] as { name: string }[]).map((tool) => tool.name))
        .toMatchInlineSnapshot(`
        [
          "fetch",
          "status",
        ]
      `)
      expect(JSON.stringify(result).includes('"status\\":200')).toMatchInlineSnapshot(`true`)
    })
  })
})
