# 魔搭创空间部署说明

本项目已配置为可在魔搭创空间（ModelScope Studio）上部署。

## 部署方式

### 方式一：使用 Dockerfile（推荐）

魔搭创空间会自动识别 `Dockerfile` 或 `Dockerfile.modelscope` 进行构建。

1. 在魔搭创空间创建新项目
2. 将本仓库连接到创空间
3. 选择使用 `Dockerfile.modelscope` 进行构建
4. 启动服务

### 方式二：使用 app.py

如果魔搭创空间支持直接运行 Python 应用：

1. 确保已安装所有依赖：`pip install -r requirements.txt`
2. 运行：`python app.py`
3. 应用将在端口 7860 上启动（魔搭默认端口）

## 环境变量配置

在魔搭创空间中，可以通过环境变量配置以下选项：

- `PORT`: 服务端口（默认：7860）
- `DATABASE_URL`: 数据库连接（默认：SQLite）
- `LOCAL_RUN_ROOT`: 训练数据存储路径（默认：`.local/runs`）
- `FRONTEND_DIST`: 前端静态文件路径（默认：`dist`）
- `DISABLE_CSP`: 禁用内容安全策略（默认：1）

## 注意事项

1. **端口**: 魔搭创空间默认使用端口 7860，已配置在 `entrypoint.sh` 和 `app.py` 中
2. **数据库**: 默认使用 SQLite，适合单机部署。如需 PostgreSQL，请配置 `DATABASE_URL` 环境变量
3. **存储**: 训练数据和模型会保存在 `.local/runs` 目录中
4. **前端**: 前端已构建在 `dist` 目录中，无需额外构建步骤

## 访问应用

部署成功后，可以通过魔搭创空间提供的访问地址访问应用：
- Web UI: `http://your-space-url`
- API: `http://your-space-url/api/v1`
- TensorBoard: `http://your-space-url:6006`（如果启用）

## 故障排查

1. **端口冲突**: 确保使用端口 7860（魔搭默认）
2. **依赖问题**: 检查 `requirements.txt` 是否包含所有必需依赖
3. **数据库初始化**: 首次启动会自动初始化数据库，请确保有写入权限
4. **前端未显示**: 检查 `dist` 目录是否存在且包含前端构建文件

## 文件说明

- `app.py`: 魔搭创空间入口文件
- `requirements.txt`: Python 依赖列表
- `Dockerfile.modelscope`: 魔搭创空间专用 Dockerfile
- `entrypoint.sh`: 启动脚本（已更新为使用端口 7860）
