"""HTML email templates. Plain string formatting; trivially extendable."""

# Brand tokens kept in sync with the frontend tailwind config.
_BRAND = "#00c896"
_BRAND_HOVER = "#00b386"
_BG = "#f5f5f0"
_INK = "#1a1a1a"
_MUTED = "#888884"
_LINE = "#e5e5e3"

_BASE = f"""<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{title}}</title>
</head>
<body style="margin:0;padding:0;background:{_BG};font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:{_INK};">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:{_BG};padding:32px 0;">
<tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid {_LINE};border-radius:10px;overflow:hidden;">
<tr><td style="padding:32px 40px 16px 40px;">
<div style="font-size:28px;font-weight:500;color:{_BRAND};letter-spacing:-0.5px;">lyst</div>
</td></tr>
<tr><td style="padding:8px 40px 32px 40px;font-size:16px;line-height:1.55;color:{_INK};">
{{body}}
</td></tr>
<tr><td style="padding:20px 40px;background:{_BG};color:{_MUTED};font-size:13px;text-align:center;border-top:1px solid {_LINE};">
Diese E-Mail wurde automatisch von lyst gesendet.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""


def _btn(url: str, label: str) -> str:
    return (
        f'<p style="margin:24px 0;">'
        f'<a href="{url}" style="display:inline-block;background:{_BRAND};color:#ffffff;'
        f'text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:500;">'
        f"{label}</a></p>"
    )


def invite_email(name: str, invite_url: str) -> tuple[str, str]:
    body = (
        f"<p>Hallo {name},</p>"
        f"<p>du wurdest zu <strong>lyst</strong> eingeladen — der App für deine Listen, "
        f"Rezepte und Notizen.</p>"
        f"<p>Klicke auf den Button, um dein Konto einzurichten:</p>"
        f"{_btn(invite_url, 'Konto einrichten')}"
        f"<p style='color:{_MUTED};font-size:14px;'>Der Link ist 48 Stunden gültig.</p>"
    )
    return "Du wurdest zu lyst eingeladen", _BASE.format(title="lyst Einladung", body=body)


def password_reset_email(name: str, reset_url: str) -> tuple[str, str]:
    body = (
        f"<p>Hallo {name},</p>"
        f"<p>du hast ein neues Passwort für dein lyst-Konto angefordert. "
        f"Klicke auf den Button, um ein neues Passwort zu setzen:</p>"
        f"{_btn(reset_url, 'Passwort zurücksetzen')}"
        f"<p style='color:{_MUTED};font-size:14px;'>Der Link ist 1 Stunde gültig. "
        f"Falls du diese E-Mail nicht angefordert hast, kannst du sie ignorieren.</p>"
    )
    return "lyst – Passwort zurücksetzen", _BASE.format(title="Passwort zurücksetzen", body=body)


def reminder_email(list_title: str, message: str | None, app_url: str) -> tuple[str, str]:
    msg_html = f"<p><em>{message}</em></p>" if message else ""
    body = (
        f"<p>Erinnerung an deine Liste:</p>"
        f"<h2 style='font-size:22px;margin:8px 0 16px 0;font-weight:500;letter-spacing:-0.01em;'>{list_title}</h2>"
        f"{msg_html}"
        f"{_btn(app_url, 'Liste öffnen')}"
    )
    return f"lyst erinnert: {list_title}", _BASE.format(title=f"Erinnerung: {list_title}", body=body)


def welcome_email(name: str, app_url: str) -> tuple[str, str]:
    body = (
        f"<p>Hallo {name},</p>"
        f"<p>willkommen bei <strong>lyst</strong>! Dein Konto ist jetzt einsatzbereit.</p>"
        f"<p>Erstelle deine erste Einkaufsliste, Packliste oder Notiz:</p>"
        f"{_btn(app_url, 'lyst öffnen')}"
        f"<p>Viel Spaß!</p>"
    )
    return "Willkommen bei lyst", _BASE.format(title="Willkommen bei lyst", body=body)


def test_email(triggered_by: str, recipient: str) -> tuple[str, str]:
    body = (
        f"<p>Das ist eine Test-E-Mail von <strong>lyst</strong>.</p>"
        f"<p>Wenn du diese Nachricht erhältst, ist der Mailversand über Resend "
        f"korrekt konfiguriert und lyst kann Einladungen, Passwort-Resets und "
        f"Erinnerungen verschicken.</p>"
        f"<p style='color:{_MUTED};font-size:14px;margin-top:32px;'>"
        f"Empfänger: <code>{recipient}</code><br>"
        f"Ausgelöst von: {triggered_by}"
        f"</p>"
    )
    return "lyst — Test-E-Mail", _BASE.format(title="Test-E-Mail", body=body)


def recipe_share_email(
    sharer_name: str, recipe_title: str, share_url: str
) -> tuple[str, str]:
    """External-share email: sender shared a recipe with someone who does
    not have a Lyst account. They get the public link."""
    body = (
        f"<p><strong>{sharer_name}</strong> hat dir ein Rezept geteilt:</p>"
        f'<p style="font-size:18px;margin:12px 0 4px 0;">"{recipe_title}"</p>'
        f"<p>Du kannst es direkt im Browser ansehen — kein Konto nötig:</p>"
        f"{_btn(share_url, 'Rezept öffnen')}"
        f"<p style='color:{_MUTED};font-size:14px;'>"
        f"Falls du auch eigene Rezepte verwalten möchtest, gibt es Lyst unter "
        f"<a href='https://github.com/laarsv/Lyst' style='color:{_BRAND};'>"
        f"github.com/laarsv/Lyst</a>.</p>"
    )
    return (
        f"{sharer_name} hat dir ein Rezept geteilt: {recipe_title}",
        _BASE.format(title=f"Rezept: {recipe_title}", body=body),
    )


def recipe_book_share_email(
    sharer_name: str, share_url: str
) -> tuple[str, str]:
    """External-share email for a whole recipe book."""
    body = (
        f"<p><strong>{sharer_name}</strong> hat dir das gesamte Rezeptbuch geteilt.</p>"
        f"<p>Du kannst alle Rezepte im Browser durchstöbern — kein Konto nötig:</p>"
        f"{_btn(share_url, 'Rezeptbuch öffnen')}"
        f"<p style='color:{_MUTED};font-size:14px;'>"
        f"Falls du auch eigene Rezepte verwalten möchtest, gibt es Lyst unter "
        f"<a href='https://github.com/laarsv/Lyst' style='color:{_BRAND};'>"
        f"github.com/laarsv/Lyst</a>.</p>"
    )
    return (
        f"{sharer_name} hat dir ein Rezeptbuch geteilt",
        _BASE.format(title="Geteiltes Rezeptbuch", body=body),
    )
