import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

BREVO_API_URL = "https://api.brevo.com/v3/smtp/email"


async def send_email(to: str, subject: str, html: str) -> bool:
    """Send an email via Brevo. Returns True on success.

    If no API key is configured, logs and returns False so dev environments
    don't crash, but the call is still treated as a no-op success path
    by the callers (we just log)."""
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
    except Exception as e:
        logger.error("Brevo send failed to=%s subject=%s err=%s", to, subject, e)
        return False
