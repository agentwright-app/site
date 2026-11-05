---
title: "Human approval for agent tool calls: pause the Claude loop, store the pending action, resume safely"
description: "How to let users approve an agent's risky actions (sending email, refunds, deletes) before they run: classify tools, stop the loop on a gated call, persist the pending action, show the exact arguments, execute exactly once, and resume the conversation with the right tool_result, including parallel calls and denials."
date: 2026-11-28
slug: approval-gates-for-agent-tool-calls
tags: [claude, agents, typescript, security]
---

<p class="lede">Agents become useful when they can do things, and risky for the same reason. An agent that drafts a refund is helpful; one that issues refunds on its own judgement, or on instructions hidden in a customer's email, is a liability. The standard answer is an approval step: the agent proposes an action, a person sees exactly what will happen and clicks approve or deny, and only then does it run. This post builds that step into a hand-written Claude tool loop, including the parts that are easy to get wrong.</p>

The tool_use / tool_result rules below follow Anthropic's tool use documentation, checked on 2026-11-05. The loop builds on the one from the [stop reasons post](/blog/handle-claude-stop-reasons-agent/).

## Step 1: classify every tool

Give each tool a risk level in its definition, so the decision is made once, in code, and not by the model:

```ts
type Risk = "read" | "write" | "external";

const tools = {
  search_orders:  { risk: "read",     run: searchOrders },
  add_note:       { risk: "write",    run: addNote },        // reversible, internal
  issue_refund:   { risk: "external", run: issueRefund },    // money leaves
  send_email:     { risk: "external", run: sendEmail },      // reaches another person
  delete_project: { risk: "external", run: deleteProject },  // cannot be undone
} satisfies Record<string, { risk: Risk; run: (input: any, ctx: Ctx) => Promise<string> }>;

const needsApproval = (name: string) => tools[name]?.risk === "external";
```

A useful test for "external": would you want to know before it happened if a new employee did this? Sending anything to another person, moving money, deleting or publishing, and changing permissions all qualify. Reads and reversible internal writes usually do not, and gating them only teaches users to click "approve" without reading.

## Step 2: stop the loop on a gated call

When a response has `stop_reason: "tool_use"`, run the ungated calls as usual. If any call needs approval, save the pending calls and return to the caller instead of continuing:

```ts
case "tool_use": {
  const calls = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const gated = calls.filter((c) => needsApproval(c.name));

  if (gated.length === 0) {
    messages.push({ role: "user", content: await runTools(calls, ctx) });
    continue;
  }

  // Run the safe calls now, hold their results until the gated ones are decided.
  const safeResults = await runTools(calls.filter((c) => !needsApproval(c.name)), ctx);
  await db.insert(pendingActions).values(gated.map((c) => ({
    conversationId, userId: ctx.userId, toolUseId: c.id, name: c.name, input: c.input,
    heldResults: safeResults, status: "pending", expiresAt: minutesFromNow(30),
  })));
  await saveConversation(conversationId, messages);
  return { status: "needs_approval", pending: gated.map((c) => ({ id: c.id, name: c.name, input: c.input })) };
}
```

Two API rules shape this code:

- **Every `tool_use` block needs a matching `tool_result`** in the next user message. You cannot send results for some calls now and the rest later, and you cannot drop a call.
- **All results for one turn go in one user message.** When Claude makes parallel calls and only one of them is gated, hold the other results until the decision, then send them all together.

That is why the safe results are stored with the pending action instead of being sent straight away.

## Step 3: show the exact action

The approval UI must show what will actually run, taken from the stored `input`, not the model's description of it. If the assistant wrote "I'll send a short thank-you note" but the `input.body` says something else, the user must see the `input.body`.

```tsx
function ApprovalCard({ action }: { action: PendingAction }) {
  return (
    <div role="alertdialog" aria-label="Approve action">
      <h3>{labels[action.name]}</h3>          {/* "Send email", "Issue refund" */}
      <dl>
        {Object.entries(action.input).map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd><pre>{String(v)}</pre></dd></div>
        ))}
      </dl>
      <form action={decide}>
        <input type="hidden" name="id" value={action.toolUseId} />
        <textarea name="reason" placeholder="Reason (optional, shown to the assistant if you deny)" />
        <button name="decision" value="approve">Approve</button>
        <button name="decision" value="deny">Deny</button>
      </form>
    </div>
  );
}
```

For money, show the amount and currency in large type. For email, show the recipient and the full body. For deletes, show what will be deleted and that it cannot be undone.

## Step 4: decide once, execute once

The decision endpoint is where double execution happens if you are not careful: a double click, two open tabs, a retry after a timeout. Claim the action atomically:

