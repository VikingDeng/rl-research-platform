# 魔搭创空间部署快速指南

## 重要提示

本项目使用 **Docker 部署方式**，请确保在魔搭创空间中选择 **Docker** 作为部署类型（不是 Gradio）。

## 必需文件

以下文件必须在仓库根目录：

- ✅ `Dockerfile` - Docker 构建文件（已存在）
- ✅ `requirements.txt` - Python 依赖（已存在）
- ✅ `app.py` - 可选入口文件（已存在）
- ✅ `entrypoint.sh` - 启动脚本（在 apps/portal-backend/ 目录）

## 验证步骤

如果构建失败，请检查：

1. **确认 Dockerfile 在根目录**：
   ```bash
   ls -la Dockerfile
   ```

2. **确认使用 main 分支**：
   魔搭创空间应该使用 `main` 分支进行构建

3. **确认文件已提交**：
   ```bash
   git ls-files | grep Dockerfile
   ```

## 构建命令

魔搭会自动执行：
```bash
docker build -f Dockerfile -t <image> .
```

## 端口配置

- 应用端口：**7860**（魔搭默认）
- TensorBoard 端口：6006

## 环境变量

默认环境变量（可在魔搭创空间设置中修改）：
- `PORT=7860`
- `DATABASE_URL=sqlite:///rl_platform.db`
- `DISABLE_CSP=1`
