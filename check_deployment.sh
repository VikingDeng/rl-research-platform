#!/bin/bash
# 魔搭创空间部署检查脚本
# 用于验证部署文件是否存在

echo "=== 魔搭创空间部署文件检查 ==="
echo ""

# 检查必需文件
echo "1. 检查 Dockerfile..."
if [ -f "Dockerfile" ]; then
    echo "   ✅ Dockerfile 存在"
    echo "   文件大小: $(wc -l < Dockerfile) 行"
    echo "   文件路径: $(pwd)/Dockerfile"
else
    echo "   ❌ Dockerfile 不存在！"
    exit 1
fi

echo ""
echo "2. 检查 requirements.txt..."
if [ -f "requirements.txt" ]; then
    echo "   ✅ requirements.txt 存在"
    echo "   文件大小: $(wc -l < requirements.txt) 行"
else
    echo "   ❌ requirements.txt 不存在！"
    exit 1
fi

echo ""
echo "3. 检查 entrypoint.sh..."
if [ -f "apps/portal-backend/entrypoint.sh" ]; then
    echo "   ✅ entrypoint.sh 存在"
else
    echo "   ❌ entrypoint.sh 不存在！"
    exit 1
fi

echo ""
echo "4. 检查 Dockerfile 内容..."
if grep -q "FROM node:20-alpine" Dockerfile; then
    echo "   ✅ Dockerfile 包含前端构建阶段"
else
    echo "   ⚠️  Dockerfile 可能不完整"
fi

if grep -q "FROM python:3.11-slim" Dockerfile; then
    echo "   ✅ Dockerfile 包含后端运行时阶段"
else
    echo "   ⚠️  Dockerfile 可能不完整"
fi

if grep -q "PORT=7860" Dockerfile; then
    echo "   ✅ Dockerfile 配置了端口 7860"
else
    echo "   ⚠️  Dockerfile 可能未配置正确端口"
fi

echo ""
echo "=== 检查完成 ==="
echo ""
echo "如果所有检查都通过，但魔搭仍然找不到 Dockerfile，"
echo "请确保："
echo "1. 使用 main 分支"
echo "2. 所有文件都已提交并推送到远程仓库"
echo "3. 在魔搭创空间设置中选择 Docker 部署类型"
