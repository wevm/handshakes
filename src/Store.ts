/** @module Persistence of grants, with a lock that serializes refreshes. */
import type * as Grant from './Grant.js'

/** Persists grants by key. `Client` uses the issuer and the client ID as the key. */
export type Store = {
  /** Removes the grant. */
  delete: (key: string) => Promise<void>
  /** Returns the grant, if one is stored. */
  get: (key: string) => Promise<Grant.Grant | undefined>
  /**
   * Runs `fn` under a lock for `key`. A refresh runs under the lock, since a server can revoke every
   * grant of the client and user when a refresh token is used twice.
   */
  lock: <result>(key: string, fn: () => Promise<result>) => Promise<result>
  /** Writes the grant. */
  set: (key: string, grant: Grant.Grant) => Promise<void>
}

/** Returns `store` unchanged, typed as a store. */
export function from(store: Store): Store {
  return store
}

/** Returns a store that keeps grants in memory, for one process. */
export function memory(): Store {
  const grants = new Map<string, Grant.Grant>()
  const locks = new Map<string, Promise<unknown>>()

  return {
    async delete(key) {
      grants.delete(key)
    },
    async get(key) {
      return grants.get(key)
    },
    lock(key, fn) {
      // Each call waits for the previous one for the key, whether it resolved or rejected.
      const run = (locks.get(key) ?? Promise.resolve()).then(
        () => fn(),
        () => fn(),
      )
      locks.set(
        key,
        run.catch(() => undefined),
      )
      return run
    },
    async set(key, grant) {
      grants.set(key, grant)
    },
  }
}
