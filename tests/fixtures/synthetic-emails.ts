// Synthetic triage fixtures (CLAUDE.md testing expectations): ~30 emails covering
// every label and tie-breaker in spec §3. All names, companies, and content are
// invented — never test against real partner threads.
//
// CLASSIFY_FIXTURES exercise the judgment layer (LLM, tests/triage.eval.test.ts).
// DETERMINISTIC_FIXTURES exercise decideAction (pure, tests/triage.test.ts):
// 3-Waiting is assigned mechanically, never by the model.

import type { MessageSummary, ThreadSummary } from '../../src/connectors/gmail.js'
import type { GpsLabel } from '../../src/state.js'

export const ZAIRE = 'Zaire Williams <zaire@xclsvmedia.com>'

let nextMessageId = 0
function msg(partial: Partial<MessageSummary> & { from: string; body: string }): MessageSummary {
  return {
    id: `m${++nextMessageId}`,
    to: ZAIRE,
    cc: '',
    date: 'Fri, 7 Aug 2026 09:00:00 -0700',
    rfcMessageId: `<m${nextMessageId}@mail.example.com>`,
    attachments: [],
    ...partial,
  }
}

function thread(id: string, subject: string, messages: MessageSummary[]): ThreadSummary {
  return { id, subject, messages }
}

export interface ClassifyFixture {
  id: string
  tags: string[]
  thread: ThreadSummary
  expected: {
    label: GpsLabel
    /** Fixture is intentionally ambiguous — a low-confidence flag is correct. */
    lowConfidenceOk?: boolean
    needsReading?: boolean
  }
}

