"""SMTP sending: STARTTLS/SSL, login, error handling, header protection.

No network: smtplib.SMTP / SMTP_SSL are replaced by a fake that records the
conversation. Delivery to a real server is NOT covered by these tests.
"""

import asyncio
import email
import smtplib
import ssl
import threading
from email import policy
from types import SimpleNamespace

import pytest
from pydantic import SecretStr

from app.core.config import settings
from app.email import sender, templates
from app.email.sender import html_to_text, mail_enabled, send_email


class FakeSMTP:
    """Records the conversation instead of opening a connection."""

    instances: list["FakeSMTP"] = []
    fail_login: Exception | None = None
    fail_send: Exception | None = None

    def __init__(self, host, port, timeout=None, context=None):
        self.kind = "plain"
        self.host, self.port, self.timeout, self.context = host, port, timeout, context
        self.calls: list[str] = []
        self.sent = None
        self.thread = threading.get_ident()
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def ehlo(self):
        self.calls.append("ehlo")

    def starttls(self, context=None):
        self.calls.append("starttls")
        self.starttls_context = context

    def login(self, user, password):
        self.calls.append(f"login:{user}")
        self.password = password
        if FakeSMTP.fail_login:
            raise FakeSMTP.fail_login

    def send_message(self, msg, from_addr, to_addrs):
        self.calls.append("send")
        if FakeSMTP.fail_send:
            raise FakeSMTP.fail_send
        self.sent = (msg, from_addr, to_addrs)


class FakeSMTPSSL(FakeSMTP):
    def __init__(self, host, port, timeout=None, context=None):
        super().__init__(host, port, timeout, context)
        self.kind = "ssl"


