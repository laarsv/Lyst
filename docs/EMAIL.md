# Email (Brevo)

Lyst uses [Brevo](https://www.brevo.com) to send three kinds of transactional
mail:

- **User invitations** — when an admin invites someone, the link in the
  email is the only way they can set their initial password.
- **Password resets** — the "Passwort vergessen?" flow on the login page.
- **Reminders** — list reminders scheduled by APScheduler (e.g. "remind me
  about the shopping list every Friday at 17:00").

Email is **optional**: leave the API key empty and Lyst still works, with
graceful degradation (see below).

---

## Setup

### 1. Get a Brevo API key

1. Sign up at <https://www.brevo.com> (free tier covers small self-hosted
   instances comfortably — 300 emails/day at time of writing).
2. **Verify the sender** you want to send from at *Senders, Domains &
   Dedicated IPs*. Verify the whole domain (SPF + DKIM + DMARC records)
   rather than a single address — that's what keeps mail out of spam.
3. Generate an API key at *SMTP & API → API Keys → Generate a new API key*.

### 2. Set the env vars

In your `.env`:

```ini
BREVO_API_KEY=xkeysib-xxxxxxxxxxxxxxxxxxxxxxxx
BREVO_FROM_EMAIL=info@your-domain.app
BREVO_FROM_NAME=Lyst
```

`BREVO_FROM_EMAIL` **must** be a verified sender (or belong to a verified
domain). Sending from an unverified address returns a 400 from Brevo.

### 3. Restart and test

```bash
docker compose up -d
```

Then go to **Admin → Einstellungen → E-Mail-Versand testen** and send a
test mail to your own address. The test endpoint exercises the full path
(API key, sender domain, DNS) in one click. A successful response means
real invitations and resets will work too.

---

## Disabling email (graceful degradation)

If you don't want email — air-gapped instance, single-user, "I'll just
share invite links by hand" — leave the variables empty:

```ini
BREVO_API_KEY=
# BREVO_FROM_EMAIL / BREVO_FROM_NAME can stay empty too
```

Behaviour with email disabled:

- **Invitations**: `POST /api/admin/users/invite` still creates the user
  account, but instead of sending mail it logs the invite link to the
  backend stdout:
  ```
  WARNING […] Email disabled — invite link for alice@example.com:
  https://lyst.example.com/accept-invite?token=eyJ…
  ```
  Copy/paste that link to the recipient out-of-band (Signal, Matrix,
  in person, whatever).
- **Password reset**: same pattern — the reset link is written to the log
  rather than sent.
- **Reminders**: silently skipped. The scheduler still runs, but anything
  that would have been sent gets logged at INFO level instead.

This means the app stays fully functional offline; the only thing missing
is the convenience of links arriving in inboxes by themselves.

---

## Alternatives to Brevo

The only Brevo-specific code is in
[`backend/app/email/sender.py`](../backend/app/email/sender.py). It's a
thin `httpx` wrapper around Brevo's transactional endpoint
(`POST https://api.brevo.com/v3/smtp/email`) and roughly 40 lines.

If you'd rather use SES, Mailgun, Postmark, or plain SMTP, swap that
module for one of those SDKs (or `aiosmtplib` for SMTP). The rest of the
codebase only calls `await send_email(to, subject, html)` — no
Brevo-specific assumptions leak elsewhere.

A PR to make the provider pluggable via env (`MAIL_PROVIDER=brevo|smtp`)
would be very welcome — see [CONTRIBUTING.md](../CONTRIBUTING.md).

---

## Troubleshooting

### Test email returns 502 "Brevo hat den Versand abgelehnt"

The Brevo API itself rejected the send. Check:

1. The API key is valid (regenerate if you're not sure).
2. The address in `BREVO_FROM_EMAIL` is a verified sender (or on a
   verified domain) in the Brevo dashboard.
3. You're not over the daily limit on the free tier.

The exact Brevo error is in the backend log — `docker compose logs
backend | tail -50`.

### Test email returns 503 "BREVO_API_KEY ist nicht gesetzt"

Self-explanatory — `BREVO_API_KEY` is empty in the running backend.
Confirm that `.env` has the value and restart with `docker compose up -d`
(restart, not just running, so the new env var is picked up).

### Mail arrives but lands in spam

Almost always a DNS issue:

- SPF record present and includes Brevo's sending servers (Brevo's domain
  setup wizard handles this).
- DKIM record published and active.
- DMARC record published with at least `p=none` so receivers know to
  evaluate SPF/DKIM at all.

The Brevo dashboard's *Senders, Domains & Dedicated IPs* page shows live
verification status of all three.
