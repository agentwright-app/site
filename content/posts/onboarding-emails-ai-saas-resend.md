---
title: "Onboarding emails for an AI SaaS: the five messages worth sending, triggered by what users actually did"
description: "A small, event-driven email setup for a Next.js AI app using Resend and a Postgres jobs table: welcome, first-success nudge, usage warning at 80% of the plan, limit reached, and a quiet check-in, with idempotency keys, one-click unsubscribe headers and the rules that keep the messages out of spam."
date: 2026-12-04
slug: onboarding-emails-ai-saas-resend
tags: [saas, email, nextjs, postgres]
---

<p class="lede">Most AI apps lose users in the first ten minutes: they sign up, look at an empty chat box, type one vague question, get a generic answer and leave. Email cannot fix a confusing product, but a few well-timed messages bring back people who meant to try it properly and got interrupted. The trick is to send few messages, each triggered by something the user did or did not do, instead of a fixed drip sequence.</p>

The examples use Resend for sending and a Postgres table for scheduling. Resend's API options and the mailbox provider rules below were checked on 2026-11-06.

## The five messages

| Email | Sent when | Kind |
|---|---|---|
| Welcome | Right after the first sign-in | Transactional |
| First-success nudge | 24 hours after sign-up, **only if** the user has not completed an agent run | Onboarding |
| Usage warning | The user passes 80% of their plan's monthly allowance | Transactional |
| Limit reached | A request is blocked by the spend limit | Transactional |
| Check-in | 14 days after sign-up, only if the user was active at least twice | Onboarding |

Five is enough. Every extra message lowers the chance that the important ones (the usage warning, the limit message) are read.

"Transactional" here means a message the user needs because of something in their account. "Onboarding" messages are closer to marketing, so they get an unsubscribe link and respect it.

## What each message says

- **Welcome:** one sentence on what the app does, one link to start, and two or three example prompts that work well. Example prompts are the most useful line in the email, because the empty-chat-box problem is a "what do I type?" problem.
- **First-success nudge:** short, plain text, with one prompt they can paste. "Most people start with: *Summarize this week's support tickets by topic.*" No discount, no urgency.
- **Usage warning:** how much is used, when it resets, and what happens at 100% (requests pause, nothing is charged extra). Link to the usage page and the upgrade page. This one saves support tickets.
- **Limit reached:** the same facts, sent once per period, not on every blocked request.
- **Check-in:** a real question, sent from an address that accepts replies: "What were you hoping it would do that it didn't?" The answers are the best product feedback you will get at this stage.

## A jobs table instead of a drip tool

Each email is a row with a time to send and a key that prevents duplicates:

```sql
CREATE TABLE email_jobs (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id),
  kind       text NOT NULL,                     -- 'welcome', 'nudge', 'usage_80', ...
  dedupe_key text NOT NULL UNIQUE,              -- e.g. 'usage_80:<user>:2026-12'
  send_at    timestamptz NOT NULL,
  sent_at    timestamptz,
  skipped    text                                -- why it was not sent, if it was not
);
CREATE INDEX ON email_jobs (send_at) WHERE sent_at IS NULL AND skipped IS NULL;
```

Events insert jobs; `ON CONFLICT (dedupe_key) DO NOTHING` makes repeated events harmless:

```ts
export async function queueEmail(userId: string, kind: Kind, dedupeKey: string, sendAt = new Date()) {
  await db.insert(emailJobs).values({ userId, kind, dedupeKey, sendAt }).onConflictDoNothing();
}

// after the first sign-in
await queueEmail(user.id, "welcome", `welcome:${user.id}`);
await queueEmail(user.id, "nudge", `nudge:${user.id}`, hoursFromNow(24));
await queueEmail(user.id, "checkin", `checkin:${user.id}`, daysFromNow(14));

// in the spend check, when usage crosses 80% for this billing period
await queueEmail(user.id, "usage_80", `usage_80:${user.id}:${periodKey}`);
```

