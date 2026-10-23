/** @module Vocs configuration of the documentation site: navigation, links, and metadata. */
import { defineConfig } from 'vocs/config'

export default defineConfig({
  description: 'Short-lived OAuth tokens for workloads and CLIs, in place of stored API keys.',
  editLink: {
    link: 'https://github.com/wevm/handshakes/edit/main/docs/src/pages/:path',
    text: 'Suggest changes to this page',
  },
  iconUrl: '/favicon.svg',
  // The sidebar order is the reading order, so its entries keep their authored order.
  sidebar: [
    {
      items: [
        { link: '/introduction/getting-started', text: 'Getting Started' },
        { link: '/introduction/why-handshakes', text: 'Why Handshakes' },
        { link: '/introduction/concepts', text: 'Concepts' },
        { link: '/introduction/platforms', text: 'Platforms' },
        { link: '/introduction/agents', text: 'Agents' },
      ],
      text: 'Introduction',
    },
    {
      items: [
        { link: '/guides/token-exchange', text: 'Token Exchange' },
        { link: '/guides/device-authorization', text: 'Device Authorization' },
        { link: '/guides/subject-tokens', text: 'Subject Tokens' },
        { link: '/guides/authorization-server', text: 'Authorization Server' },
        { link: '/guides/better-auth', text: 'Better Auth' },
        { link: '/guides/token-verification', text: 'Token Verification' },
        { link: '/guides/discovery', text: 'Discovery' },
        { link: '/guides/testing', text: 'Testing' },
        {
          items: [
            { link: '/guides/platforms/github-actions', text: 'GitHub Actions' },
            { link: '/guides/platforms/vercel', text: 'Vercel' },
            { link: '/guides/platforms/gitlab', text: 'GitLab CI' },
            { link: '/guides/platforms/circleci', text: 'CircleCI' },
            { link: '/guides/platforms/google-cloud', text: 'Google Cloud' },
            { link: '/guides/platforms/buildkite', text: 'Buildkite' },
            { link: '/guides/platforms/kubernetes', text: 'Kubernetes' },
          ],
          text: 'Platforms',
        },
        {
          items: [
            { link: '/guides/services/openrouter', text: 'OpenRouter' },
            { link: '/guides/services/google-sts', text: 'Google Cloud STS' },
            { link: '/guides/services/vercel-ai-gateway', text: 'Vercel AI Gateway' },
            { link: '/guides/services/google-oauth', text: 'Google OAuth' },
          ],
          text: 'Services',
        },
      ],
      text: 'Guides',
    },
    {
      items: [
        {
          items: [
            { link: '/api/core', text: 'Overview' },
            { link: '/api/core/client/create', text: 'Client.create' },
            { link: '/api/core/client/discover', text: 'Client.discover' },
            { link: '/api/core/identity/token', text: 'Identity.token' },
            { link: '/api/core/identity/detect', text: 'Identity.detect' },
            { link: '/api/core/device-grant/start', text: 'DeviceGrant.start' },
            { link: '/api/core/exchange/request', text: 'Exchange.request' },
            {
              link: '/api/core/metadata/authorization-server',
              text: 'Metadata.authorizationServer',
            },
            { link: '/api/core/metadata/protected-resource', text: 'Metadata.protectedResource' },
            { link: '/api/core/metadata/challenge', text: 'Metadata.challenge' },
            { link: '/api/core/source', text: 'Source' },
            { link: '/api/core/store', text: 'Store' },
            { link: '/api/core/grant', text: 'Grant' },
            { link: '/api/core/errors', text: 'Errors' },
          ],
          text: 'handshakes',
        },
        {
          items: [
            { link: '/api/node', text: 'Overview' },
            { link: '/api/node/store/file', text: 'Store.file' },
            { link: '/api/node/source/file', text: 'Source.file' },
            { link: '/api/node/source/buildkite', text: 'Source.buildkite' },
          ],
          text: 'handshakes/node',
        },
        {
          items: [
            { link: '/api/server', text: 'Overview' },
            { link: '/api/server/server/create', text: 'Server.create' },
            { link: '/api/server/resource/create', text: 'Resource.create' },
            { link: '/api/server/policy', text: 'Policy' },
          ],
          text: 'handshakes/server',
        },
        {
          items: [
            { link: '/api/better-auth', text: 'Overview' },
            { link: '/api/better-auth/token-exchange', text: 'tokenExchange' },
          ],
          text: 'handshakes/better-auth',
        },
        {
          items: [
            { link: '/api/test', text: 'Overview' },
            { link: '/api/test/issuer/create', text: 'Issuer.create' },
          ],
          text: 'handshakes/test',
        },
      ],
      text: 'API Reference',
    },
    {
      items: [
        { link: '/cli', text: 'Overview' },
        { link: '/cli/configuration', text: 'Configuration' },
        { link: '/cli/mcp', text: 'MCP' },
        {
          items: [
            { link: '/cli/authorize', text: 'authorize' },
            { link: '/cli/exec', text: 'exec' },
            { link: '/cli/fetch', text: 'fetch' },
            { link: '/cli/profiles', text: 'profiles' },
            { link: '/cli/revoke', text: 'revoke' },
            { link: '/cli/status', text: 'status' },
            { link: '/cli/token', text: 'token' },
          ],
          text: 'Commands',
        },
      ],
      text: 'CLI Reference',
    },
  ],
  socials: [{ icon: 'github', link: 'https://github.com/wevm/handshakes' }],
  title: 'Handshakes',
  topNav: [
    { link: '/introduction/getting-started', match: '/introduction', text: 'Docs' },
    { link: '/guides/token-exchange', match: '/guides', text: 'Guides' },
    { link: '/api/core', match: '/api', text: 'API' },
    { link: '/cli', match: '/cli', text: 'CLI' },
  ],
})
