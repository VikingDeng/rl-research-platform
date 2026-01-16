import time
import threading
import psutil
import json
import os
import logging

logger = logging.getLogger(__name__)

class SystemMonitor:
    def __init__(self, metrics_path, interval=1.0):
        self.metrics_path = metrics_path
        self.interval = interval
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.nvml_initialized = False
        self.gpu_handles = []

    def _init_gpu(self):
        try:
            import pynvml
            pynvml.nvmlInit()
            device_count = pynvml.nvmlDeviceGetCount()
            for i in range(device_count):
                handle = pynvml.nvmlDeviceGetHandleByIndex(i)
                self.gpu_handles.append(handle)
            self.nvml_initialized = True
            print(f"[SystemMonitor] Initialized NVML. Found {len(self.gpu_handles)} GPUs.")
        except Exception as e:
            print(f"[SystemMonitor] NVML Init Failed (No GPU monitoring): {e}")
            self.nvml_initialized = False

    def start(self):
        self._init_gpu()
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        self.thread.join(timeout=2.0)
        if self.nvml_initialized:
            try:
                import pynvml
                pynvml.nvmlShutdown()
            except:
                pass

    def _run(self):
        system_metrics_path = os.path.join(os.path.dirname(self.metrics_path), "system_metrics.jsonl")
        
        while not self.stop_event.is_set():
            stats = {
                "timestamp": time.time(),
                "cpu_percent": psutil.cpu_percent(),
                "memory_percent": psutil.virtual_memory().percent,
            }
            
            # GPU Stats
            if self.nvml_initialized:
                import pynvml
                gpu_stats = []
                for idx, handle in enumerate(self.gpu_handles):
                    try:
                        util = pynvml.nvmlDeviceGetUtilizationRates(handle)
                        mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
                        gpu_stats.append({
                            "index": idx,
                            "util_gpu": util.gpu,
                            "util_mem": util.memory,
                            "mem_used_mb": mem.used / 1024 / 1024,
                            "mem_total_mb": mem.total / 1024 / 1024
                        })
                    except Exception:
                        pass
                if gpu_stats:
                    stats["gpus"] = gpu_stats

            try:
                with open(system_metrics_path, "a", encoding="utf-8") as f:
                    f.write(json.dumps(stats) + "\n")
            except Exception:
                pass
            
            time.sleep(self.interval)