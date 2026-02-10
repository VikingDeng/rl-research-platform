"""
魔搭创空间入口文件
ModelScope Studio entry point
"""
import os
import sys
from pathlib import Path

# 设置 Python 路径
app_root = Path(__file__).parent
backend_dir = app_root / "apps" / "portal-backend"
sys.path.insert(0, str(backend_dir))

# 设置环境变量
os.environ.setdefault("PYTHONPATH", str(backend_dir))
os.environ.setdefault("DATABASE_URL", "sqlite:///rl_platform.db")
os.environ.setdefault("LOCAL_RUN_ROOT", str(app_root / ".local" / "runs"))
os.environ.setdefault("FRONTEND_DIST", str(app_root / "dist"))
os.environ.setdefault("PORT", os.getenv("PORT", "7860"))  # 魔搭默认端口 7860

# 导入 FastAPI 应用
from app.main import app

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "7860"))
    uvicorn.run(app, host="0.0.0.0", port=port)