export const CLASSIFY_FIXTURES: ClassifyFixture[] = [
  // ── 1-Respond ────────────────────────────────────────────────────────────
  {
    id: 'direct-question-partner',
    tags: ['1-Respond', 'direct-question'],
    thread: thread('t01', 'September slate scope', [
      msg({
        from: 'Luis Herrera <luis@outlierpicks.example.com>',
        body: 'Hey Zaire — can you confirm the September slate scope so we can lock creators? Need your call by Wednesday.',
      }),
    ]),
    expected: { label: '1-Respond' },
  },
  {
    id: 'money-invoice-question',
    tags: ['1-Respond', 'money'],
    thread: thread('t02', 'Q3 invoice discrepancy', [
      msg({
        from: 'AP Team <ap@grandbet.example.com>',
        body: 'Zaire, invoice 1042 shows a different amount than our PO. Can you confirm the correct total before we process payment?',
      }),
    ]),
    expected: { label: '1-Respond' },
  },
  {
    id: 'contract-redlines-attachment',
    tags: ['1-Respond', 'contract', 'needs-reading'],
    thread: thread('t03', 'MSA redlines — please review', [
      msg({
        from: 'Dana Cole <dana.cole@rebetlegal.example.com>',
        body: 'Attached are our redlines on the master services agreement. Sections 4 and 9 have material changes. Please review and confirm.',
        attachments: ['XCLSV_MSA_redlines_v3.docx'],
      }),
    ]),
    expected: { label: '1-Respond', needsReading: true },
  },
  {
    id: 'deal-decision',
    tags: ['1-Respond', 'deal'],
    thread: thread('t04', 'Moving forward on the partnership structure', [
      msg({
        from: 'Marcus Bell <marcus@fanrush.example.com>',
        body: 'We are ready to move forward if you are. Which of the two structures we discussed do you want to go with?',
      }),
    ]),
    expected: { label: '1-Respond' },
  },
  {
    id: 'first-contact-new-operator',
    tags: ['1-Respond', 'first-contact'],
    thread: thread('t05', 'Intro — partnerships at NorthStar Sportsbook', [
      msg({
        from: 'Priya Nair <priya@northstarbook.example.com>',
        body: 'Hi Zaire, I lead partnerships at NorthStar. We are expanding into event activations and heard great things about XCLSV. Open to a conversation?',
      }),
    ]),
    expected: { label: '1-Respond' },
  },
  {
    id: 'vip-tony-casual',
    tags: ['1-Respond', 'vip'],
    thread: thread('t06', 'quick thing', [
      msg({
        from: 'Tony <tony@example.com>',
        body: 'Call me when you get a sec today.',
      }),
    ]),
    expected: { label: '1-Respond' },
  },
  {
    id: 'vip-mlr-scheduling',
    tags: ['1-Respond', 'vip'],
    thread: thread('t07', 'MLR season kickoff planning', [
      msg({
        from: 'Sam Okafor <sam.okafor@mlr.example.com>',
        body: 'Zaire — want to get the season kickoff activation planning session on the calendar. What does next week look like?',
      }),
    ]),
    expected: { label: '1-Respond' },
  },
  {
    id: 'active-counterparty-logistics',
    tags: ['1-Respond', 'vip'],
    thread: thread('t08', 'Rebet launch weekend', [
      msg({
        from: 'Jess Tran <jess@rebet.example.com>',
        body: 'For launch weekend — do you want our team on site both days or just Saturday? Need to book travel.',
      }),
    ]),
    expected: { label: '1-Respond' },
  },
  {
    id: 'unknown-sender-real-ask',
    tags: ['1-Respond', 'tie-breaker', 'unknown-ask'],
    thread: thread('t09', 'Ambassador program question', [
      msg({
        from: 'Jordan Reyes <jordan@sidelineagency.example.com>',
        body: 'Hi Zaire — we run events in the Southeast and are interested in how your ambassador program handles payout tracking. Could you share how you structure it?',
      }),
    ]),
    expected: { label: '1-Respond', lowConfidenceOk: true },
  },
  {
    id: 'unknown-pitch-never-archive',
    tags: ['1-Respond', 'tie-breaker', 'pitch'],
    thread: thread('t10', 'Platform for influencer campaign tracking', [
      msg({
        from: 'Blake Morton <blake@trackstack.example.io>',
        body: 'Zaire — TrackStack helps agencies like XCLSV manage influencer campaigns end to end. Worth a quick demo? Could be a fit for your affiliate work.',
      }),
    ]),
    expected: { label: '1-Respond', lowConfidenceOk: true },
  },
  {
    id: 'respond-beats-review',
    tags: ['1-Respond', 'tie-breaker', 'respond-beats-review'],
    thread: thread('t11', 'Weekly pacing report + one question', [
      msg({
        from: 'Casey Lin <casey@adpartner.example.com>',
        body: 'Weekly pacing report attached, all on track. One thing: does the revised flight schedule work for you, or should we keep the original dates?',
        attachments: ['pacing_week32.pdf'],
      }),
    ]),
    expected: { label: '1-Respond' },
  },
  {
    id: 'ambiguous-short-ask',
    tags: ['1-Respond', 'tie-breaker', 'low-confidence'],
    thread: thread('t12', 'chat this week?', [
      msg({
        from: 'R. Patel <r.patel@unknownco.example.net>',
        body: 'Do you have 15 minutes this week?',
      }),
    ]),
    expected: { label: '1-Respond', lowConfidenceOk: true },
  },

  // ── 2-Review ─────────────────────────────────────────────────────────────
  {
    id: 'automated-weekly-report',
    tags: ['2-Review', 'report'],
    thread: thread('t13', 'Your weekly performance summary', [
      msg({
        from: 'Reports <no-reply@affiliatedash.example.com>',
        body: 'Week 32 summary: 4,210 signups tracked, top partner GrandBet, full dashboard at the link. This is an automated report.',
      }),
    ]),
    expected: { label: '2-Review' },
  },
  {
    id: 'dashboard-digest',
    tags: ['2-Review', 'report'],
    thread: thread('t14', 'Signup tracking digest — week 32', [
      msg({
        from: 'Portal Notifications <alerts@xclsvportal.example.com>',
        body: 'Weekly digest: ambassador signups up 12% week over week. 3 events completed, payroll batch scheduled. No action required.',
      }),
    ]),
    expected: { label: '2-Review' },
  },
  {
    id: 'cc-anna-driving',
    tags: ['2-Review', 'cc-teammate'],
    thread: thread('t15', 'Venue load-in details — Riverfront event', [
      msg({
        from: 'Venue Ops <ops@riverfrontvenue.example.com>',
        to: 'Anna <anna@xclsvmedia.com>',
        cc: ZAIRE,
        body: 'Anna, confirming load-in starts at 7am with dock access on the north side. Send your staff list by Thursday.',
      }),
      msg({
        from: 'Anna <anna@xclsvmedia.com>',
        to: 'Venue Ops <ops@riverfrontvenue.example.com>',
        cc: ZAIRE,
        body: 'Confirmed — staff list coming tomorrow. I will handle the dock passes.',
      }),
      msg({
        from: 'Venue Ops <ops@riverfrontvenue.example.com>',
        to: 'Anna <anna@xclsvmedia.com>',
        cc: ZAIRE,
        body: 'Great, we will have passes ready at will-call.',
      }),
    ]),
    expected: { label: '2-Review' },
  },
  {
    id: 'cc-andrea-driving',
    tags: ['2-Review', 'cc-teammate'],
    thread: thread('t16', 'Creator content calendar — August', [
      msg({
        from: 'Talent Manager <mgmt@creatorhouse.example.com>',
        to: 'Andrea <andrea@xclsvmedia.com>',
        cc: ZAIRE,
        body: 'Andrea — August content calendar attached, three posts per creator. Let me know if the dates work.',
        attachments: ['august_calendar.xlsx'],
      }),
      msg({
        from: 'Andrea <andrea@xclsvmedia.com>',
        to: 'Talent Manager <mgmt@creatorhouse.example.com>',
        cc: ZAIRE,
        body: 'Dates work. I will send caption guidelines by Friday.',
      }),
      msg({
        from: 'Talent Manager <mgmt@creatorhouse.example.com>',
        to: 'Andrea <andrea@xclsvmedia.com>',
        cc: ZAIRE,
        body: 'Perfect, thanks Andrea.',
      }),
    ]),
    expected: { label: '2-Review' },
  },
  {
    id: 'industry-newsletter',
    tags: ['2-Review', 'newsletter'],
    thread: thread('t17', 'iGaming Weekly: regulation roundup', [
      msg({
        from: 'iGaming Weekly <newsletter@igamingweekly.example.com>',
        body: 'This week: two states advance sports betting bills, operator earnings season preview, and the latest on affiliate compliance rules.',
      }),
    ]),
    expected: { label: '2-Review' },
  },
  {
    id: 'teammate-fyi',
    tags: ['2-Review', 'cc-teammate'],
    thread: thread('t18', 'FYI — vendor call recap', [
      msg({
        from: 'Anna <anna@xclsvmedia.com>',
        body: 'For visibility: recap of the staffing vendor call. Rates unchanged, they can cover all three September events. No action needed from you.',
      }),
    ]),
    expected: { label: '2-Review' },
  },

  // ── Archive ──────────────────────────────────────────────────────────────
  {
    id: 'saas-receipt',
    tags: ['Archive', 'receipt'],
    thread: thread('t19', 'Your receipt from CloudTools', [
      msg({
        from: 'CloudTools Billing <billing@cloudtools.example.com>',
        body: 'Receipt: $49.00 charged to card ending 4242 for your monthly subscription. No action required.',
      }),
    ]),
    expected: { label: 'Archive' },
  },
  {
    id: 'payment-confirmation',
    tags: ['Archive', 'receipt'],
    thread: thread('t20', 'Wire transfer completed', [
      msg({
        from: 'Bank Notifications <no-reply@firstbank.example.com>',
        body: 'Your outgoing wire transfer has been completed. Reference number 88213. This is an automated confirmation.',
      }),
    ]),
    expected: { label: 'Archive' },
  },
  {
    id: 'calendar-auto-reply',
    tags: ['Archive', 'auto-reply'],
    thread: thread('t21', 'Accepted: Sync — Zaire / GrandBet', [
      msg({
        from: 'Calendar <calendar-notification@google.example.com>',
        body: 'Riley Fox has accepted this event: Sync — Zaire / GrandBet, Tuesday 2:00 PM PT.',
      }),
    ]),
    expected: { label: 'Archive' },
  },
  {
    id: 'promo-webinar',
    tags: ['Archive', 'promo'],
    thread: thread('t22', 'Last chance: marketing webinar tomorrow!', [
      msg({
        from: 'Growth Summit <events@growthsummit.example.io>',
        body: 'Do not miss tomorrow\'s webinar: 10 growth hacks for agencies. Register now, seats are limited!',
      }),
    ]),
    expected: { label: 'Archive' },
  },
  {
    id: 'closed-loop-thanks',
    tags: ['Archive', 'closed-loop'],
    thread: thread('t23', 'Re: Deck for Thursday', [
      msg({
        from: ZAIRE,
        to: 'Casey Lin <casey@adpartner.example.com>',
        body: 'Deck attached — see you Thursday.',
        attachments: ['xclsv_overview.pdf'],
      }),
      msg({
        from: 'Casey Lin <casey@adpartner.example.com>',
        body: 'Got it, thanks! All set for Thursday.',
      }),
    ]),
    expected: { label: 'Archive' },
  },
  {
    id: 'out-of-office',
    tags: ['Archive', 'auto-reply'],
    thread: thread('t24', 'Automatic reply: partnership deck', [
      msg({
        from: 'Riley Fox <riley@grandbet.example.com>',
        body: 'I am out of the office until Monday August 10 with limited email access. I will respond when I return.',
      }),
    ]),
    expected: { label: 'Archive' },
  },
]

