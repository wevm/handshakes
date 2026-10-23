/**
 * @module The RFC 8693 token exchange as a plugin of `@better-auth/oauth-provider`. It verifies the
 * subject token against trust policies, and Better Auth issues the access token.
 */
import { extendOAuthProvider, type OAuthExtensionGrantHandler } from '@better-auth/oauth-provider'
import type { BetterAuthPlugin, StandardSchemaV1 } from 'better-auth'
import { APIError, createAuthEndpoint } from 'better-auth/api'
import * as Jwt from '../internal/Jwt.js'
import * as Jwks from '../server/internal/Jwks.js'
import * as Subject from '../server/internal/Subject.js'
import type * as Policy from '../server/Policy.js'

/** Grant type of the token exchange (RFC 8693 §2.1). */
const grantType = 'urn:ietf:params:oauth:grant-type:token-exchange'

/** Token type of an issued access token (RFC 8693 §3). */
const accessTokenType = 'urn:ietf:params:oauth:token-type:access_token'

/** Model name of the table that stores trust policies. */
const model = 'trustPolicy'

/**
 * Returns the plugin. It requires `oauthProvider()`, and a registered client for each policy whose
 * grant types include the token exchange.
 *
 * Better Auth sets the lifetime of the issued access token from `m2mAccessTokenExpiresIn`, and not
 * per request. So the plugin refuses a subject token that expires before that lifetime ends. Set
 * `m2mAccessTokenExpiresIn` below the lifetime of the shortest subject token, such as 300 seconds
 * for GitHub Actions.
 */
export function tokenExchange(options: tokenExchange.Options = {}) {
  const jwks = Jwks.create({ fetch: options.fetch ?? globalThis.fetch })

  /** Returns the policies of `issuer`, from the options and from the `trustPolicy` table. */
  async function policies(
    context: Parameters<OAuthExtensionGrantHandler>[0]['ctx'],
    issuer: string,
  ): Promise<readonly Policy.Policy[]> {
    const rows = await context.context.adapter.findMany<Row>({
      model,
      where: [{ field: 'issuer', value: issuer }],
    })
    return [...(options.policies ?? []), ...rows.map(fromRow)]
  }

  const handler: OAuthExtensionGrantHandler = async (input) => {
    const body = (input.ctx.body ?? {}) as Record<string, unknown>
    const field = (name: string) => (typeof body[name] === 'string' ? body[name] : undefined)

    const requested = field('requested_token_type')
    if (requested && requested !== accessTokenType)
      throw new APIError('BAD_REQUEST', {
        error: 'invalid_request',
        error_description: `requested_token_type must be ${accessTokenType}.`,
      })

    const resources = (() => {
      const resource = body['resource']
      if (typeof resource === 'string') return [resource]
      return Array.isArray(resource) ? resource.map(String) : []
    })()

    const subjectToken = field('subject_token')
    const issuer = (() => {
      if (!subjectToken) return undefined
      const iss = Jwt.decode(subjectToken)?.payload['iss']
      return typeof iss === 'string' ? iss : undefined
    })()

    // Better Auth issues every access token of this grant for `lifetime`. A policy can only shorten it.
    const lifetime = input.opts.m2mAccessTokenExpiresIn ?? 3600
    // Read before verification, which caps `expiresAt` from a later clock reading.
    const now = Date.now()
    const result = await Subject.verify({
      jwks,
      maxLifetime: lifetime,
      policies: issuer ? await policies(input.ctx, issuer) : [],
      resources,
      scope: field('scope'),
      subjectToken,
      subjectTokenType: field('subject_token_type'),
    })
    if (!result.ok)
      throw new APIError('BAD_REQUEST', {
        error: result.error,
        error_description: result.errorDescription,
      })

    const refused = new APIError('BAD_REQUEST', {
      error: 'invalid_grant',
      error_description: 'The subject token matches no trust policy.',
    })

    // A client that names itself must be the client of the policy.
    const clientId = result.policy.clientId
    if (!clientId || (field('client_id') && field('client_id') !== clientId)) throw refused

    const client = await input.provider.getClient(clientId)
    if (!client || client.disabled || !client.grantTypes?.includes(grantType)) throw refused

    // Better Auth issues the access token for `lifetime`, which must end no later than `expiresAt`.
    if (now + lifetime * 1000 > result.expiresAt)
      throw new APIError('BAD_REQUEST', {
        error: 'invalid_grant',
        error_description:
          'The subject token expires before the access token that the server issues. Request a subject token with a longer lifetime.',
      })

    const issued = await input.provider.issueTokens({
      client,
      ...(result.resources.length > 0 ? { resources: [...result.resources] } : {}),
      scopes: [...result.scopes],
      tokenResponse: { issued_token_type: accessTokenType },
    })
    // A resource or scope with a longer lifetime than `m2mAccessTokenExpiresIn` is a configuration defect.
    if (issued.expires_at * 1000 > result.expiresAt + 1000)
      throw new Error(
        'Better Auth issued an access token that expires after the subject token. Set `accessTokenTtl` of each resource and each `scopeExpirations` entry at or below `m2mAccessTokenExpiresIn`.',
      )

    return issued
  }

  return {
    endpoints: {
      createTrustPolicy: createAuthEndpoint(
        '/trust-policies',
        { body: policySchema, metadata: { SERVER_ONLY: true }, method: 'POST' },
        async (context) => {
          const policy = context.body
          const row = await context.context.adapter.create<Omit<Row, 'id'>, Row>({
            data: { ...toRow(policy), id: policy.id } as Omit<Row, 'id'>,
            forceAllowId: true,
            model,
          })
          return context.json(fromRow(row))
        },
      ),
      deleteTrustPolicy: createAuthEndpoint(
        '/trust-policies/:id',
        { metadata: { SERVER_ONLY: true }, method: 'DELETE' },
        async (context) => {
          await context.context.adapter.delete({
            model,
            where: [{ field: 'id', value: context.params.id }],
          })
          return context.json({ deleted: true })
        },
      ),
      listTrustPolicies: createAuthEndpoint(
        '/trust-policies',
        { metadata: { SERVER_ONLY: true }, method: 'GET' },
        async (context) => {
          const rows = await context.context.adapter.findMany<Row>({ model })
          return context.json(rows.map(fromRow))
        },
      ),
    },
    id: 'handshakes-token-exchange',
    init(context) {
      if (!context.getPlugin('oauth-provider'))
        throw new Error(
          'tokenExchange() requires oauthProvider(). Add `oauthProvider()` to the plugins before `tokenExchange()`.',
        )
      extendOAuthProvider(context, { grants: { [grantType]: handler } })
    },
    schema: {
      trustPolicy: {
        fields: {
          audience: { required: true, type: 'string' },
          claims: { required: true, type: 'json' },
          clientId: { required: true, type: 'string' },
          issuer: { index: true, required: true, type: 'string' },
          maxLifetime: { required: false, type: 'number' },
          resources: { required: false, type: 'string[]' },
          scopes: { required: true, type: 'string[]' },
        },
      },
    },
  } satisfies BetterAuthPlugin
}

