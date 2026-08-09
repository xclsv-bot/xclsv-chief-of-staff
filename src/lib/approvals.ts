// Emoji reactions Zaire uses to approve a draft in the Slack approval thread.
// Consumed by call_ingest (and previously the memo pipeline). Multiple values
// so ✅ (white_check_mark) and ✔️ (heavy_check_mark) both count.

export const APPROVE_EMOJI = ['white_check_mark', 'heavy_check_mark']
