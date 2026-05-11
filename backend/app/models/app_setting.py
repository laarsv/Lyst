from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class AppSetting(Base, TimestampMixin):
    """Generic key/value store for app-wide runtime settings (admin-overridable
    counterparts to .env defaults). Keep keys short and stable; values are
    stringly typed and parsed by the consumer.
    """

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str | None] = mapped_column(String(1024), nullable=True)
