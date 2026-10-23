/** @module A store that keeps grants in files, with a lock that covers every process of the user. */
import * as Crypto from 'node:crypto'
import * as Fs from 'node:fs/promises'
import * as Os from 'node:os'
import * as Path from 'node:path'
import type * as Grant from '../Grant.js'
import * as Errors from '../internal/Errors.js'
import type * as Store from '../Store.js'

/** A lock older than this is from a process that stopped, and is removed. */
const staleAfter = 30_000

/**
 * Returns a store that writes each grant to a file with mode 0600, atomically. The lock is a file
 * that `open` creates exclusively, so it covers every process that shares the directory.
 */
export function file(options: file.Options = {}): Store.Store {
  const directory =
    options.directory ??
    Path.join(
      process.env['XDG_CONFIG_HOME'] ?? Path.join(Os.homedir(), '.config'),
      'handshakes',
      'grants',
    )
  const lockTimeout = options.lockTimeout ?? 10_000

  // The key holds URLs, so the file name is a hash of it.
  const path = (key: string) =>
    Path.join(
      directory,
      `${Crypto.createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`,
    )

  return {
    async delete(key) {
      await Fs.rm(path(key), { force: true })
    },
    async get(key) {
      try {
        return JSON.parse(await Fs.readFile(path(key), 'utf8')) as Grant.Grant
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
    },
    async lock(key, fn) {
      await Fs.mkdir(directory, { mode: 0o700, recursive: true })

      const lock = `${path(key)}.lock`
      const start = Date.now()
      while (true) {
        try {
          await (await Fs.open(lock, 'wx', 0o600)).close()
          break
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        }

        const held = await Fs.stat(lock).then(
          (stat) => Date.now() - stat.mtimeMs,
          () => 0,
        )
        if (held > staleAfter) {
          await Fs.rm(lock, { force: true })
          continue
        }
        if (Date.now() - start > lockTimeout) throw new LockTimeoutError({ key })
        await new Promise((resolve) => setTimeout(resolve, 25))
      }

      try {
        return await fn()
      } finally {
        await Fs.rm(lock, { force: true })
      }
    },
    async set(key, grant) {
      await Fs.mkdir(directory, { mode: 0o700, recursive: true })

      // A rename replaces the file atomically, so a reader never sees a partial grant.
      const target = path(key)
      const temporary = `${target}.${process.pid}.${Crypto.randomUUID()}.tmp`
      await Fs.writeFile(temporary, JSON.stringify(grant), { mode: 0o600 })
      await Fs.rename(temporary, target)
    },
  }
}

export declare namespace file {
  type Options = {
    /** Directory of the grant files. Default: `$XDG_CONFIG_HOME/handshakes/grants`, else `~/.config/handshakes/grants`. */
    directory?: string | undefined
    /** How long to wait for the lock, in milliseconds. Default: 10000. */
    lockTimeout?: number | undefined
  }
}

/** Thrown when another process holds the lock longer than `lockTimeout`. */
export class LockTimeoutError extends Errors.BaseError {
  override name = 'Store.LockTimeoutError'

  /** The store key. */
  readonly key: string

  constructor(options: { key: string }) {
    super('Another process holds the lock of the grant.', {
      steps: [
        'Wait for the other process to finish, then run the command again.',
        'If no other process runs, delete the `.lock` file in the grant directory.',
      ],
    })
    this.key = options.key
  }
}
