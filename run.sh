#!/usr/bin/env bash
# 一键：安装（可编辑）、下载资产、生成图谱、导出网页资产、构建前端、跑测试、启动后端演示界面。
# 用法：  bash run.sh
set -e
cd "$(dirname "$0")"

echo "==> 1/7 安装依赖（可编辑安装，含 web/annotate/dev 附加项）"
pip install -e ".[all]"

echo "==> 2/7 下载 MediaPipe 资产（标准脸 + 关键点模型）"
python3 tools/download_assets.py

echo "==> 3/7 生成 RSTL / Langer 线图谱（稠密方向场流线）"
python3 tools/build_field_atlas.py

echo "==> 4/7 导出网页端静态资产到 web/assets/"
python3 tools/export_web_assets.py

echo "==> 5/7 构建正式前端（Vite，需 Node 24+；集群可先 module load nodejs/24.15.0）"
if command -v npm >/dev/null 2>&1; then
  (cd web && npm ci && npm run build)
else
  echo "未找到 npm，跳过前端构建；可稍后进入 web/ 运行 npm ci && npm run build"
fi

echo "==> 6/7 运行测试"
python3 -m pytest -q || echo "（部分测试失败，可继续启动查看效果）"

echo "==> 7/7 启动后端演示界面（Gradio）-> 浏览器打开提示地址"
echo "    （正式前端：cd web && npm run dev；生产预览：cd web && npm run preview）"
langerface-web
