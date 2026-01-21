import psutil
from typing import List, Dict, Any, Optional
from app.schemas.base import APIModel

# Try importing pynvml
try:
    import pynvml
    pynvml.nvmlInit()
    HAS_NVML = True
except Exception:
    HAS_NVML = False

class GpuProcess(APIModel):
    pid: int
    process_name: str
    memory_used: int

class GpuInfo(APIModel):
    index: int
    name: str
    utilization_gpu: int
    utilization_memory: int
    memory_total: int
    memory_used: int
    memory_free: int
    temperature: int
    power_draw: Optional[int] = None # in mW
    fan_speed: Optional[int] = None # in %
    processes: List[GpuProcess] = []

class SystemResources(APIModel):
    cpu_percent: float
    memory_percent: float
    memory_total: int
    memory_used: int
    gpus: List[GpuInfo]

def get_system_resources() -> SystemResources:
    cpu = psutil.cpu_percent(interval=None)
    mem = psutil.virtual_memory()
    
    gpus = []
    if HAS_NVML:
        try:
            device_count = pynvml.nvmlDeviceGetCount()
            for i in range(device_count):
                handle = pynvml.nvmlDeviceGetHandleByIndex(i)
                name = pynvml.nvmlDeviceGetName(handle)
                # Decode bytes if necessary (pynvml returns str in newer versions, bytes in older)
                if isinstance(name, bytes):
                    name = name.decode("utf-8")
                
                util = pynvml.nvmlDeviceGetUtilizationRates(handle)
                mem_info = pynvml.nvmlDeviceGetMemoryInfo(handle)
                temp = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
                
                # Extended Metrics
                try:
                    power = pynvml.nvmlDeviceGetPowerUsage(handle) # mW
                except:
                    power = None
                
                try:
                    fan = pynvml.nvmlDeviceGetFanSpeed(handle) # %
                except:
                    fan = None
                
                # Processes
                procs = []
                try:
                    nv_procs = pynvml.nvmlDeviceGetComputeRunningProcesses(handle)
                    for p in nv_procs:
                        try:
                            # Try to get process name via psutil
                            proc_name = psutil.Process(p.pid).name()
                        except:
                            proc_name = "unknown"
                        
                        procs.append(GpuProcess(
                            pid=p.pid,
                            process_name=proc_name,
                            memory_used=p.usedGpuMemory or 0
                        ))
                except:
                    pass

                gpus.append(GpuInfo(
                    index=i,
                    name=name,
                    utilization_gpu=util.gpu,
                    utilization_memory=util.memory,
                    memory_total=mem_info.total,
                    memory_used=mem_info.used,
                    memory_free=mem_info.free,
                    temperature=temp,
                    power_draw=power,
                    fan_speed=fan,
                    processes=procs
                ))
        except Exception as e:
            # Fallback or log error
            pass
            
    return SystemResources(
        cpu_percent=cpu,
        memory_percent=mem.percent,
        memory_total=mem.total,
        memory_used=mem.used,
        gpus=gpus
    )