The usage warning's key includes the billing period, so it is sent at most once per period however many requests cross the line.

## Check the condition at send time

The nudge and the check-in are queued at sign-up, but whether to send them depends on what happens later. Decide when the job runs, not when it is queued:

```ts
const conditions: Partial<Record<Kind, (u: User) => Promise<string | null>>> = {
  nudge:   async (u) => (await hasCompletedRun(u.id)) ? "already active" : null,
  checkin: async (u) => (await activeDays(u.id)) >= 2 ? null : "not active enough",
};

for (const job of await dueJobs(50)) {               // claim with FOR UPDATE SKIP LOCKED
  const user = await getUser(job.userId);
  const skip = !user.emailOk ? "unsubscribed or bounced" : await conditions[job.kind]?.(user) ?? null;
  if (skip) { await markSkipped(job.id, skip); continue; }
  await sendEmail(job, user);
  await markSent(job.id);
}
```

Claiming due rows with `FOR UPDATE SKIP LOCKED` lets two overlapping cron runs share the work without sending twice; the [background jobs post](/blog/background-agent-jobs-postgres-skip-locked/) shows the pattern. Recording `skipped` with a reason makes it easy to answer "why didn't I get the email?".

## Sending with Resend

```ts
await resend.emails.send(
  {
    from: "Acme <hello@mail.acme.dev>",
    replyTo: "support@acme.dev",
    to: user.email,
    subject: templates[job.kind].subject,
    html: templates[job.kind].html(user),
    text: templates[job.kind].text(user),
    headers: job.kind === "nudge" || job.kind === "checkin" ? unsubscribeHeaders(user) : undefined,
  },
  { idempotencyKey: job.dedupeKey },
);
```

- **Idempotency key.** If the worker crashes after sending but before `markSent`, the retry uses the same key and Resend does not send a second copy (within its idempotency window).
- **Plain text part.** Always include one. Some people read mail in plain text, and it helps deliverability.
- **One-click unsubscribe.** For the onboarding messages, add `List-Unsubscribe` with an HTTPS URL and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058). Gmail and Yahoo require this from bulk senders; it is good practice at any volume.

```ts
const unsubscribeHeaders = (u: User) => ({
  "List-Unsubscribe": `<https://acme.dev/api/unsubscribe?t=${signToken(u.id)}>`,
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
});
```

The unsubscribe endpoint must accept a `POST` with no login and no confirmation page, because mail clients call it directly. Sign the token so nobody can unsubscribe someone else.

## Deliverability basics

- Send from your own domain with SPF, DKIM and a DMARC record. Resend's domain setup gives you the DNS records.
- Use a subdomain such as `mail.acme.dev` for sending, so your main domain's reputation is protected if something goes wrong.
- Stop sending to addresses that bounce or mark you as spam. Resend can call a webhook for these events; set `emailOk = false` when it does. If you already handle [magic-link sign-in with Resend](/blog/magic-link-sign-in-authjs-resend/), this is the same domain setup.

## Measure one thing

Track a single number per onboarding email: of the users who got it, how many completed an agent run within 48 hours, compared with users who were skipped or signed up before the email existed. If the nudge does not move that number, rewrite it or remove it.

## Summary

- Five messages: welcome, first-success nudge, usage warning, limit reached, check-in.
- Queue jobs on events with a unique dedupe key; decide whether to send at send time.
- Claim due jobs with `SKIP LOCKED`; record why a job was skipped.
- Send with an idempotency key, a plain-text part and one-click unsubscribe headers on onboarding mail.
- Authenticate your sending domain, use a subdomain, stop on bounces and complaints.

<!-- site-only -->

*Agentwright Starter already sends magic-link sign-in email through Resend and tracks usage against each plan's allowance, which are the two hooks these messages need. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against the Resend documentation and RFC 8058 before publishing.*

<!-- /site-only -->
