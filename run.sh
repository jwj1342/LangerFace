#!/usr/bin/env bash
# 一键安装依赖、下载资产、生成图谱、跑测试、启动网页应用。
# 用法：  bash run.sh
set -e
cd "$(dirname "$0")"

echo "==> 1/5 安装依赖"
pip install -r requirements.txt

echo "==> 2/5 下载 MediaPipe 资产（标准脸 + 关键点模型）"
python3 tools/download_assets.py

echo "==> 3/5 生成首版 RSTL / Langer 图谱"
python3 tools/build_initial_atlas.py

echo "==> 4/5 运行测试"
python3 -m pytest -q || echo "（部分测试失败，可继续启动查看效果）"

echo "==> 5/5 启动网页应用 -> 浏览器打开 http://127.0.0.1:7860"
python3 apps/web_app.py
