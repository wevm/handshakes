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
  /**
   * Longest age of the subject token, from its `iat`, in seconds. A token without `iat` is refused.
   * Default: any age.
   */
  maxAge?: number | undefined
  /** Longest lifetime of the issued credential, in seconds. It also ends no later than the subject token. */
  maxLifetime?: number | undefined
  /**
   * RFC 8707 resources that a request may name. A request for another resource receives
   * `invalid_target`. Default: none, so a request that names a resource is refused.
   */
  resources?: readonly string[] | undefined
  /** Scopes of the issued credential. A request may ask for a subset. */
  scopes: readonly string[]
}

/**
 * Returns a policy for an Azure managed identity. It matches `tid` and `oid`, the IDs of the tenant
 * and the identity, never a name.
 */
export function azure(options: azure.Options): Policy {
  return {
    audience: options.audience,
    claims: { oid: options.objectId, tid: options.tenantId },
    ...optional(options),
    id: options.id ?? `azure:${options.tenantId}:${options.objectId}`,
    issuer: options.issuer ?? `https://login.microsoftonline.com/${options.tenantId}/v2.0`,
    scopes: options.scopes,
  }
}

export declare namespace azure {
  type Options = Shared & {
    /** `aud` of the token. For a v2.0 token, the application (client) ID of the resource. */
    audience: string
    /** Default: derived from the tenant ID and the object ID. */
    id?: string | undefined
    /**
     * Default: `https://login.microsoftonline.com/<tenantId>/v2.0`. A v1.0 token carries
     * `https://sts.windows.net/<tenantId>/`.
     */
    issuer?: string | undefined
    /** `oid`, the object ID of the managed identity. */
    objectId: string
    /** `tid`, the ID of the Microsoft Entra tenant. */
    tenantId: string
  }
}

/**
 * Returns a policy for CircleCI. It matches `oidc.circleci.com/project-id`, never the name of the
 * project. The issuer is the organization issuer.
 */
export function circleci(options: circleci.Options): Policy {
  return {
    audience: options.audience ?? options.organizationId,
    claims: {
      'oidc.circleci.com/project-id': options.projectId,
      ...(options.ref ? { 'oidc.circleci.com/vcs-ref': options.ref } : {}),
    },
    ...optional(options),
    id: options.id ?? `circleci:${options.projectId}:${options.ref ?? '*'}`,
    issuer: options.issuer ?? `https://oidc.circleci.com/org/${options.organizationId}`,
    scopes: options.scopes,
  }
}

export declare namespace circleci {
  type Options = Shared & {
    /** `aud` of the token. Default: the organization ID, the `aud` of `CIRCLE_OIDC_TOKEN_V2`. */
    audience?: string | undefined
    /** Default: derived from the project ID and `ref`. */
    id?: string | undefined
    /** Default: `https://oidc.circleci.com/org/<organizationId>`. */
    issuer?: string | undefined
    /** ID of the CircleCI organization. */
    organizationId: string
    /** ID of the CircleCI project. */
    projectId: string
    /** Git ref of the job, such as `refs/heads/main`. Default: any ref. */
    ref?: string | undefined
  }
}

/** Returns `policy` unchanged, typed as a policy. */
export function from(policy: Policy): Policy {
  return policy
}

/**
 * Returns a policy for a Google Cloud service account. It matches `sub`, the unique ID of the
 * service account, never its email, which a re-created account can take.
 */
export function gcp(options: gcp.Options): Policy {
  return {
    audience: options.audience,
    claims: { sub: options.serviceAccountId },
    ...optional(options),
    id: options.id ?? `gcp:${options.serviceAccountId}`,
    issuer: options.issuer ?? 'https://accounts.google.com',
    scopes: options.scopes,
  }
}

export declare namespace gcp {
  type Options = Shared & {
    /** `aud` that the workload requests. */
    audience: string
    /** Default: derived from the service account ID. */
    id?: string | undefined
    /** Default: `https://accounts.google.com`. */
    issuer?: string | undefined
    /** Unique ID of the service account, a number, which is the `sub` of its tokens. */
    serviceAccountId: string
  }
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
    ...optional(options),
    id: options.id ?? `githubActions:${options.repositoryId}:${options.ref ?? '*'}`,
    issuer: options.issuer ?? 'https://token.actions.githubusercontent.com',
    scopes: options.scopes,
  }
}

export declare namespace githubActions {
  type Options = Shared & {
    /** `aud` that the job requests. */
    audience: string
    /** GitHub deployment environment of the job, such as `production`. */
    environment?: string | undefined
    /** Default: derived from the repository ID and `ref`. */
    id?: string | undefined
    /** Default: `https://token.actions.githubusercontent.com`. */
    issuer?: string | undefined
    /** Git ref of the job, such as `refs/heads/main`. Default: any ref. */
    ref?: string | undefined
    /** `repository_id` of the repository, which stays the same after a rename. */
    repositoryId: string
  }
}

