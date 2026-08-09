/** Pure shared-secret comparison — kept free of Next.js imports for testing. */
export function keyMatches(
  key: string | null | undefined,
  secret: string | undefined,
): boolean {
  return !!secret && !!key && key === secret
}
