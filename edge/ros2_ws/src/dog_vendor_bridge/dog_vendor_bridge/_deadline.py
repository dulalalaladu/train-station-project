"""Run a call on its own daemon thread and wait at most `deadline_s`.

A fresh thread per call (no pool, no queue) is deliberate: a vendor call that hangs must never
delay the next call, in particular a STOP.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any, Callable, Optional


@dataclass(frozen=True)
class DeadlineOutcome:
    value: Any = None
    error: Optional[BaseException] = None
    timed_out: bool = False

    @property
    def ok(self) -> bool:
        return not self.timed_out and self.error is None


def run_with_deadline(fn: Callable[[], Any], deadline_s: float, name: str = "bridge-call") -> DeadlineOutcome:
    box: dict = {}
    done = threading.Event()

    def worker() -> None:
        try:
            box["value"] = fn()
        except BaseException as exc:  # noqa: BLE001 - reported to the caller via DeadlineOutcome
            box["error"] = exc
        finally:
            done.set()

    threading.Thread(target=worker, name=name, daemon=True).start()
    if not done.wait(deadline_s):
        return DeadlineOutcome(timed_out=True)
    return DeadlineOutcome(value=box.get("value"), error=box.get("error"))
