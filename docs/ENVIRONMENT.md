# 环境配置 (Environment)

本文记录 LangerFace 的本地与集群开发环境。更高层的架构说明见 [ARCHITECTURE.md](ARCHITECTURE.md)，协作约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 版本要求

- Python：3.10、3.11 或 3.12；不要使用 3.13，因为 MediaPipe 暂无 3.13 wheel。
- Node.js：24.15 或更新版本；前端使用 Vite 8。
- npm：11 或更新版本。
- 浏览器：建议 Chrome 或 Chromium 系浏览器，用于 MediaPipe WASM、摄像头权限和 WebGL。

## 普通本地环境

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -e ".[all]"

python tools/download_assets.py
python tools/build_field_atlas.py
python tools/export_web_assets.py

cd web
npm ci
npm run build
npm test
cd ..

pytest -q
ruff check .
```

启动正式前端开发服务器：

```bash
cd web
npm run dev
```

## Preview / 部署访问

本地环境只负责开发、构建和测试。PR 创建后，Vercel Git 集成会自动生成 Preview URL；协作流程见 [CONTRIBUTING.md](CONTRIBUTING.md#pr--preview-工作流)。

如果 Preview 启用了 Deployment Protection：

- 长期协作者需要被加入 Vercel project/team，并用自己的 Vercel 账号登录访问。
- 外部短期评审应使用维护者生成的 Shareable Link 或 Password Protection。
- 自动化访问才使用 Protection Bypass for Automation，secret 不应出现在本地 `.env`、仓库或前端 `VITE_*` 环境变量中。

## Compute Canada / Alliance 集群环境

集群上不要裸装到系统 Python。使用 venv，并尽量走集群 wheelhouse。Node 使用可用的新模块版本：

```bash
module load scipy-stack/2026a
module load opencv/4.13.0
module load nodejs/24.15.0

python3 -m venv .venv
source .venv/bin/activate
python -m pip install --no-index pytest ruff
```

如果需要完整 Python 依赖，可在加载 OpenCV 模块后再安装项目；不要让 pip 拉取 `opencv-python` dummy wheel：

```bash
python -m pip install --no-index -e ".[dev]"
```

在集群环境中运行测试时，保留模块环境：

```bash
module load scipy-stack/2026a
module load opencv/4.13.0
PYTHONPATH=src:$PYTHONPATH .venv/bin/python -m pytest -q
PYTHONPATH=src:$PYTHONPATH .venv/bin/ruff check .
```

前端验证：

```bash
module load nodejs/24.15.0
cd web
npm ci
npm run build
npm test
```

## 本地产物目录

- `local_media/`：本地视频、照片和输出视频，例如 `IMG_3458.MOV`、`out_rstl.mp4`。该目录被 git 忽略。
- `logs/`：本地运行日志。该目录被 git 忽略。
- `local_outputs/`：人工目检截图、拼图和单帧调试输出，例如 `local_outputs/debug_frames/`。该目录被 git 忽略。
- `local_archives/`：本地压缩包、外部资料归档。该目录被 git 忽略。
- `web/dist/`：Vite 构建输出。该目录被 git 忽略。
- `web/node_modules/`：npm 依赖。该目录被 git 忽略。

不要把真实人脸影像、视频、日志或临时调试输出提交到仓库。
