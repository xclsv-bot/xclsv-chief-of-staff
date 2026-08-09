// Business-day math (UTC-based). Used by asana_router for default due-dates
// and by nudge thresholds — anything that says "3 business days from now."

export function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(from)
  let remaining = days
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1)
    const day = result.getUTCDay()
    if (day !== 0 && day !== 6) remaining--
  }
  return result
}
