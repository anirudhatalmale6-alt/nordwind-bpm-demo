import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, unlink, stat } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { dirname, join, resolve, sep } from 'node:path'
import type { Readable } from 'node:stream'

/**
 * File storage.
 *
 * Files live outside the web root and nginx never serves them. Downloads go
 * through an authenticated endpoint that checks permission on the owning record
 * and then streams the bytes, so a leaked URL is worthless and there is no
 * directory to walk.
 *
 * Swapping this module for S3/MinIO is a change to this file alone — the rest
 * of the application only ever sees an opaque storage path.
 */

export const STORAGE_ROOT = resolve(
  process.env.STORAGE_ROOT ?? join(process.cwd(), '..', '.storage'),
)

/** 15 MB. Enough for a scanned PO, small enough that nobody parks a video here. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024

/**
 * What we accept, by extension AND by what the first bytes actually say. An
 * extension is a claim made by whoever uploaded the file; the magic bytes are
 * evidence. Both have to agree.
 */
const ALLOWED: Record<string, { mime: string; sniff: (b: Buffer) => boolean }> = {
  pdf: { mime: 'application/pdf', sniff: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  png: { mime: 'image/png', sniff: (b) => b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' },
  jpg: { mime: 'image/jpeg', sniff: (b) => b.subarray(0, 3).toString('hex') === 'ffd8ff' },
  jpeg: { mime: 'image/jpeg', sniff: (b) => b.subarray(0, 3).toString('hex') === 'ffd8ff' },
  // docx/xlsx are ZIP containers, so the signature is PK\x03\x04.
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sniff: (b) => b.subarray(0, 4).toString('hex') === '504b0304',
  },
  xlsx: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sniff: (b) => b.subarray(0, 4).toString('hex') === '504b0304',
  },
  csv: { mime: 'text/csv', sniff: isProbablyText },
  txt: { mime: 'text/plain', sniff: isProbablyText },
}

/** No NUL bytes in the first chunk is a good enough test for "this is text". */
function isProbablyText(b: Buffer): boolean {
  return !b.subarray(0, 512).includes(0)
}

export function extensionOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i === -1 ? '' : filename.slice(i + 1).toLowerCase()
}

export function isAllowedExtension(filename: string): boolean {
  return extensionOf(filename) in ALLOWED
}

export const ALLOWED_EXTENSIONS = Object.keys(ALLOWED)

export interface StoredFile {
  storedName: string
  storagePath: string // relative to STORAGE_ROOT
  mimeType: string
  byteSize: number
  sha256: string
}

export class UploadRejected extends Error {}

/**
 * Streams an upload to disk, hashing as it goes, and refuses anything whose
 * first bytes do not match the extension it claims.
 *
 * Written to a temporary name first and renamed on success, so a failed or
 * oversized upload never leaves a half-written file that looks complete.
 */
export async function storeUpload(
  source: Readable,
  originalFilename: string,
  now: Date,
): Promise<StoredFile> {
  const ext = extensionOf(originalFilename)
  const rule = ALLOWED[ext]
  if (!rule) {
    throw new UploadRejected(
      `Files of type .${ext || '(none)'} are not accepted. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}.`,
    )
  }

  const stored = `${randomUUID()}.${ext}`
  const rel = join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'), stored)
  const abs = safeJoin(rel)
  const tmp = `${abs}.part`

  await mkdir(dirname(abs), { recursive: true })

  const hash = createHash('sha256')
  let size = 0
  let head: Buffer = Buffer.alloc(0)
  let rejected: UploadRejected | null = null

  const out = createWriteStream(tmp)
  try {
    await pipeline(source, async function* (chunks) {
      for await (const chunk of chunks) {
        const buf = chunk as Buffer
        size += buf.length
        if (size > MAX_UPLOAD_BYTES) {
          rejected = new UploadRejected(
            `File is larger than the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit.`,
          )
          throw rejected
        }
        if (head.length < 512) head = Buffer.concat([head, buf.subarray(0, 512)])
        hash.update(buf)
        yield buf
      }
    }, out)
  } catch (err) {
    await unlink(tmp).catch(() => {})
    throw rejected ?? err
  }

  if (size === 0) {
    await unlink(tmp).catch(() => {})
    throw new UploadRejected('The file is empty.')
  }

  if (!rule.sniff(head)) {
    await unlink(tmp).catch(() => {})
    throw new UploadRejected(
      `This file does not look like a .${ext} — its contents do not match its extension.`,
    )
  }

  await rename(tmp, abs)

  return {
    storedName: stored,
    storagePath: rel.split(sep).join('/'),
    mimeType: rule.mime,
    byteSize: size,
    sha256: hash.digest('hex'),
  }
}

/**
 * Resolves a stored path and refuses anything that lands outside the storage
 * root.
 *
 * The path came out of the database, and a path out of the database is data,
 * not a promise. I have watched a cleanup routine follow a bad one out of the
 * storage directory entirely and start deleting things that were not its own.
 * Every read and every unlink goes through here.
 */
export function safeJoin(relativePath: string): string {
  const abs = resolve(STORAGE_ROOT, relativePath)
  if (abs !== STORAGE_ROOT && !abs.startsWith(STORAGE_ROOT + sep)) {
    throw new Error(`Refusing to touch a path outside the storage root: ${relativePath}`)
  }
  return abs
}

export async function fileExists(relativePath: string): Promise<boolean> {
  try {
    await stat(safeJoin(relativePath))
    return true
  } catch {
    return false
  }
}

/** Used by the reaper, never by a request handler. */
export async function removeBlob(relativePath: string): Promise<void> {
  await unlink(safeJoin(relativePath))
}

/**
 * Filenames go back to the browser in a Content-Disposition header. Anything
 * that could break out of the quoting is stripped, and the RFC 5987 form
 * carries the original for anyone who can read it.
 */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
