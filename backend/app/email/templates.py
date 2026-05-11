"""HTML email templates. Plain string formatting; trivially extendable."""

_BASE = """<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1c1e;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5f7;padding:32px 0;">
<tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
<tr><td style="padding:32px 40px 16px 40px;">
<div style="font-size:24px;font-weight:600;color:#0a84ff;letter-spacing:-0.5px;">Lyst</div>
</td></tr>
<tr><td style="padding:8px 40px 32px 40px;font-size:16px;line-height:1.5;color:#1c1c1e;">
{body}
</td></tr>
<tr><td style="padding:24px 40px;background:#fafafa;color:#8e8e93;font-size:13px;text-align:center;">
Diese E-Mail wurde automatisch von Lyst gesendet.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""


def _btn(url: str, label: str) -> str:
    return (
        f'<p style="margin:24px 0;">'
        f'<a href="{url}" style="display:inline-block;background:#0a84ff;color:#fff;'
        f'text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;">'
        f"{label}</a></p>"
    )


def invite_email(name: str, invite_url: str) -> tuple[str, str]:
    body = (
        f"<p>Hallo {name},</p>"
        f"<p>du wurdest zu <strong>Lyst</strong> eingeladen – der modernen App für deine Listen, "
        f"Einkäufe und Notizen.</p>"
        f"<p>Klicke auf den Button, um dein Konto einzurichten:</p>"
        f"{_btn(invite_url, 'Konto einrichten')}"
        f"<p style='color:#8e8e93;font-size:14px;'>Der Link ist 48 Stunden gültig.</p>"
    )
    return "Du wurdest zu Lyst eingeladen", _BASE.format(title="Lyst Einladung", body=body)


def password_reset_email(name: str, reset_url: str) -> tuple[str, str]:
    body = (
        f"<p>Hallo {name},</p>"
        f"<p>du hast eine neues Passwort für dein Lyst-Konto angefordert. "
        f"Klicke auf den Button, um ein neues Passwort zu setzen:</p>"
        f"{_btn(reset_url, 'Passwort zurücksetzen')}"
        f"<p style='color:#8e8e93;font-size:14px;'>Der Link ist 1 Stunde gültig. "
        f"Falls du diese E-Mail nicht angefordert hast, kannst du sie ignorieren.</p>"
    )
    return "Lyst – Passwort zurücksetzen", _BASE.format(title="Passwort zurücksetzen", body=body)


def reminder_email(list_title: str, message: str | None, app_url: str) -> tuple[str, str]:
    msg_html = f"<p><em>{message}</em></p>" if message else ""
    body = (
        f"<p>Erinnerung an deine Liste:</p>"
        f"<h2 style='font-size:22px;margin:8px 0 16px 0;'>{list_title}</h2>"
        f"{msg_html}"
        f"{_btn(app_url, 'Liste öffnen')}"
    )
    return f"Lyst erinnert: {list_title}", _BASE.format(title=f"Erinnerung: {list_title}", body=body)


def welcome_email(name: str, app_url: str) -> tuple[str, str]:
    body = (
        f"<p>Hallo {name},</p>"
        f"<p>willkommen bei <strong>Lyst</strong>! Dein Konto ist jetzt einsatzbereit.</p>"
        f"<p>Erstelle deine erste Einkaufsliste, Packliste oder Notiz:</p>"
        f"{_btn(app_url, 'Lyst öffnen')}"
        f"<p>Viel Spaß!</p>"
    )
    return "Willkommen bei Lyst", _BASE.format(title="Willkommen bei Lyst", body=body)
