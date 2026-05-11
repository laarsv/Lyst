from typing import Any, Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    data: T | None = None
    error: str | None = None


def ok(data: Any = None) -> dict[str, Any]:
    return {"data": data, "error": None}


def err(message: str) -> dict[str, Any]:
    return {"data": None, "error": message}
