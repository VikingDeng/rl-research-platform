# 魔搭创空间 Docker 部署说明

本项目已配置为可在魔搭创空间（ModelScope Studio）上使用 **Docker 方式**部署。

## 部署方式

### Docker 部署（推荐）

魔搭创空间会自动识别根目录的 `Dockerfile` 进行 Docker 构建和部署。

1. 在魔搭创空间创建新项目
2. 选择 **Docker 部署类型**（不是 Gradio）
3. 将本仓库连接到创空间
4. 魔搭会自动使用根目录的 `Dockerfile` 进行构建
5. 启动服务后，应用将在端口 **7860** 上运行（魔搭默认端口）

### Dockerfile 说明

- **主 Dockerfile**: 已配置为使用端口 7860，适合魔搭创空间
- **Dockerfile.modelscope**: 备用配置（与主 Dockerfile 相同）
- 使用多阶段构建：先构建前端，再构建后端运行时
- 自动初始化数据库和种子数据

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

- `Dockerfile`: 主 Dockerfile，已配置为魔搭创空间 Docker 部署（端口 7860）
- `Dockerfile.modelscope`: 备用 Dockerfile（与主 Dockerfile 相同）
- `requirements.txt`: Python 依赖列表（合并了后端和 runner 的所有依赖）
- `app.py`: 可选的 Python 入口文件（Docker 部署使用 entrypoint.sh）
- `entrypoint.sh`: Docker 启动脚本（包含数据库初始化、种子数据等完整流程）

## Docker 构建流程

1. **前端构建阶段**: 使用 Node.js 构建 React 前端，生成 `dist` 目录
2. **后端运行时阶段**: 
   - 安装 Python 依赖（从 `requirements.txt`）
   - 复制应用代码、脚本和前端构建产物
   - 设置环境变量（端口 7860、SQLite 数据库等）
   - 使用 `entrypoint.sh` 作为启动入口

## 启动流程

容器启动时会自动执行：
1. 等待数据库就绪（如果使用 PostgreSQL）
2. 初始化数据库表结构
3. 应用数据库补丁（如需要）
4. 种子默认数据（环境、算法、模板等）
5. 启动 TensorBoard（如果启用）
6. 启动 FastAPI 应用（端口 7860）
