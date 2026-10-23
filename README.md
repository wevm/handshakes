# Handshakes

Short-lived OAuth tokens for workloads and CLIs, in place of stored API keys.

> [!NOTE]
> Handshakes is in development. No API is published yet. `.agent/plans/handshakes.md` describes the planned API and phases.

## Overview

- **CI and servers:** Handshakes exchanges the platform's OIDC token, such as a GitHub Actions or Vercel token, for an access token ([RFC 8693](https://www.rfc-editor.org/rfc/rfc8693)).
- **Laptops:** Handshakes runs the device authorization grant ([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)), stores the grant, and refreshes it.
- **Servers:** `handshakes/better-auth` adds the token exchange to a [Better Auth](https://www.better-auth.com) authorization server.

```ts
import { Client } from 'handshakes'

// Exchanges the platform token in CI, or uses the stored grant on a laptop.
const client = Client.create({ issuer: 'https://id.example.com', scope: 'data:read' })
const response = await client.fetch('https://api.example.com/v1/items')
```

## Development

```sh
# Installs dependencies and links source entrypoints.
pnpm install

# Formats, lints, type-checks, and runs the integration suites.
pnpm check && pnpm check:types && pnpm test
```

## License

[MIT](LICENSE)
