// Shared-secret auth (spec §10). Single user (Zaire); the secret arrives once
// as ?k=<secret> and lives on as an HttpOnly cookie set by middleware.ts.

import { cookies } from 'next/headers'
import { keyMatches } from './secret'

export async function checkAuth(request: Request): Promise<boolean> {
  const url = new URL(request.url)
  const key =
    url.searchParams.get('k') ?? (await cookies()).get('arya_secret')?.value
  return keyMatches(key, process.env.VOICE_SHARED_SECRET)
}
