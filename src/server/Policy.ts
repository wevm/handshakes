/** @module Trust policies: the rules that map the issuer and claims of a subject token to scopes and a lifetime. */

/** A trust policy. */
export type Policy = {
  /** Exact `aud` that the subject token must carry. */
  audience: string
  /** Exact claim matches. An array matches any of its values. Numbers in the token compare as strings. */
  claims: Readonly<Record<string, string | readonly string[]>>
  /** OAuth client that receives the issued token. The Better Auth adapter requires it. */
  clientId?: string | undefined
  /** Identifier of the policy. */
  id: string
  /** Exact `iss` of the subject token. The keys come from its discovery document. */
  issuer: string
  /** Longest lifetime of the issued credential, in seconds. It also ends no later than the subject token. */
  maxLifetime?: number | undefined
  /** Scopes of the issued credential. A request may ask for a subset. */
  scopes: readonly string[]
}

/** Returns `policy` unchanged, typed as a policy. */
export function from(policy: Policy): Policy {
  return policy
}

/**
 * Returns a policy for GitHub Actions. It matches `repository_id`, which a renamed or re-created
 * repository does not keep, never the repository name.
 */
export function githubActions(options: githubActions.Options): Policy {
  return {
    audience: options.audience,
    claims: {
      repository_id: options.repositoryId,
      ...(options.environment ? { environment: options.environment } : {}),
      ...(options.ref ? { ref: options.ref } : {}),
    },
    ...(options.clientId ? { clientId: options.clientId } : {}),
    id: options.id ?? `githubActions:${options.repositoryId}:${options.ref ?? '*'}`,
    issuer: options.issuer ?? 'https://token.actions.githubusercontent.com',
    ...(options.maxLifetime ? { maxLifetime: options.maxLifetime } : {}),
    scopes: options.scopes,
  }
}

export declare namespace githubActions {
  type Options = {
    /** `aud` that the job requests. */
    audience: string
    /** OAuth client that receives the issued token. */
    clientId?: string | undefined
    /** GitHub deployment environment of the job, such as `production`. */
    environment?: string | undefined
    /** Default: derived from the repository ID and `ref`. */
    id?: string | undefined
    /** Default: `https://token.actions.githubusercontent.com`. */
    issuer?: string | undefined
    /** In seconds. */
    maxLifetime?: number | undefined
    /** Git ref of the job, such as `refs/heads/main`. Default: any ref. */
    ref?: string | undefined
    /** `repository_id` of the repository, which stays the same after a rename. */
    repositoryId: string
    scopes: readonly string[]
  }
}

/**
 * Returns a policy for Vercel. It matches `owner_id` and `project_id`, never the team or project
 * name. Without `environment`, preview and production deployments match alike.
 */
export function vercel(options: vercel.Options): Policy {
  const issuer =
    options.issuer ?? (options.team ? `https://oidc.vercel.com/${options.team}` : undefined)
  if (!issuer) throw new TypeError('Set `team` or `issuer`.')

  return {
    audience: options.audience,
    claims: {
      owner_id: options.ownerId,
      project_id: options.projectId,
      ...(options.environment ? { environment: options.environment } : {}),
    },
    ...(options.clientId ? { clientId: options.clientId } : {}),
    id: options.id ?? `vercel:${options.projectId}:${options.environment ?? '*'}`,
    issuer,
    ...(options.maxLifetime ? { maxLifetime: options.maxLifetime } : {}),
    scopes: options.scopes,
  }
}

export declare namespace vercel {
  type Options = {
    /** `aud` that the deployment requests. */
    audience: string
    /** OAuth client that receives the issued token. */
    clientId?: string | undefined
    /** `development`, `preview`, `production`, or a custom environment. Default: any. */
    environment?: string | undefined
    /** Default: derived from the project ID and the environment. */
    id?: string | undefined
    /** Default: `https://oidc.vercel.com/<team>`, the team issuer. */
    issuer?: string | undefined
    /** In seconds. */
    maxLifetime?: number | undefined
    /** `owner_id` of the team. */
    ownerId: string
    /** `project_id` of the project. */
    projectId: string
    scopes: readonly string[]
    /** Slug of the team, for the team issuer. */
    team?: string | undefined
  }
}
