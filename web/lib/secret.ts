import { timingSafeEqual } from 'node:crypto'

/**
 * Constant-time shared-secret comparison. Kept free of Next.js imports so it
 * can be unit-tested from the repo-root vitest suite.
 */
export function keyMatches(
  key: string | null | undefined,
  secret: string | undefined,
): boolean {
  if (!secret || !key) return false
  const a = Buffer.from(key)
  const b = Buffer.from(secret)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
