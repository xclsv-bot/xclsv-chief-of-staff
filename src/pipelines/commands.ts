// Slack command poller — the on-demand channel counterpart to the voice sweep
// tool. Runs every minute via cron: scans recent #inbox-gps messages for a
// sweep request FROM ZAIRE (hard rule 5 — nobody else's messages are commands),
// runs the sweep in-process, and replies in-thread with the summary.
//
// Polling (not slash commands) because the app is served inside the tailnet —
// Slack's servers can't reach it, so commands come in as ordinary messages:
// "sweep", "run a sweep", "refresh the inbox", "triage now".

import { optionalEnv, requireEnv } from '../config.js'
import {
  fetchHistory,
  postAlert,
  postThreadReply,
  slackClient,
} from '../connectors/slack.js'
import { StateStore } from '../state.js'
import { runSweep, summarizeSweep } from './triage.js'

export function isSweepCommand(text: string): boolean {
  return /\b(sweep|triage now|refresh (the )?(inbox|labels|emails?))\b/i.test(text.trim())
}

async function run(): Promise<void> {
  const store = new StateStore(optionalEnv('STATE_DB_PATH', 'data/state.db'))
  const slack = slackClient(requireEnv('SLACK_BOT_TOKEN'))
  const channel = requireEnv('SLACK_INBOX_GPS_CHANNEL_ID')
  const zaireId = requireEnv('ZAIRE_SLACK_USER_ID')

  const lookbackMinutes = Number(optionalEnv('COMMANDS_LOOKBACK_MINUTES', '10'))
  const oldest = ((Date.now() - lookbackMinutes * 60_000) / 1000).toFixed(6)
  const messages = await fetchHistory(slack, channel, oldest)
  const commands = messages.filter(
    (m) =>
      m.user === zaireId &&
      !m.threadTs &&
      !store.isHandled(m.ts) &&
      isSweepCommand(m.text),
  )
  if (commands.length === 0) {
    store.close()
    return
  }

  // Multiple asks in the window collapse into one sweep; every ask gets the answer.
  for (const message of commands) store.markHandled(message.ts)
  store.close() // runSweep opens its own handle

  try {
    const result = await runSweep({
      dryRun: false,
      maxThreads: Number(optionalEnv('TRIAGE_MAX_THREADS', '100')),
    })
    const summary = `Sweep done, ${result.candidates} threads checked. ${summarizeSweep(result)}`
    for (const message of commands) {
      await postThreadReply(slack, channel, message.ts, summary)
    }
    console.log(`on-demand sweep via Slack: ${summary}`)
  } catch (error) {
    await postAlert(`on-demand sweep failed: ${(error as Error).message}`)
    throw error
  }
}

const isMain =
  process.argv[1]?.endsWith('commands.ts') || process.argv[1]?.endsWith('commands.js')
if (isMain) {
  run().catch((error) => {
    console.error('[alert] command poll failed:', error)
    process.exit(1)
  })
}