```ts
"use server";
export async function decide(form: FormData) {
  const session = await requireUser();                        // the human, never the model
  const id = String(form.get("id"));
  const approve = form.get("decision") === "approve";

  const [action] = await db.update(pendingActions)
    .set({ status: approve ? "approved" : "denied", decidedAt: new Date(), decidedBy: session.userId })
    .where(and(
      eq(pendingActions.toolUseId, id),
      eq(pendingActions.userId, session.userId),
      eq(pendingActions.status, "pending"),
      gt(pendingActions.expiresAt, new Date()),
    ))
    .returning();
  if (!action) return { error: "This action was already decided or has expired." };

  const result = approve
    ? await runApproved(action)    // executes the tool once
    : `The user declined this action.${form.get("reason") ? ` Reason: ${form.get("reason")}` : ""}`;

  await db.update(pendingActions).set({ result }).where(eq(pendingActions.toolUseId, id));
  await resumeConversation(action);
}
```

The `WHERE status = 'pending'` makes the update a lock: only one request can move the row out of `pending`, and only that request runs the tool. The user check makes sure a user can only decide their own actions. And because this is an ordinary authenticated endpoint, nothing the model writes can call it. The model has no tool that approves, and approval does not depend on any text in the conversation.

For external APIs that support it, also pass the `toolUseId` as an idempotency key (Stripe and many email APIs accept one), so even a crash between "executed" and "recorded" cannot send twice.

## Step 5: resume the conversation

To resume, build the next user message: the held results plus the decided ones, in a single message, then continue the loop:

```ts
async function resumeConversation(action: PendingAction) {
  const siblings = await gatedCallsOfTurn(action);              // every gated call from that turn, this one included
  if (siblings.some((s) => s.status === "pending" || s.result == null)) return;  // wait until all are decided
  if (!(await claimResume(action))) return;                      // conditional update: only one request resumes

  const results: Anthropic.ToolResultBlockParam[] = [
    ...action.heldResults,
    ...siblings.map((s) => ({ type: "tool_result" as const, tool_use_id: s.toolUseId, content: s.result, is_error: s.status === "denied" })),
  ];
  const messages = await loadConversation(action.conversationId);
  messages.push({ role: "user", content: results });
  return runAgent({ conversationId: action.conversationId, messages });
}
```

`claimResume` is the same trick as in step 4, applied to the turn: when two parallel calls are decided at the same moment, both requests see everything decided, and only the one whose conditional update succeeds continues the loop.

A denial is a normal tool result with `is_error: true` and a plain sentence. The model reads it and adapts: it asks what the user would prefer, or suggests something else. Include the user's reason when they gave one; "Deny: wrong customer" leads to a much better next turn than a bare refusal.

If the user edited the arguments before approving (for example, corrected the email text), run the edited version and say so in the result: "Sent, with the body edited by the user to: …". Otherwise the model's picture of what happened is wrong for the rest of the conversation.

## Details that matter in production

- **Expiry.** A pending action should not be approvable a week later, when the situation has changed. Thirty minutes to a day, depending on the action; expired actions resume the conversation as denied with "the approval request expired".
- **Prompt cache.** The cache lasts minutes. If approval takes longer, the resumed turn pays a cache write. That is fine; do not try to keep the cache warm while a person decides.
- **Notifications.** If the agent runs in a [background job](/blog/background-agent-jobs-postgres-skip-locked/), the user may not be watching. Send a notification with a link to the approval card, and show pending approvals in one place in your app.
- **Audit log.** Keep the pending action row forever: what was proposed, by which conversation, who decided, when, and the result. It answers "why did the agent refund this order?" months later.
- **Auto-approve rules, carefully.** Once users trust the agent, they will ask to skip approval for small actions ("refunds under $20"). Implement those rules in code, per user, and log them like manual approvals. Never let the model decide what counts as small.

If you would rather not build this, Anthropic's Managed Agents service has permission policies (such as always asking before a tool runs) built into its hosted agent loop. The design ideas above still apply to what you choose to gate.

## Summary

- Classify tools by risk in code; gate actions that reach other people, move money, delete, publish or change permissions.
- On a gated call, run the safe calls, hold their results, persist the pending actions and stop.
- Show the exact stored arguments, not the model's summary.
- Claim the decision with a conditional update so it executes once; check the user; use idempotency keys.
- Resume with all results for the turn in one message; denials are `is_error` results with the user's reason.
- Add expiry, notifications and an audit log.

<!-- site-only -->

*Agentwright Starter's agent loop already returns tool failures to the model as error results and stores each conversation per user in Postgres, which is the foundation an approval step builds on. It launches in December 2026; see the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against Anthropic's tool use documentation before publishing.*

<!-- /site-only -->
