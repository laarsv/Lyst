"""Outgoing mail over SMTP (standard library only, no extra dependency).

Port 587 + STARTTLS is the default; port 465 uses TLS from the first byte
(SMTP_SECURITY=auto picks by port). Certificate and hostname are always
verified. The blocking `smtplib` call runs in a worker thread so it never
stalls the event loop.

The log never contains recipient, subject, body or password — only the kind
of error and the SMTP reply code.
"""

import asyncio
import logging
import re
import smtplib
import ssl
from email.message import EmailMessage
from email.policy import SMTP as SMTP_POLICY
from email.utils import formataddr, formatdate, make_msgid
from html.parser import HTMLParser

from app.core.config import settings

logger = logging.getLogger(__name__)

SMTP_TIMEOUT_SECONDS = 15.0
SMTP_IMPLICIT_TLS_PORT = 465
# Exactly one plain address: no whitespace, comma, semicolon, angle brackets,
# parentheses or quotes and a single "@" (so nobody can smuggle in more
# recipients or headers).
_RECIPIENT = re.compile(r'[^\s<>,;"()@]+@[^\s<>,;"()@]+')


def mail_enabled() -> bool:
    """Whether outgoing mail is configured at all.

    Callers that hold a one-time link (invite, password reset) check this
    BEFORE building a mail, so they can log the link instead — that is the
    documented air-gapped path in docs/EMAIL.md."""
    return settings.mail_configured


_BLOCK_TAGS = {
    "p", "div", "table", "tr", "td", "th", "ul", "ol", "li", "blockquote",
    "h1", "h2", "h3", "h4", "h5", "h6",
}
_SKIP_TAGS = {"head", "title", "style", "script"}


class _TextExtractor(HTMLParser):
    """Turns the (simple, table-based) mail HTML into readable plain text.
    Links keep their URL, because a text-only mail client has no button."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0
        self._href: str | None = None
        self._label: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in _SKIP_TAGS:
            self._skip += 1
        elif tag == "br":
            self.parts.append("\n")
        elif tag in _BLOCK_TAGS:
            self.parts.append("\n\n")
        elif tag == "a":
            self._href = dict(attrs).get("href")
            self._label = []

    def handle_endtag(self, tag):
        if tag in _SKIP_TAGS:
            self._skip = max(0, self._skip - 1)
        elif tag in _BLOCK_TAGS:
            self.parts.append("\n\n")
        elif tag == "a" and self._href is not None:
            label = "".join(self._label).strip()
            href = self._href
            self._href = None
            if not label:
                self.parts.append(href)
            elif label not in href:
                self.parts.append(f": {href}")

    def handle_data(self, data):
        if self._skip:
            return
        data = re.sub(r"\s+", " ", data)
        self.parts.append(data)
        if self._href is not None:
            self._label.append(data)


def html_to_text(html: str) -> str:
    """Plain-text rendering of a mail body, used as the text/plain part."""
    parser = _TextExtractor()
    parser.feed(html)
    parser.close()
    raw = "".join(parser.parts)
    lines = [re.sub(r" {2,}", " ", line).strip() for line in raw.splitlines()]
    text = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    return text + "\n" if text else ""


def _build_message(to: str, subject: str, text: str, html: str) -> EmailMessage:
    """Multipart mail (text and HTML, UTF-8). Raises ValueError when a header
    value contains a line break."""
    sender = settings.mail_sender_email
    msg = EmailMessage(policy=SMTP_POLICY)
    msg["From"] = formataddr((settings.SMTP_FROM_NAME, sender))
    msg["To"] = to
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=False)
    msg["Message-ID"] = make_msgid(domain=sender.rpartition("@")[2] or None)
    msg["Auto-Submitted"] = "auto-generated"
    msg.set_content(text, charset="utf-8")
    msg.add_alternative(html, subtype="html", charset="utf-8")
    return msg


def _security() -> str:
    if settings.SMTP_SECURITY == "auto":
        return "ssl" if settings.SMTP_PORT == SMTP_IMPLICIT_TLS_PORT else "starttls"
    return settings.SMTP_SECURITY


def _smtp_send(msg: EmailMessage, to: str) -> None:
    security = _security()
    context = ssl.create_default_context()  # verifies certificate and hostname
    if security == "ssl":
        connection = smtplib.SMTP_SSL(
            settings.SMTP_HOST,
            settings.SMTP_PORT,
            timeout=SMTP_TIMEOUT_SECONDS,
            context=context,
        )
    else:
        connection = smtplib.SMTP(
            settings.SMTP_HOST, settings.SMTP_PORT, timeout=SMTP_TIMEOUT_SECONDS
        )
    with connection as server:
        server.ehlo()
        if security == "starttls":
            server.starttls(context=context)
            server.ehlo()
        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD.get_secret_value())
        server.send_message(msg, from_addr=settings.mail_sender_email, to_addrs=[to])


async def send_email(to: str, subject: str, html: str, text: str | None = None) -> bool:
    """Send an email over SMTP. Returns True on success.

    `text` is the plain-text alternative; when omitted it is derived from
    `html`. Returns False both when mail is switched off and when sending
    fails — callers that need to tell those apart use `mail_enabled()`.
    Never raises."""
    if not settings.mail_configured:
        logger.warning("SMTP not configured — email skipped")
        return False
    if not _RECIPIENT.fullmatch(to):
        logger.warning("Email skipped: invalid recipient address")
        return False
    try:
        msg = _build_message(
            to, subject, html_to_text(html) if text is None else text, html
        )
    except ValueError as e:
        logger.warning("Email skipped: invalid header (%s)", type(e).__name__)
        return False
    try:
        await asyncio.to_thread(_smtp_send, msg, to)
    except Exception as e:  # noqa: BLE001 - mail must never break the caller
        # Exception texts can carry addresses or server replies: log only the
        # kind of error and the SMTP code.
        logger.error(
            "SMTP send failed: %s (code %s)",
            type(e).__name__,
            getattr(e, "smtp_code", None),
        )
        return False
    return True
