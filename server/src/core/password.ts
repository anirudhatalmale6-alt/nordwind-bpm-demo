import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

/**
 * scrypt from the Node standard library, with per-password salt.
 *
 * In the production system this is Argon2id (the current OWASP first choice),
 * which needs a native module. scrypt is used here so the demo installs and
 * runs anywhere with no build toolchain — it is a memory-hard KDF and a
 * perfectly respectable choice, just not my first one.
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(plain, salt, 64)
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false
  const key = await scrypt(plain, Buffer.from(saltHex, 'hex'), 64)
  const expected = Buffer.from(keyHex, 'hex')
  // Constant-time compare: a plain === would leak the hash a byte at a time.
  return key.length === expected.length && timingSafeEqual(key, expected)
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Sessions are stored hashed. If someone walks off with a database dump they
 * still cannot use the tokens in it — the same reason passwords are not stored
 * in plain text.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
