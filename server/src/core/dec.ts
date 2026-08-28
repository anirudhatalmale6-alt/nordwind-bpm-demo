/**
 * Fixed-point decimal arithmetic on BigInt micro-units (6 dp), matching the
 * NUMERIC(18,6) columns in the schema.
 *
 * Why this exists: JavaScript numbers are IEEE-754 doubles. 0.1 + 0.2 is
 * 0.30000000000000004, and once you have summed a few thousand PO lines the
 * error is visible in exactly the report management looks at. Money never
 * touches a float in this codebase — it comes out of PostgreSQL as a string and
 * stays a string, with the arithmetic done here.
 */

const SCALE = 6n
const UNIT = 10n ** SCALE

export type Dec = bigint

export function parse(v: string | number | null | undefined): Dec {
  if (v === null || v === undefined) return 0n
  const s = String(v).trim()
  if (s === '') return 0n
  const neg = s.startsWith('-')
  const body = neg ? s.slice(1) : s
  const [intPart = '0', fracRaw = ''] = body.split('.')
  const frac = (fracRaw + '000000').slice(0, 6)
  const value = BigInt(intPart) * UNIT + BigInt(frac || '0')
  return neg ? -value : value
}

export function format(d: Dec, dp = 2): string {
  const neg = d < 0n
  const abs = neg ? -d : d
  // Round half-up at the requested number of decimal places.
  const shift = 10n ** (SCALE - BigInt(dp))
  const rounded = (abs + shift / 2n) / shift
  const unitAtDp = 10n ** BigInt(dp)
  const int = rounded / unitAtDp
  const frac = rounded % unitAtDp
  const fracStr = dp > 0 ? '.' + frac.toString().padStart(dp, '0') : ''
  return (neg && rounded !== 0n ? '-' : '') + int.toString() + fracStr
}

export function add(a: Dec, b: Dec): Dec {
  return a + b
}

export function sub(a: Dec, b: Dec): Dec {
  return a - b
}

/** Multiply two 6-dp fixed-point values, re-normalising the scale. */
export function mul(a: Dec, b: Dec): Dec {
  const raw = a * b
  const neg = raw < 0n
  const abs = neg ? -raw : raw
  const q = (abs + UNIT / 2n) / UNIT
  return neg ? -q : q
}

export function sum(values: Dec[]): Dec {
  let t = 0n
  for (const v of values) t += v
  return t
}

/**
 * A line total: quantity x unit price, rounded to 2 dp ONCE, here. The document
 * total is then the sum of already-rounded line totals — not the rounding of an
 * unrounded sum. Do it the other way round and the printed PO does not add up,
 * and the supplier queries it.
 */
export function lineTotal(qty: string, unitPrice: string): Dec {
  return parse(format(mul(parse(qty), parse(unitPrice)), 2))
}

/** Percentage of a over b, as a plain number for display only. */
export function pct(a: Dec, b: Dec): number | null {
  if (b === 0n) return null // A rate with a zero denominator is undefined, not 0.
  return Number((a * 10000n) / b) / 100
}

export const zero: Dec = 0n
