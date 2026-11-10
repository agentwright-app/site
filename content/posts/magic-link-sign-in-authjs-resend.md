---
title: "Magic-link sign-in with Auth.js v5 and Resend: the setup, and the four things that break in production"
description: "Passwordless email sign-in for a Next.js SaaS with Auth.js v5 and Resend: the provider config, the database tables it needs, a short link lifetime, and fixes for the production problems: corporate link scanners, unverified sender domains, sign-in email abuse, and mixed-case addresses."
date: 2026-11-22
slug: magic-link-sign-in-authjs-resend
tags: [nextjs, authjs, auth, saas]
---

<p class="lede">Developers sign in with GitHub happily. Their managers, their customers and the person who pays for the team plan often do not have a GitHub account and do not want one. An email magic link covers everyone: type your address, click the link, you are in. Auth.js makes the happy path a few lines long. This post covers those lines and then the four problems that only show up once real people use it.</p>

The code targets Auth.js v5 (`next-auth@5`) with the Next.js App Router and a Drizzle database adapter. The pattern is the same with Prisma or another adapter.

## How a magic link works

1. The user enters an email address.
2. Auth.js creates a random token, stores a **hash** of it in the `verification_token` table with an expiry, and calls the email provider to send a link containing the token.
3. The user clicks the link: `GET /api/auth/callback/resend?token=…&email=…`.
4. Auth.js hashes the token, finds and **deletes** the matching row (a link works once), creates the user if needed, and starts a session.

Two consequences follow. Email sign-in needs a database adapter, because the token has to be stored somewhere. And anything that opens the link before the user does uses it up. Keep that second point in mind for later.

## The provider

```ts
// lib/auth/index.ts
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Resend from "next-auth/providers/resend";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/lib/db/client";
import { users, accounts, sessions, verificationTokens } from "@/lib/db/schema";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    GitHub,
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: process.env.AUTH_EMAIL_FROM,   // e.g. "Acme <login@mail.acme.com>"
      maxAge: 15 * 60,                     // seconds; the default is 24 hours
    }),
  ],
  session: { strategy: "database" },
});
```

And the form, as a server action:

```tsx
<form action={async (formData) => {
  "use server";
  await signIn("resend", { email: String(formData.get("email")), redirectTo: "/chat" });
}}>
  <input type="email" name="email" required autoComplete="email" />
  <button type="submit">Email me a sign-in link</button>
</form>
```

**Shorten the link lifetime.** The default of 24 hours means a link sitting in an inbox is a working key for a day. Fifteen minutes is plenty for someone who just asked for it, and the page that says "check your inbox" should say how long the link lasts.

**Keep GitHub too.** When both providers are configured and the addresses match, decide whether you allow linking accounts by email. Auth.js refuses automatic linking by default (`OAuthAccountNotLinked`), which is the safe choice; show a clear message on that error instead of a generic failure.

## Problem 1: the link is "already used" before the user clicks it

This is the most common complaint about magic links. Some corporate mail systems and security gateways open every link in an incoming email to scan it. The scanner's request hits the callback, the token is consumed, and the real click a minute later fails with a `Verification` error. You will not see this in testing with a personal inbox.

The fix is to never put the consuming URL directly in the email. Link to a page of your own that shows a button, and let the button go to the real callback. Scanners load pages; they do not usually press buttons.

```ts
Resend({
  // ...
  async sendVerificationRequest({ identifier: email, url, provider }) {
    const confirm = new URL("/login/confirm", new URL(url).origin);
    confirm.searchParams.set("next", url);              // the Auth.js callback URL
    // sendEmail / loginEmail: your own Resend call and template
    await sendEmail({ to: email, from: provider.from, subject: "Your sign-in link", html: loginEmail(confirm.toString()) });
  },
}),
```

```tsx
// app/login/confirm/page.tsx
export default async function Confirm({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  let target = "/login";
  try {
    const u = new URL(next ?? "");
    // Keep only path + query, so the link can never leave this site.
    if (u.pathname === "/api/auth/callback/resend") target = u.pathname + u.search;
  } catch {}
  return (
    <main>
      <h1>Sign in to Acme</h1>
      <a href={target} className="button">Continue</a>
    </main>
  );
}
```

The page keeps only the path and query of `next`, and only when the path is the Auth.js callback; otherwise it would be an open redirect. When you override `sendVerificationRequest` you also own the email itself, so write a plain one: one sentence, one link, the expiry, and "if you did not ask for this, ignore this email".

## Problem 2: the email never arrives

Resend only sends from domains you have verified (SPF and DKIM records in your DNS). Until then, the `from` address is rejected or the message lands in spam. Three habits prevent most delivery problems:

- Send from a subdomain, such as `mail.acme.com`, so that sign-in email reputation is separate from your main domain's other mail.
- Add a DMARC record for the domain. Large mailbox providers expect it from bulk senders, and it costs one DNS entry.
- Keep the sign-in email transactional. No newsletter footer, no tracking pixels, no images. It should look like what it is.

Then send yourself a link at Gmail and at Outlook before launch, and check that both land in the inbox.

## Problem 3: your sign-in form sends email for anyone

The form accepts any address and sends an email to it. Without a limit, someone can use it to flood a stranger's inbox with your messages, which harms that person and your domain's reputation. Rate-limit the action, both per IP and per target address:

```ts
"use server";
const email = normalizeEmail(String(formData.get("email") ?? ""));
const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
if (!(await allow(`login-ip:${ip}`, 10, "1 hour")) || !(await allow(`login-email:${email}`, 3, "15 minutes"))) {
  redirect("/login?sent=1");   // same response either way
}
await signIn("resend", { email, redirectTo: "/chat" });
```

Note the response: whether the limit was hit, the address is new or it belongs to an existing user, the page says the same thing ("if this address can sign in, a link is on its way"). Different messages let anyone test which addresses have accounts. The [Postgres rate limiter](/blog/rate-limit-llm-endpoints-postgres/) from an earlier post works for `allow()`; it needs no new infrastructure.

## Problem 4: one person, two accounts

`Ana@Example.com` and `ana@example.com` are the same inbox for practically every mail provider, but different strings. If the user types one on Monday and the other on Friday, a naive setup creates two users, and the second one has none of the first one's chats or subscription. Normalize before the address reaches Auth.js:

```ts
Resend({
  // ...
  normalizeIdentifier(identifier) {
    const email = identifier.trim().toLowerCase();
    if (email.split("@").length !== 2) throw new Error("Invalid email");
    return email;
  },
}),
```

Lowercase and trim; do not go further. Removing dots or `+tags` is right for some providers and wrong for others, and getting it wrong merges two different people.

## What to log

Log each sign-in request (hashed address, IP, whether the rate limit applied) and each `Verification` error. A rising rate of verification errors from one company's domain is how you discover a link scanner. And because the `verification_token` table only grows from abandoned requests, delete expired rows once a day.

## Summary

- Magic links need a database adapter; the token is stored hashed and works once.
- Set `maxAge` to about 15 minutes instead of the 24-hour default.
- Link to a confirm page with a button, not straight to the callback, so link scanners cannot use up the token. Validate the `next` parameter.
- Verify your sending domain in Resend, send from a subdomain, add DMARC.
- Rate-limit the form per IP and per address, and give the same response in every case.
- Normalize addresses with `normalizeIdentifier`: trim and lowercase, nothing more.

<!-- site-only -->

*Agentwright Starter includes Auth.js v5 with GitHub sign-in, database sessions and an optional Resend magic link with a 15-minute lifetime, switched on by one environment variable. Launch price $99; see the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed against the Auth.js documentation before publishing.*

<!-- /site-only -->
