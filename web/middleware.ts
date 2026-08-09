// First visit with ?k=<secret>: set the HttpOnly cookie and redirect to a
// clean URL so the secret drops out of the address bar (spec §10). Pages render
// regardless (they hold nothing sensitive); every /api route checks auth.

import { NextResponse, type NextRequest } from 'next/server'
import { keyMatches } from './lib/secret'

export function middleware(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('k')
  if (keyMatches(key, process.env.VOICE_SHARED_SECRET)) {
    const clean = request.nextUrl.clone()
    clean.searchParams.delete('k')
    const response = NextResponse.redirect(clean)
    response.cookies.set('arya_secret', key, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
    })
    return response
  }
  return NextResponse.next()
}

export const config = { matcher: ['/', '/api/:path*'] }
