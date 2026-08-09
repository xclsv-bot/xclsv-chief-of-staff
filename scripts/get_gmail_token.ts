// One-time OAuth helper: prints an auth URL, catches the loopback redirect, and
// prints the refresh token to paste into .env (GMAIL_ZAIRE_REFRESH_TOKEN or
// GMAIL_ARYA_REFRESH_TOKEN — run once per mailbox, signed in as that account).
//
// Scope note: gmail.modify is the narrowest Google scope covering read + labels +
// archive + drafts. It technically permits send/trash at the API level; the v1
// no-send/no-delete rule is enforced structurally in src/connectors/gmail.ts and
// guarded by tests/gmail-guard.test.ts. Never widen this scope list.

import { google } from 'googleapis'
import http from 'node:http'
import { requireEnv } from '../src/config.js'

const SCOPES = ['https://www.googleapis.com/auth/gmail.modify']
const PORT = 53682

const oauth2 = new google.auth.OAuth2(
  requireEnv('GMAIL_CLIENT_ID'),
  requireEnv('GMAIL_CLIENT_SECRET'),
  `http://localhost:${PORT}/oauth2callback`,
)

const url = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: SCOPES,
})

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url ?? '/', `http://localhost:${PORT}`).searchParams.get('code')
  if (!code) {
    res.writeHead(404).end()
    return
  }
  const { tokens } = await oauth2.getToken(code)
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('Token received — you can close this tab.')
  console.log('\nRefresh token (add to .env, never commit):\n')
  console.log(tokens.refresh_token)
  server.close()
})

server.listen(PORT, () => {
  console.log('Open this URL in a browser signed in as the target mailbox:\n')
  console.log(url)
})
