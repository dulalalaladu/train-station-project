"""Exception type raised by concrete bridges; mapped to ErrorInfo by the base class."""

from __future__ import annotations

from typing import Optional

from .models import BridgeErrorCode, ErrorInfo


class BridgeError(Exception):
    """Raised from vendor hooks. Messages must be safe to publish (no secrets, no raw payloads)."""

    def __init__(
        self,
        code: BridgeErrorCode,
        message: str = "",
        *,
        retryable: bool = False,
        result_unknown: bool = False,
        vendor_code: Optional[str] = None,
    ) -> None:
        super().__init__(message or code.value)
        self.code = code
        self.message = message or code.value
        self.retryable = retryable
        self.result_unknown = result_unknown
        self.vendor_code = vendor_code

    def to_info(self) -> ErrorInfo:
        return ErrorInfo(
            code=self.code,
            message=self.message,
            retryable=self.retryable,
            result_unknown=self.result_unknown,
            vendor_code=self.vendor_code,
        )
