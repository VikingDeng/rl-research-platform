import time
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

import fcntl


@dataclass
class GPULock:
    gpu_id: int
    handle: object

    def release(self) -> None:
        try:
            fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
        finally:
            self.handle.close()


class GPUSlotAllocator:
    def __init__(self, root_dir: Path, total_slots: int) -> None:
        self._locks_dir = Path(root_dir) / "gpu_locks"
        self._locks_dir.mkdir(parents=True, exist_ok=True)
        self._total_slots = total_slots

    def acquire(self, count: int, poll_interval: float = 0.2, timeout: Optional[float] = None) -> List[GPULock]:
        if count <= 0:
            return []

        start = time.time()
        while True:
            locks: List[GPULock] = []
            for gpu_id in range(self._total_slots):
                if len(locks) >= count:
                    break
                lock_path = self._locks_dir / f"gpu_{gpu_id}.lock"
                handle = open(lock_path, "a+")
                try:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    locks.append(GPULock(gpu_id=gpu_id, handle=handle))
                except BlockingIOError:
                    handle.close()
                    continue

            if len(locks) >= count:
                return locks

            for lock in locks:
                lock.release()

            if timeout is not None and (time.time() - start) >= timeout:
                raise TimeoutError("gpu_allocation_timeout")

            time.sleep(poll_interval)
