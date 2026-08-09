/**
 * Constant-time shared-secret comparison. Runs in BOTH the Edge runtime
 * (middleware) and Node (API routes), so no node:crypto — a XOR-accumulate
 * loop gives the same timing-safety without the import. Kept free of Next.js
 * imports so it can be unit-tested from the repo-root vitest suite.
 */
export function keyMatches(
  key: string | null | undefined,
  secret: string | undefined,
): boolean {
  if (!secret || !key) return false
  const encoder = new TextEncoder()
  const a = encoder.encode(key)
  const b = encoder.encode(secret)
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}
