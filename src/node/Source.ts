/** @module Sources that read the file system, such as a Kubernetes projected service account token. */
import * as Fs from 'node:fs'
import type * as Source from '../Source.js'

/**
 * Reads a token from a file, such as a Kubernetes projected service account token. The audience is
 * fixed where the file is projected, so the token must already carry the requested audience.
 */
export function file(options: file.Options): Source.Source {
  return {
    detect: () => Fs.existsSync(options.path),
    name: options.name ?? 'file',
    async token() {
      return (await Fs.promises.readFile(options.path, 'utf8')).trim()
    },
  }
}

export declare namespace file {
  type Options = {
    /** Name in `Token.source` and errors. Default: `file`. */
    name?: string | undefined
    /** Path of the token file. */
    path: string
  }
}
