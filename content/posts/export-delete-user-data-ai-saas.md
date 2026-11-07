---
title: "Export my data, delete my account: privacy requests in an AI agent SaaS, done with one map of where data lives"
description: "How to handle data export and account deletion in an AI agent product: a written map of every place user data lives (Postgres tables, uploaded files at Anthropic, email provider, payment provider, logs), a JSON export job, a deletion job that cascades and keeps what law and accounting require, and a test that keeps the map honest."
date: 2026-12-13
slug: export-delete-user-data-ai-saas
tags: [postgres, privacy, nextjs, typescript]
---

<p class="lede">The first privacy request usually arrives by email, from a real user, at an inconvenient time: "Please delete my account and all my data", or "Send me everything you store about me". An AI product stores more than most: conversations, tool results, uploaded documents, usage rows, traces. If you have to work out where all of it lives on the day the email arrives, you will miss something. Build the map and two jobs before launch, and the request becomes a button.</p>

This post is engineering guidance, not legal advice. Which requests you must honour and how fast depends on where you and your users are (the EU's GDPR, California's CCPA and others); check the rules that apply to you.

## Step 1: a written map of where user data lives

Make a file in the repo, `docs/data-map.md` or a TypeScript object, that lists every place user data goes. For a typical agent SaaS:

| Where | What | Export | Delete |
|---|---|---|---|
| `users`, `accounts`, `sessions` | Profile, sign-in | Yes | Yes |
| `conversations`, `messages` | Chat history, tool calls and results | Yes | Yes |
| `user_files` + Anthropic Files API | Uploaded documents | List + originals | Yes, both ends |
| `usage_events` | Tokens and cost per call | Yes | Anonymize |
| `agent_runs`, `agent_steps` | Traces | Optional | Yes |
| `credit_ledger`, orders | Payments | Yes | Keep (accounting) |
| Email provider | Address, sent mail logs | No | Remove contact |
| Payment provider | Customer, orders | Via provider | Provider's process |
| Logs, backups | Whatever leaked in | No | Expire on schedule |

The table forces three decisions per row: is it in the export, is it deleted, and if not, why. Records you must keep for tax or accounting (orders, invoices) stay, but only with what is needed for that purpose.

## Step 2: keep user data findable

Both jobs are easy only if every row can be found by user:

- Every table with user data has a `user_id` column (or a direct parent that does), with an index.
- Foreign keys use `ON DELETE CASCADE` from the user down, so deleting the user row removes children you might forget.
- Anthropic file ids, email contact ids and payment customer ids are stored in your database, linked to the user. The [PDF uploads post](/blog/pdf-uploads-claude-agent-files-api/) has the `user_files` table.
- Don't write prompts or tool results into application logs. The [tracing post](/blog/trace-claude-agent-runs-postgres/) links traces to conversations instead of copying content, which also keeps deletion simple.

If you use [row-level security](/blog/postgres-row-level-security-multi-tenant-agent-saas/), the jobs below should run as a role that can see all of one user's rows, and nothing else.

## Step 3: the export job

Exports can be large, so build them in the background and email a download link:

```ts
export async function buildExport(userId: string) {
  const data = {
    exported_at: new Date().toISOString(),
    profile: await one(`SELECT id, email, name, created_at FROM users WHERE id = $1`, [userId]),
    conversations: await many(
      `SELECT c.id, c.title, c.created_at,
              json_agg(json_build_object('role', m.role, 'content', m.content, 'created_at', m.created_at)
                       ORDER BY m.seq) AS messages
       FROM conversations c JOIN messages m ON m.conversation_id = c.id
       WHERE c.user_id = $1 GROUP BY c.id ORDER BY c.created_at`, [userId]),
    files: await many(`SELECT filename, bytes, created_at FROM user_files
                       WHERE user_id = $1 AND deleted_at IS NULL`, [userId]),
    usage: await many(`SELECT created_at, model, input_tokens, output_tokens, cost_micro_usd
                       FROM usage_events WHERE user_id = $1 ORDER BY created_at`, [userId]),
    payments: await many(`SELECT kind, amount, ref, created_at FROM credit_ledger
                          WHERE user_id = $1 ORDER BY created_at`, [userId]),
  };
  const key = `exports/${userId}/${crypto.randomUUID()}.json`;
  await storage.put(key, JSON.stringify(data, null, 2));
  return signedUrl(key, { expiresInHours: 24 });
}
```

