import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

BREVO_API_URL = "https://api.brevo.com/v3/smtp/email"


def mail_enabled() -> bool:
    """Whether outgoing mail is configured at all.

    Callers that hold a one-time link (invite, password reset) check this
    BEFORE building a mail, so they can log the link instead — that is the
    documented air-gapped path in docs/EMAIL.md."""
    return bool(settings.BREVO_API_KEY)


async def send_email(to: str, subject: str, html: str) -> bool:
    """Send an email via Brevo. Returns True on success.

    Returns False both when mail is switched off and when Brevo rejects the
    send — callers that need to tell those apart use `mail_enabled()`."""
    if not settings.BREVO_API_KEY:
        logger.warning(
            "BREVO_API_KEY not set — would send email to=%s subject=%s", to, subject
        )
        return False
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(
                BREVO_API_URL,
                json={
                    "sender": {
                        "name": settings.BREVO_FROM_NAME,
                        "email": settings.BREVO_FROM_EMAIL,
                    },
                    "to": [{"email": to}],
                    "subject": subject,
                    "htmlContent": html,
                },
                headers={
                    "api-key": settings.BREVO_API_KEY,
                    "content-type": "application/json",
                },
            )
            res.raise_for_status()
        return True
    except httpx.HTTPStatusError as e:
        # Brevo puts the REASON in the response body ("sender not valid",
        # "unrecognised key", quota). str(exc) carries only the status line,
        # so logging the exception alone left the documented debugging path
        # ("the exact Brevo error is in the backend log") with nothing in it.
        body = e.response.text[:500] if e.response is not None else ""
        logger.error(
            "Brevo send failed to=%s subject=%s status=%s body=%s",
            to, subject, e.response.status_code if e.response is not None else "?", body,
        )
        return False
    except Exception as e:
        logger.error("Brevo send failed to=%s subject=%s err=%r", to, subject, e)
        return False