@pytest.fixture()
def smtp(monkeypatch):
    FakeSMTP.instances = []
    FakeSMTP.fail_login = None
    FakeSMTP.fail_send = None
    monkeypatch.setattr(sender.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(sender.smtplib, "SMTP_SSL", FakeSMTPSSL)
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.example.test")
    monkeypatch.setattr(settings, "SMTP_PORT", 587)
    monkeypatch.setattr(settings, "SMTP_USER", "login@example.test")
    monkeypatch.setattr(settings, "SMTP_PASSWORD", SecretStr("geheim"))
    monkeypatch.setattr(settings, "SMTP_SECURITY", "auto")
    monkeypatch.setattr(settings, "SMTP_FROM_EMAIL", "lyst@example.test")
    monkeypatch.setattr(settings, "SMTP_FROM_NAME", "Lyst")
    return FakeSMTP


def _send(to="max@example.test", subject="Betreff", html="<p>Hallo</p>", **kw):
    return asyncio.run(send_email(to, subject, html, **kw))


def test_starttls_on_587_with_login_and_envelope(smtp):
    assert _send() is True
    server = smtp.instances[0]
    assert server.kind == "plain"
    assert (server.host, server.port) == ("smtp.example.test", 587)
    assert server.calls == ["ehlo", "starttls", "ehlo", "login:login@example.test", "send"]
    assert server.password == "geheim"
    msg, from_addr, to_addrs = server.sent
    assert from_addr == "lyst@example.test"
    assert to_addrs == ["max@example.test"]
    assert msg["To"] == "max@example.test"
    assert msg["Subject"] == "Betreff"
    assert "Lyst" in msg["From"] and "lyst@example.test" in msg["From"]


def test_certificate_and_hostname_are_verified(smtp):
    _send()
    ctx = smtp.instances[0].starttls_context
    assert ctx.verify_mode == ssl.CERT_REQUIRED
    assert ctx.check_hostname is True


def test_timeout_is_set(smtp):
    _send()
    assert smtp.instances[0].timeout == sender.SMTP_TIMEOUT_SECONDS


def test_implicit_tls_on_465_with_auto(smtp, monkeypatch):
    monkeypatch.setattr(settings, "SMTP_PORT", 465)
    assert _send() is True
    server = smtp.instances[0]
    assert server.kind == "ssl"
    assert "starttls" not in server.calls
    assert server.context.verify_mode == ssl.CERT_REQUIRED
    assert server.context.check_hostname is True


def test_explicit_security_overrides_the_port(smtp, monkeypatch):
    monkeypatch.setattr(settings, "SMTP_SECURITY", "ssl")
    assert _send() is True
    assert smtp.instances[0].kind == "ssl"
    monkeypatch.setattr(settings, "SMTP_PORT", 465)
    monkeypatch.setattr(settings, "SMTP_SECURITY", "starttls")
    assert _send() is True
    assert smtp.instances[1].kind == "plain"
    assert "starttls" in smtp.instances[1].calls


def test_sender_falls_back_to_login_when_empty(smtp, monkeypatch):
    monkeypatch.setattr(settings, "SMTP_FROM_EMAIL", "")
    assert settings.mail_sender_email == "login@example.test"
    assert _send() is True
    assert smtp.instances[0].sent[1] == "login@example.test"


def test_send_runs_in_a_worker_thread(smtp):
    assert _send() is True
    assert smtp.instances[0].thread != threading.get_ident()


@pytest.mark.parametrize("missing", ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"])
def test_not_configured_does_not_connect(smtp, monkeypatch, missing, caplog):
    monkeypatch.setattr(
        settings, missing, SecretStr("") if missing == "SMTP_PASSWORD" else ""
    )
    assert settings.mail_configured is False
    assert mail_enabled() is False
    with caplog.at_level("WARNING"):
        assert _send() is False
    assert smtp.instances == []
    assert "max@example.test" not in caplog.text
    assert "Betreff" not in caplog.text


def test_configured_when_host_user_password_set(smtp):
    assert mail_enabled() is True


@pytest.mark.parametrize(
    "error",
    [
        smtplib.SMTPAuthenticationError(535, b"nope"),
        smtplib.SMTPServerDisconnected("weg"),
        smtplib.SMTPNotSupportedError("kein STARTTLS"),
        ConnectionRefusedError("zu"),
        TimeoutError("zu langsam"),
        ssl.SSLCertVerificationError("Zertifikat passt nicht"),
        RuntimeError("unerwartet"),
    ],
)
def test_login_failures_return_false_and_never_raise(smtp, error):
    smtp.fail_login = error
    assert _send() is False


@pytest.mark.parametrize(
    "error",
    [
        smtplib.SMTPSenderRefused(553, b"not allowed", "lyst@example.test"),
        smtplib.SMTPRecipientsRefused({"max@example.test": (550, b"no")}),
        OSError("kaputt"),
    ],
)
def test_send_failures_return_false_and_never_raise(smtp, error):
    smtp.fail_send = error
    assert _send() is False


def test_connection_failure_returns_false(monkeypatch, smtp):
    def boom(*a, **k):
        raise ConnectionRefusedError("zu")

    monkeypatch.setattr(sender.smtplib, "SMTP", boom)
    assert _send() is False


def test_failure_log_has_no_address_subject_text_or_password(smtp, caplog):
    smtp.fail_login = smtplib.SMTPAuthenticationError(
        535, b"max@example.test geheim Geheimer-Betreff"
    )
    with caplog.at_level("WARNING"):
        _send(subject="Geheimer-Betreff", html="<p>Geheimer-Text</p>")
    for secret in ("max@example.test", "geheim", "Geheimer-Betreff", "Geheimer-Text"):
        assert secret not in caplog.text
    assert "SMTPAuthenticationError" in caplog.text
    assert "535" in caplog.text


def test_password_is_not_in_settings_repr():
    assert "geheim" not in repr(settings.SMTP_PASSWORD)
    assert isinstance(settings.SMTP_PASSWORD, SecretStr)


@pytest.mark.parametrize(
    "to",
    [
        "a@b.test, c@d.test",
        "a@b.test; c@d.test",
        "a@b.test\nBcc: x@y.test",
        "a@b.test\r\nBcc: x@y.test",
        "Max <a@b.test>",
        '"a b"@c.test',
        "kein-at",
        "a@b@c.test",
        "",
    ],
)
def test_bad_recipient_is_rejected_without_connecting(smtp, to):
    assert _send(to=to) is False
    assert smtp.instances == []


@pytest.mark.parametrize("subject", ["Hallo\nBcc: x@y.test", "Hallo\rBcc: x@y.test"])
def test_header_injection_in_subject_is_rejected(smtp, subject):
    assert _send(subject=subject) is False
    assert smtp.instances == []


def test_header_injection_in_sender_name_is_rejected(smtp, monkeypatch):
    monkeypatch.setattr(settings, "SMTP_FROM_NAME", "Lyst\nBcc: x@y.test")
    assert _send() is False
    assert smtp.instances == []


def test_message_has_text_and_html_part_in_utf8(smtp):
    html = "<p>Gie&szlig;en &ndash; fertig &#128167;</p>"
    assert _send(subject="Gießen 💧 – Erinnerung", html=html, text="Gießen 💧 fertig") is True
    msg = smtp.instances[0].sent[0]
    assert msg.get_content_type() == "multipart/alternative"
    assert msg.get_body(("plain",)).get_content().strip() == "Gießen 💧 fertig"
    assert msg.get_body(("html",)).get_content().strip() == html
    # Wire format: encodes cleanly and survives a round trip.
    parsed = email.message_from_bytes(msg.as_bytes(), policy=policy.default)
    assert parsed["Subject"] == "Gießen 💧 – Erinnerung"
    assert parsed.get_body(("plain",)).get_content().strip() == "Gießen 💧 fertig"
    assert parsed["Date"] and parsed["Message-ID"].endswith("@example.test>")


def test_text_part_is_derived_from_html_when_not_given(smtp):
    assert _send(html="<p>Hallo <strong>Max</strong>,</p><p>bis bald</p>") is True
    msg = smtp.instances[0].sent[0]
    assert msg.get_body(("plain",)).get_content() == "Hallo Max,\n\nbis bald\n"


def test_html_to_text_keeps_link_urls_and_drops_markup():
    html = (
        "<html><head><title>Titel</title><style>p{color:red}</style></head>"
        "<body><p>Hallo&nbsp;Max &amp; Co,</p>"
        '<p><a href="https://lyst.example/accept?token=abc">Konto einrichten</a></p>'
        '<p>Mehr unter <a href="https://github.com/laarsv/Lyst">github.com/laarsv/Lyst</a>'
        '<br>Zeile zwei</p><a href="https://x.test/"></a></body></html>'
    )
    text = html_to_text(html)
    assert "Titel" not in text and "color:red" not in text
    assert "<" not in text and ">" not in text
    assert "Hallo\xa0Max & Co," in text or "Hallo Max & Co," in text
    assert "Konto einrichten: https://lyst.example/accept?token=abc" in text
    assert "github.com/laarsv/Lyst" in text
    assert "Zeile zwei" in text
    assert "https://x.test/" in text
    assert "\n\n\n" not in text


def test_html_to_text_of_empty_html_is_empty():
    assert html_to_text("") == ""


_ALL_TEMPLATES = [
    lambda: templates.invite_email("Max", "https://lyst.example/accept-invite?token=t1"),
    lambda: templates.password_reset_email("Max", "https://lyst.example/reset-password?token=t2"),
    lambda: templates.reminder_email("Einkauf", "Milch nicht vergessen", "https://lyst.example/lists/1"),
    lambda: templates.plant_care_reminder_email("Monstera", "water", "100 ml", "https://lyst.example/plants/1"),
    lambda: templates.welcome_email("Max", "https://lyst.example"),
    lambda: templates.test_email("Admin", "max@example.test"),
    lambda: templates.recipe_share_email("Anna", "Käsekuchen", "https://lyst.example/share/recipe/t3"),
    lambda: templates.recipe_book_share_email("Anna", "https://lyst.example/share/book/t4"),
    lambda: templates.task_assigned_email("Anna", "Müll rausbringen", "list", "Haushalt", "https://lyst.example/lists/2?task=5"),
    lambda: templates.task_reminder_email("Müll rausbringen", "note", "Haushalt", "https://lyst.example/notes/2?task=5"),
    lambda: templates.note_mention_email("Anna", "Ideen", "https://lyst.example/notes/3"),
    lambda: templates.note_share_email("Anna", "Ideen", "https://lyst.example/share/note/t5"),
]


@pytest.mark.parametrize("make", _ALL_TEMPLATES)
def test_every_template_gets_a_useful_text_part(smtp, make):
    subject, html = make()
    assert _send(subject=subject, html=html) is True
    msg = smtp.instances[-1].sent[0]
    text = msg.get_body(("plain",)).get_content()
    assert text.strip()
    assert "<" not in text and "font-family" not in text
    # Every link target of the HTML version is also readable in the text part.
    for url in {part.split('"')[0] for part in html.split('href="')[1:]}:
        assert url in text


def test_admin_test_email_endpoint(smtp, monkeypatch):
    from fastapi import HTTPException

    from app.routers.admin import TestEmailRequest, post_test_email

    admin = SimpleNamespace(email="admin@example.test", name="Admin")
    result = asyncio.run(post_test_email(TestEmailRequest(), current=admin))
    assert smtp.instances[0].sent[2] == ["admin@example.test"]
    assert result["data"]["to"] == "admin@example.test"

    smtp.fail_login = smtplib.SMTPAuthenticationError(535, b"nope")
    with pytest.raises(HTTPException) as err:
        asyncio.run(post_test_email(TestEmailRequest(), current=admin))
    assert err.value.status_code == 502

    monkeypatch.setattr(settings, "SMTP_PASSWORD", SecretStr(""))
    with pytest.raises(HTTPException) as err:
        asyncio.run(post_test_email(TestEmailRequest(), current=admin))
    assert err.value.status_code == 503


class _FakeDB:
    """Just enough of AsyncSession for invite_user."""

    def __init__(self):
        self.deleted = []
        self.added = []

    async def execute(self, *_):
        return SimpleNamespace(scalar_one_or_none=lambda: None)

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        pass

    async def refresh(self, obj):
        pass

    async def delete(self, obj):
        self.deleted.append(obj)


def test_invite_is_rolled_back_when_smtp_fails(smtp):
    from app.models.user import UserRole
    from app.services.admin_service import MailDeliveryError, invite_user

    smtp.fail_login = smtplib.SMTPAuthenticationError(535, b"nope")
    db = _FakeDB()
    with pytest.raises(MailDeliveryError):
        asyncio.run(invite_user(db, "neu@example.test", "Neu", UserRole.USER))
    assert db.deleted == db.added and len(db.added) == 1


def test_invite_without_smtp_keeps_the_account_and_logs_the_link(smtp, monkeypatch):
    from app.models.user import UserRole
    from app.services.admin_service import invite_user

    monkeypatch.setattr(settings, "SMTP_HOST", "")
    db = _FakeDB()
    user, mailed = asyncio.run(invite_user(db, "neu@example.test", "Neu", UserRole.USER))
    assert mailed is False and db.deleted == []
    assert smtp.instances == []
