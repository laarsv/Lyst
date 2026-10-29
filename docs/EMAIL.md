# Email (SMTP)

Lyst sends its transactional mail over plain **SMTP**, so it works with any
mail server or provider you already have: your hosting provider's mailbox,
a transactional-mail relay, or a self-hosted server (Postfix, Mailcow, …).
There is no provider-specific code and no extra dependency; Lyst only uses
the Python standard library.

What Lyst sends:

- **User invitations** — when an admin invites someone, the link in the
  email is the only way they can set their initial password.
- **Password resets** — the "Passwort vergessen?" flow on the login page.
- **Reminders** — list, plant-care and task reminders scheduled by
  APScheduler (e.g. "remind me about the shopping list every Friday at
  17:00").
- **Notifications** — @-mentions in notes and newly assigned tasks.
- **Shares** — recipes, recipe books and notes shared with someone who has
  no Lyst account.

Every mail has a plain-text part and an HTML part (UTF-8).

Email is **optional**: leave the SMTP settings empty and Lyst still works,
with graceful degradation (see below).

---

## Setup

### 1. Get SMTP credentials

You need four things from your mail provider:

- the **SMTP server name** (host),
- the **port** — use **587** with STARTTLS. Many hosting providers block
  outbound port 25, and some also block 465, so 587 is the safe choice,
- a **user name** and **password** for an account that may send mail,
- the **sender address** the account is allowed to use. Most providers only
  accept addresses that belong to the account or its verified domain and
  reject everything else.

For good deliverability, publish SPF, DKIM and DMARC records for the
sender domain (your provider's documentation explains how).

### 2. Set the env vars

In your `.env`:

```ini
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=587
SMTP_USER=lyst@your-domain.app
SMTP_PASSWORD=<the account's password>
SMTP_SECURITY=auto
SMTP_FROM_EMAIL=lyst@your-domain.app
SMTP_FROM_NAME=Lyst
```

| Variable | Default | Meaning |
|---|---|---|
| `SMTP_HOST` | empty | Server name. |
| `SMTP_PORT` | `587` | Server port. |
| `SMTP_USER` | empty | Login name (often the full address). |
| `SMTP_PASSWORD` | empty | Login password. Treat it as a secret; Lyst never logs it. |
| `SMTP_SECURITY` | `auto` | `auto`: TLS from the first byte on port 465, STARTTLS on every other port. Force with `starttls` or `ssl`. |
| `SMTP_FROM_EMAIL` | `info@vrwb.de` | Sender address. **Set this** to an address your SMTP account may send from. If the backend gets it empty, the login name is used. |
| `SMTP_FROM_NAME` | `Lyst` | Display name shown as the sender. |

Email counts as configured as soon as `SMTP_HOST`, `SMTP_USER` and
`SMTP_PASSWORD` are all set. Lyst always verifies the server certificate
and host name, so the server needs a valid certificate for the name you put
into `SMTP_HOST`.

### 3. Restart and test

```bash
docker compose up -d
```

Then go to **Admin → Einstellungen → E-Mail-Versand testen** and send a
test mail to your own address. The test exercises the full path (connect,
TLS, login, sender, delivery to the server). A successful response means
real invitations and resets will work too. It does not prove the mail
arrives in the inbox and not in spam; check that on the receiving side.

---

## Disabling email (graceful degradation)

If you don't want email — air-gapped instance, single-user, "I'll just
share invite links by hand" — leave the variables empty:

```ini
SMTP_HOST=
SMTP_USER=
SMTP_PASSWORD=
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
- **Everything else** (reminders, mentions, task notifications, shares):
  not sent. The scheduler still runs; the log only says
  `SMTP not configured — email skipped` (without recipient or subject).

This means the app stays fully functional offline; the only thing missing
is the convenience of links arriving in inboxes by themselves.

---

## How it behaves

- Sending never makes a request fail by itself: if the server is
  unreachable or refuses a mail, the feature that triggered it carries on
  (invitations and admin-triggered resets are the exception: they report
  the failure to the admin and the invitation is not saved).
- The recipient must be exactly one plain address, and header values (such
  as the subject) must not contain line breaks. Anything else is rejected
  before a connection is opened.
- The log contains only the kind of error and the SMTP reply code, never
  the recipient, subject, text or password.

The code is in [`backend/app/email/sender.py`](../backend/app/email/sender.py)
(`send_email`, `mail_enabled`); the rest of the codebase only calls
`await send_email(to, subject, html)`.

---

## Troubleshooting

### Test email returns 502 "Der SMTP-Server hat den Versand abgelehnt …"

Lyst could not hand the mail to the server. The reason is in the backend
log — `docker compose logs backend | tail -50` — as
`SMTP send failed: <ErrorName> (code <n>)`:

| Log line | Usual cause |
|---|---|
| `SMTPAuthenticationError (code 535)` | Wrong `SMTP_USER` / `SMTP_PASSWORD`, or the account needs an app-specific password. |
| `SMTPSenderRefused` / `SMTPRecipientsRefused` | `SMTP_FROM_EMAIL` is not allowed for this account, or the server refuses the recipient. |
| `SMTPNotSupportedError` | The server doesn't offer STARTTLS on this port. Check `SMTP_PORT` / `SMTP_SECURITY` (port 465 needs `ssl` or `auto`). |
| `SSLCertVerificationError` | The certificate doesn't match `SMTP_HOST` or is not trusted. Use the host name the certificate was issued for. |
| `TimeoutError`, `ConnectionRefusedError`, `gaierror` | Host or port wrong, or outbound traffic to that port is blocked by your firewall or hosting provider. Try 587. |
| `SMTPServerDisconnected` | The server closed the connection, often because of the wrong security mode for the port. |

### Test email returns 503 "SMTP ist nicht konfiguriert"

`SMTP_HOST`, `SMTP_USER` or `SMTP_PASSWORD` is empty in the running
backend. Confirm that `.env` has the values and restart with
`docker compose up -d` (restart, not just running, so the new env vars are
picked up).

### Mail arrives but lands in spam

Almost always a DNS issue on the sender domain:

- SPF record present and includes your mail provider's sending servers.
- DKIM record published and active.
- DMARC record published with at least `p=none` so receivers know to
  evaluate SPF/DKIM at all.

Your provider's dashboard or documentation shows how to set up and verify
all three.