- **Machine-readable JSON** is the expected format; include message content blocks as you stored them.
- **Original uploads:** include them in a zip, or list them with a separate download link each. Keep your own copy of originals if users may ask for them; the Files API is meant for model input, not as your storage.
- **Signed, short-lived links**, sent to the account's verified email only. The [license keys post](/blog/license-keys-lemon-squeezy-cloudflare/) shows signed download links.
- Rate-limit export requests (one a day is plenty).

## Step 4: the deletion job

Deletion should be a job with steps you can retry, not one request handler:

```ts
export async function deleteUser(userId: string) {
  // 1. External services first, while we still have their ids
  for (const f of await many(`SELECT anthropic_file_id FROM user_files WHERE user_id = $1`, [userId])) {
    await client.files.delete(f.anthropic_file_id).catch(ignoreNotFound);
  }
  await emailProvider.removeContact(userId).catch(ignoreNotFound);

  // 2. Our database, in one transaction
  await db.tx(async (t) => {
    await t.query(`UPDATE usage_events SET user_id = NULL, anonymized = true WHERE user_id = $1`, [userId]);
    await t.query(`UPDATE credit_ledger SET user_id = NULL WHERE user_id = $1 AND kind IN ('purchase','refund')`, [userId]);
    await t.query(`DELETE FROM users WHERE id = $1`, [userId]); // cascades to conversations, messages, files, runs
    await t.query(`INSERT INTO deletion_log (user_hash, deleted_at) VALUES (encode(sha256($1::text::bytea),'hex'), now())`, [userId]);
  });
}
```

Points worth copying:

- **External first.** Once the user row is gone, you lose the ids needed to delete the files at Anthropic and the contact at your email provider. Make those calls idempotent (ignore "not found") so a retry after a crash is safe.
- **Anonymize what you keep.** Usage rows are useful for your cost history and [margin analysis](/blog/find-most-expensive-users-sql/) without a user attached. Payment records stay for accounting, unlinked from the deleted account. The nullable `user_id` in those tables is deliberate.
- **Cancel subscriptions** before deletion through your payment provider's API, so a deleted user is not charged again.
- **Log the fact, not the person.** A hash in `deletion_log` lets you show that a deletion happened without keeping the identity.
- **Backups** keep deleted data until they expire. Say so in your privacy policy ("removed from backups within 30 days"), and make sure backup retention matches.

Ask for confirmation in the UI (type the email address, or a confirmation link by email), then run the job. A grace period of a few days, during which the user can cancel, prevents accidental deletions; run the job after it ends.

## Step 5: a test that keeps the map honest

The map goes stale the day someone adds a table. Add a test that lists every table with a `user_id` column from `information_schema.columns` and fails if a table is missing from the data map. Then create a test user with rows everywhere, run the deletion job, and assert that no row with that `user_id` remains except in the tables marked "anonymize" or "keep". Run both in CI next to your [other tests](/blog/test-agent-tools-without-calling-claude/).

## Summary

- Write down every place user data lives, with an export and delete decision for each.
- Give every table a `user_id`, cascade deletes from the user, and store external ids.
- Export to JSON in a background job; deliver through a short-lived signed link.
- Delete external data first, then the database in one transaction; anonymize what you must keep.
- Test the map against the schema so new tables cannot slip through.

<!-- site-only -->

*Agentwright Starter keeps users, conversations and usage in Postgres tables keyed by user, which is the starting point for both jobs. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed before publishing.*

<!-- /site-only -->