// ── Deterministic layer (decideAction) ─────────────────────────────────────

export interface DeterministicFixture {
  id: string
  tags: string[]
  thread: ThreadSummary
}

export const OUTBOUND_LAST_FIXTURES: DeterministicFixture[] = [
  {
    id: 'zaire-asked-for-dates',
    tags: ['3-Waiting', 'outbound-last'],
    thread: thread('t25', 'Activation dates', [
      msg({ from: 'Jess Tran <jess@rebet.example.com>', body: 'What dates work for the activation?' }),
      msg({ from: ZAIRE, to: 'Jess Tran <jess@rebet.example.com>', body: 'Can you send the dates you are considering? We will make them work.' }),
    ]),
  },
  {
    id: 'zaire-sent-deck-awaiting-feedback',
    tags: ['3-Waiting', 'outbound-last'],
    thread: thread('t26', 'Partnership overview', [
      msg({ from: ZAIRE, to: 'Priya Nair <priya@northstarbook.example.com>', body: 'Overview deck attached — curious what your team thinks.', attachments: ['overview.pdf'] }),
    ]),
  },
  {
    id: 'zaire-answered-expecting-confirmation',
    tags: ['3-Waiting', 'outbound-last'],
    thread: thread('t27', 'Staffing for Riverfront', [
      msg({ from: 'Venue Ops <ops@riverfrontvenue.example.com>', body: 'How many staff should we badge?' }),
      msg({ from: ZAIRE, to: 'Venue Ops <ops@riverfrontvenue.example.com>', body: 'Twelve. Let me know that works.' }),
    ]),
  },
  {
    id: 'zaire-replied-in-gmail-directly',
    tags: ['3-Waiting', 'outbound-last', 'cancel-draft'],
    thread: thread('t28', 'Re: September slate scope', [
      msg({ from: 'Luis Herrera <luis@outlierpicks.example.com>', body: 'Can you confirm the September slate scope?' }),
      msg({ from: ZAIRE, to: 'Luis Herrera <luis@outlierpicks.example.com>', body: 'Confirmed — same scope as August. More detail Friday.' }),
    ]),
  },
]

export const INBOUND_ON_WAITING_FIXTURE: DeterministicFixture = {
  id: 'reply-arrives-on-waiting-thread',
  tags: ['inbound-on-waiting'],
  thread: thread('t29', 'Activation dates', [
    msg({ from: ZAIRE, to: 'Jess Tran <jess@rebet.example.com>', body: 'Send the dates you are considering.' }),
    msg({ from: 'Jess Tran <jess@rebet.example.com>', body: 'October 3–4 or October 10–11. Which do you prefer?' }),
  ]),
}

export const ALREADY_PROCESSED_FIXTURE: DeterministicFixture = {
  id: 'newest-message-already-triaged',
  tags: ['idempotent-skip'],
  thread: thread('t30', 'Your weekly performance summary', [
    msg({ from: 'Reports <no-reply@affiliatedash.example.com>', body: 'Week 32 summary, no action required.' }),
  ]),
}
