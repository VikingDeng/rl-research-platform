# 魔搭创空间部署故障排查

## 问题：找不到 Dockerfile

如果遇到 `failed to read dockerfile: open Dockerfile: no such file or directory` 错误，请按以下步骤排查：

### 1. 确认仓库配置

在魔搭创空间设置中检查：
- **仓库地址**: `http://www.modelscope.cn/studios/linweixi/marl-platform.git`
- **分支**: 必须使用 `main` 分支
- **部署类型**: 必须选择 **Docker**（不是 Gradio）

### 2. 验证文件存在

在本地运行检查脚本：
```bash
./check_deployment.sh
```

或手动检查：
```bash
git ls-files | grep Dockerfile
git show HEAD:Dockerfile | head -5
```

### 3. 重新部署

在魔搭创空间管理页面：
1. 点击 **"重新上传文件并部署"**
2. 或点击 **"重启创空间"** → 选择 **"深度重启"**

### 4. 检查构建日志

查看构建日志中的以下信息：
- `CONTEXT_PATH`: 应该是 `/root/workspace/repo_0`
- `DOCKER_FILE_PATH`: 应该是 `Dockerfile`
- 检查是否有 `transferring dockerfile: 2B done`（如果只有 2 字节，说明文件未正确克隆）

### 5. 可能的解决方案

#### 方案 A：确保使用 main 分支
在魔搭创空间设置中，明确指定分支为 `main`

#### 方案 B：使用完整 Git URL
如果问题持续，尝试使用完整的 Git URL：
```
http://oauth2:ms-7f48e503-9722-4ab5-9857-6fe13fabb087@www.modelscope.cn/studios/linweixi/marl-platform.git
```

#### 方案 C：检查提交历史
确保 Dockerfile 在最新的提交中：
```bash
git log --oneline --all -- Dockerfile
```

### 6. 联系支持

如果以上方法都不行，请：
1. 提供完整的构建日志
2. 确认仓库地址和分支设置
3. 检查是否有权限问题

## 当前状态

- ✅ Dockerfile 已存在于仓库根目录（1232 字节）
- ✅ Dockerfile 已在 main 分支的最新提交中
- ✅ 已推送到 modelscope 远程仓库
- ✅ 端口配置为 7860（魔搭默认）
- ✅ 所有依赖文件已就绪

## 验证命令

```bash
# 检查 Dockerfile 是否存在
git ls-files | grep Dockerfile

# 检查 Dockerfile 内容
git show HEAD:Dockerfile | head -10

# 检查文件大小
git show HEAD:Dockerfile | wc -c

# 检查提交历史
git log --oneline -5 -- Dockerfile
```
