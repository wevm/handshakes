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

      // The owner writes a nonce, so it removes only its own lock, never one that replaced it.
      const lock = `${path(key)}.lock`
      const nonce = Crypto.randomUUID()
      const start = Date.now()
      while (true) {
        try {
          await Fs.writeFile(lock, nonce, { flag: 'wx', mode: 0o600 })
          break
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        }

        if (await takeOver(lock)) continue
        if (Date.now() - start > lockTimeout) throw new LockTimeoutError({ key })
        await new Promise((resolve) => setTimeout(resolve, 25))
      }

      // A live owner touches the lock, so a slow refresh never looks stale to another process.
      const heartbeat = setInterval(() => {
        const now = new Date()
        Fs.utimes(lock, now, now).catch(() => {})
      }, staleAfter / 3)
      heartbeat.unref()

      try {
        return await fn()
      } finally {
        clearInterval(heartbeat)
        const owner = await Fs.readFile(lock, 'utf8').catch(() => undefined)
        if (owner === nonce) await Fs.rm(lock, { force: true })
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

/**
 * Removes `lock` when its owner stopped, and returns whether it did. The lock moves to a unique name
 * first, so of several waiters only one removes it. A lock that turns out fresh moves back.
 */
async function takeOver(lock: string): Promise<boolean> {
  const held = await Fs.stat(lock).then(
    (stat) => Date.now() - stat.mtimeMs,
    () => 0,
  )
  if (held <= staleAfter) return false

  const moved = `${lock}.${Crypto.randomUUID()}.stale`
  try {
    await Fs.rename(lock, moved)
  } catch {
    // Another waiter moved it first.
    return false
  }

  const stale = await Fs.stat(moved).then((stat) => Date.now() - stat.mtimeMs > staleAfter)
  // A fresh lock replaced the stale one before the rename. `link` restores it unless a new lock exists.
  if (!stale) await Fs.link(moved, lock).catch(() => {})
  await Fs.rm(moved, { force: true })
  return stale
}
