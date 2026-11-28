---
title: "Thumbs up, thumbs down: collect feedback on agent answers and turn it into eval cases"
description: "A small feedback system for a Claude-based product: what to ask (and what not to), a feedback table tied to the exact message and prompt version, a weekly review that turns thumbs-down answers into eval cases, privacy rules for using real conversations, and the numbers to watch."
date: 2026-12-27
slug: thumbs-feedback-agent-answers-evals
tags: [ai, testing, postgres, saas]
---

<p class="lede">Your evals only test the cases you thought of. Your users find the others, every day, and most of them say nothing: they get a bad answer, sigh, and leave. A thumbs-down button is the cheapest way to hear about those answers, and the real value is not the number. It is the steady supply of real failures you can turn into eval cases. This post builds that loop.</p>

## What to ask

Keep the first question to one click: thumbs up or thumbs down on each agent answer. Anything more on the first step (stars, a form, a required comment) cuts responses sharply.

After a thumbs-down, offer an optional second step with a few reasons and a free-text box:

- Wrong or made-up information
- Didn't do what I asked
- Too long or unclear
- A tool action went wrong
- Other

The reasons help you sort; the free text is where the useful detail is. Never require it.

Do not ask after every answer with a popup. A quiet pair of icons under each answer is enough; users who care will use it.

## Store it against the exact answer

Feedback is only useful if you can see what the user saw. Tie it to the message, the conversation, the model, the effort level and the prompt version:

```sql
CREATE TABLE answer_feedback (
  id              bigserial PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id text NOT NULL,
  message_index   integer NOT NULL,          -- position of the assistant message in the conversation
  rating          smallint NOT NULL CHECK (rating IN (-1, 1)),
  reason          text,
  comment         text CHECK (length(comment) <= 2000),
  model           text NOT NULL,
  prompt_id       text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  reviewed_at     timestamptz,
  UNIQUE (user_id, conversation_id, message_index)
);
```

The unique constraint lets a user change their mind (upsert), without counting one answer twice. `model` and `prompt_id` come from the run that produced the answer, not from the current config, so feedback stays attributable after you [change the prompt](/blog/version-system-prompts-rollout-rollback/).

```ts
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return new Response(null, { status: 401 });
  const body = FeedbackInput.parse(await req.json());

  const conv = await db.query.conversations.findFirst({
    where: and(eq(conversations.id, body.conversationId), eq(conversations.userId, session.user.id)),
  });
  if (!conv) return new Response(null, { status: 404 });   // not theirs, or does not exist

  await db.insert(answerFeedback).values({ userId: session.user.id, ...body, model: conv.model, promptId: conv.promptId })
    .onConflictDoUpdate({
      target: [answerFeedback.userId, answerFeedback.conversationId, answerFeedback.messageIndex],
      set: { rating: body.rating, reason: body.reason, comment: body.comment, createdAt: new Date() },
    });
  return new Response(null, { status: 204 });
}
```

The conversation lookup is [scoped to the user](/blog/postgres-row-level-security-multi-tenant-agent-saas/), so nobody can rate, or probe for, someone else's conversation.

## The weekly review

Numbers come later. At first, read. Once a week, open every unreviewed thumbs-down with its conversation:

```sql
SELECT f.id, f.reason, f.comment, f.model, f.prompt_id, f.conversation_id, f.message_index
FROM answer_feedback f
WHERE f.rating = -1 AND f.reviewed_at IS NULL
ORDER BY f.created_at
LIMIT 50;
```

For each one, decide which kind of failure it is:

1. **A real agent failure** (wrong fact, wrong tool, misunderstood request): make it an eval case.
2. **A product gap** (the user wanted something the agent cannot do): note it for the roadmap.
3. **Not a failure** (the answer was right, the user wanted something else): mark reviewed, move on.

Set `reviewed_at` either way, so the queue goes to zero each week.

## From thumbs-down to eval case

An eval case needs an input and a check. A real conversation gives you the input; you write the check:

```ts
// evals/cases.ts
{
  name: "refund question after 20 days cites the 14-day rule",   // from feedback #1842
  messages: [{ role: "user", content: "I bought this 20 days ago, can I still get a refund?" }],
  check: (answer) => /14 days/.test(answer) && !/yes, you can/i.test(answer),
},
```

Rewrite the user's message in your own words with personal details removed, rather than copying it. Keep the feedback id in the case name or a comment, so you can find the original later.

Then fix the cause, usually a prompt line, a [tool description](/blog/write-tool-descriptions-claude-uses-well/) or a tool's result, run the [evals](/blog/evals-for-claude-agents-typescript/), and ship it. The case stays in the set and protects the fix from the next change.

## Privacy rules

Feedback makes it tempting to read user conversations. Set the rules before you do:

- Say in your privacy policy that conversations a user rates may be reviewed to improve the product.
- Only open conversations that have feedback, unless your policy says otherwise.
- Strip personal data when you turn a conversation into an eval case; never put a customer's real data in your repository.
- Feedback rows are user data: include them in [export and deletion](/blog/export-delete-user-data-ai-saas/).

## The numbers, once there are enough

With a few hundred rated answers, two numbers become useful:

- **Thumbs-down rate per prompt version and model**, to compare a rollout against the old version.
- **Thumbs-down rate per reason**, to see whether a fix moved the reason it targeted.

Below that volume, percentages swing too much to mean anything. Rating rate (rated answers / all answers) is usually a few percent; a sudden rise in ratings is itself a signal that something changed.

## Summary

- One click first (up or down); optional reasons and comment after a thumbs-down.
- Store feedback against the exact message, with the model and prompt version that produced it.
- Review every thumbs-down weekly and sort it: agent failure, product gap, or not a failure.
- Turn real failures into eval cases with personal data removed, then fix the cause.
- Write privacy rules first, and include feedback in export and deletion.

<!-- site-only -->

*Agentwright Starter has an eval runner (`npm run eval`, cases in `evals/cases.ts`) and stores each conversation per user; feedback buttons are not included, and this post's table and weekly review are how we would add them. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed before publishing.*

<!-- /site-only -->
