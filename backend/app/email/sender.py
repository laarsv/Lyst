import logging

import resend

from app.core.config import settings

logger = logging.getLogger(__name__)

_initialized = False


def _ensure_init() -> None:
    global _initialized
    if not _initialized and settings.RESEND_API_KEY:
        resend.api_key = settings.RESEND_API_KEY
        _initialized = True


async def send_email(to: str, subject: str, html: str) -> bool:
    """Send an email via Resend. Returns True on success.

    If no API key is configured, logs and returns False so dev environments
    don't crash, but the call is still treated as a no-op success path
    by the callers (we just log)."""
    if not settings.RESEND_API_KEY:
        logger.warning(
            "RESEND_API_KEY not set — would send email to=%s subject=%s", to, subject
        )
        return False
    _ensure_init()
    try:
        resend.Emails.send(
            {
                "from": settings.RESEND_FROM_EMAIL,
                "to": [to],
                "subject": subject,
                "html": html,
            }
        )
        return True
    except Exception as e:
        logger.error("Resend send failed to=%s subject=%s err=%s", to, subject, e)
        return False