/**
 * Returns a policy for GitLab CI. It matches `project_id`, which a renamed or re-created project does
 * not keep, never the project path.
 */
export function gitlab(options: gitlab.Options): Policy {
  return {
    audience: options.audience,
    claims: {
      project_id: options.projectId,
      ...(options.environment ? { environment: options.environment } : {}),
      ...(options.ref ? { ref: options.ref } : {}),
      ...(options.refType ? { ref_type: options.refType } : {}),
    },
    ...optional(options),
    id: options.id ?? `gitlab:${options.projectId}:${options.ref ?? '*'}`,
    issuer: options.issuer ?? 'https://gitlab.com',
    scopes: options.scopes,
  }
}

export declare namespace gitlab {
  type Options = Shared & {
    /** `aud` that `id_tokens` declares. */
    audience: string
    /** GitLab environment of the job, such as `production`. */
    environment?: string | undefined
    /** Default: derived from the project ID and `ref`. */
    id?: string | undefined
    /** Default: `https://gitlab.com`. Set it for a self-managed instance. */
    issuer?: string | undefined
    /** `project_id` of the project, which stays the same after a rename. */
    projectId: string
    /** Branch or tag of the job, such as `main`. Default: any ref. */
    ref?: string | undefined
    /** `branch` or `tag`. A branch and a tag can have the same name. Default: either. */
    refType?: 'branch' | 'tag' | undefined
  }
}

/**
 * Returns a policy for a Kubernetes service account. It matches `sub`,
 * `system:serviceaccount:<namespace>:<serviceAccount>`. The issuer of the cluster must serve a
 * public discovery document.
 */
export function kubernetes(options: kubernetes.Options): Policy {
  return {
    audience: options.audience,
    claims: { sub: `system:serviceaccount:${options.namespace}:${options.serviceAccount}` },
    ...optional(options),
    id: options.id ?? `kubernetes:${options.namespace}:${options.serviceAccount}`,
    issuer: options.issuer,
    scopes: options.scopes,
  }
}

export declare namespace kubernetes {
  type Options = Shared & {
    /** `aud` of the projected service account token. */
    audience: string
    /** Default: derived from the namespace and the service account. */
    id?: string | undefined
    /** Service account issuer of the cluster, such as the OIDC issuer of an EKS cluster. */
    issuer: string
    /** Namespace of the service account. */
    namespace: string
    /** Name of the service account. */
    serviceAccount: string
  }
}

/**
 * Returns a policy for Vercel. It matches `owner_id` and `project_id`, never the team or project
 * name. Without `environment`, preview and production deployments match alike.
 */
export function vercel(options: vercel.Options): Policy {
  const issuer =
    options.issuer ?? (options.team ? `https://oidc.vercel.com/${options.team}` : undefined)
  if (!issuer)
    throw new TypeError(
      'Set `team` for the issuer `https://oidc.vercel.com/<team>`, or set `issuer` for a custom issuer.',
    )

  return {
    audience: options.audience,
    claims: {
      owner_id: options.ownerId,
      project_id: options.projectId,
      ...(options.environment ? { environment: options.environment } : {}),
    },
    ...optional(options),
    id: options.id ?? `vercel:${options.projectId}:${options.environment ?? '*'}`,
    issuer,
    scopes: options.scopes,
  }
}

export declare namespace vercel {
  type Options = Shared & {
    /** `aud` that the deployment requests. */
    audience: string
    /** `development`, `preview`, `production`, or a custom environment. Default: any. */
    environment?: string | undefined
    /** Default: derived from the project ID and the environment. */
    id?: string | undefined
    /** Default: `https://oidc.vercel.com/<team>`, the team issuer. */
    issuer?: string | undefined
    /** `owner_id` of the team. */
    ownerId: string
    /** `project_id` of the project. */
    projectId: string
    /** Slug of the team, for the team issuer. */
    team?: string | undefined
  }
}

/** Options of every preset. */
type Shared = {
  /** OAuth client that receives the issued token. */
  clientId?: string | undefined
  /** Longest age of the subject token, from its `iat`, in seconds. */
  maxAge?: number | undefined
  /** In seconds. */
  maxLifetime?: number | undefined
  /** RFC 8707 resources that a request may name. */
  resources?: readonly string[] | undefined
  scopes: readonly string[]
}

/** Returns the fields of `options` that every preset copies when they are set. */
function optional(options: Shared): Partial<Policy> {
  return {
    ...(options.clientId ? { clientId: options.clientId } : {}),
    ...(options.maxAge ? { maxAge: options.maxAge } : {}),
    ...(options.maxLifetime ? { maxLifetime: options.maxLifetime } : {}),
    ...(options.resources ? { resources: options.resources } : {}),
  }
}