export declare namespace tokenExchange {
  type Options = {
    /** Fetches the keys of subject token issuers. Default: `globalThis.fetch`. */
    fetch?: typeof globalThis.fetch | undefined
    /** Policies in code, in addition to the `trustPolicy` table. Each must name a `clientId`. */
    policies?: readonly Policy.Policy[] | undefined
  }
}

/** A row of the `trustPolicy` table. */
type Row = {
  audience: string
  claims: Policy.Policy['claims']
  clientId: string
  id: string
  issuer: string
  maxLifetime?: number | null | undefined
  resources?: string[] | null | undefined
  scopes: string[]
}

function fromRow(row: Row): Policy.Policy {
  return {
    audience: row.audience,
    claims: row.claims,
    clientId: row.clientId,
    id: row.id,
    issuer: row.issuer,
    ...(typeof row.maxLifetime === 'number' ? { maxLifetime: row.maxLifetime } : {}),
    ...(row.resources ? { resources: row.resources } : {}),
    scopes: row.scopes,
  }
}

function toRow(policy: Stored): Omit<Row, 'id'> {
  return {
    audience: policy.audience,
    claims: policy.claims,
    clientId: policy.clientId,
    issuer: policy.issuer,
    maxLifetime: policy.maxLifetime ?? null,
    resources: policy.resources ? [...policy.resources] : null,
    scopes: [...policy.scopes],
  }
}

/** A policy that the `trustPolicy` table stores. It must name its client. */
type Stored = Policy.Policy & { clientId: string }

/** A Standard Schema of a stored policy, so the endpoint needs no validation library. */
const policySchema: StandardSchemaV1<Stored> = {
  '~standard': {
    validate(value) {
      const issues = (message: string) => ({ issues: [{ message }] })
      if (typeof value !== 'object' || value === null) return issues('The body must be a policy.')

      const policy = value as Record<string, unknown>
      for (const name of ['audience', 'clientId', 'id', 'issuer'])
        if (typeof policy[name] !== 'string' || policy[name] === '')
          return issues(`${name} must be a non-empty string.`)

      const strings = (entry: unknown) =>
        Array.isArray(entry) && entry.every((item) => typeof item === 'string')
      if (!strings(policy['scopes'])) return issues('scopes must be an array of strings.')

      const claims = policy['claims']
      if (
        typeof claims !== 'object' ||
        claims === null ||
        !Object.values(claims).every((entry) => typeof entry === 'string' || strings(entry))
      )
        return issues('claims must map each claim to a string or an array of strings.')
      // A policy without claims matches every token of the issuer and audience.
      if (Object.keys(claims).length === 0) return issues('claims must name at least one claim.')

      const resources = policy['resources']
      if (resources !== undefined && !strings(resources))
        return issues('resources must be an array of strings.')

      const maxLifetime = policy['maxLifetime']
      if (maxLifetime !== undefined && (typeof maxLifetime !== 'number' || maxLifetime <= 0))
        return issues('maxLifetime must be a positive number of seconds.')

      return { value: value as Stored }
    },
    vendor: 'handshakes',
    version: 1,
  },
}
