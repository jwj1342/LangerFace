#!/usr/bin/env bash
# 一键：安装（可编辑）、下载资产、生成图谱、导出网页资产、跑测试、启动后端演示界面。
# 用法：  bash run.sh
set -e
cd "$(dirname "$0")"

echo "==> 1/6 安装依赖（可编辑安装，含 web/annotate/dev 附加项）"
pip install -e ".[all]"

echo "==> 2/6 下载 MediaPipe 资产（标准脸 + 关键点模型）"
python3 tools/download_assets.py

echo "==> 3/6 生成 RSTL / Langer 线图谱（稠密方向场流线）"
python3 tools/build_field_atlas.py

echo "==> 4/6 导出网页端静态资产到 web/assets/"
python3 tools/export_web_assets.py

echo "==> 5/6 运行测试"
python3 -m pytest -q || echo "（部分测试失败，可继续启动查看效果）"

echo "==> 6/6 启动后端演示界面（Gradio）-> 浏览器打开提示地址"
echo "    （正式前端是 web/ 静态站点，可改用：python3 tools/serve_web.py）"
langerface-web
