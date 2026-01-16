from typing import Dict, Set


JOB_STATUSES = {"PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"}
RUN_STATUSES = JOB_STATUSES

JOB_TRANSITIONS: Dict[str, Set[str]] = {
    "PENDING": {"RUNNING", "CANCELED"},
    "RUNNING": {"SUCCEEDED", "FAILED", "CANCELED"},
    "SUCCEEDED": set(),
    "FAILED": set(),
    "CANCELED": set(),
}

RUN_TRANSITIONS = JOB_TRANSITIONS


def ensure_valid_status(status: str) -> None:
    if status not in JOB_STATUSES:
        raise ValueError("invalid_status")


def can_transition(current: str, target: str) -> bool:
    if current not in JOB_TRANSITIONS:
        return False
    return target in JOB_TRANSITIONS[current]
