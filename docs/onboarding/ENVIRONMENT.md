# 环境配置 (Environment)

本文记录 LangerFace 的本地与集群开发环境。更高层的架构说明见 [ARCHITECTURE.md](../architecture/ARCHITECTURE.md)，协作约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

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
python -m pip install -c requirements-wrinkle-lock.txt -e ".[all]"

python tools/download_assets.py
python3 tools/build_field_atlas_standard_v1.py \
        assets/rstl_standard_reference_v8_1_67.json assets/atlas_rstl.json
#   ⚠️ 不要裸跑 tools/build_field_atlas.py：它会同时重写 assets/atlas_rstl.json 与
#      assets/atlas_langer.json，把上面这份正式 v8.1.67 图谱覆盖成 61 条流线的旧首版，
#      并让 tests/test_rstl_standard_v8_1_67.py 失败。只在需要重造 Langer 对照时才跑它。
python tools/export_web_assets.py

cd web
npm ci
npm run doctor:wrinkle
npm run build
npm test
npx playwright install chromium
npm run test:browser
# 调试额头可见性或遮挡时，可先运行 npm run test:geometry；交付前仍需运行 npm test。
cd ..

pytest -q
ruff check .
```

启动正式前端开发服务器：

```bash
cd web
npm run dev
```

### Git worktree 依赖隔离

每个活跃 worktree 都必须在自己的 `web` 目录执行 `npm ci`，不得把 `node_modules`
软链、Junction 或复制到另一个 worktree，也不得跨 worktree 复用 `node_modules/.vite`。
Vite 的依赖优化产物可能包含绝对资源路径；跨目录复用会让 WASM、Worker 或模型运行时
继续请求旧 worktree，即使 Git 代码已经成功同步。

`npm run dev` 会先执行依赖隔离检查，并强制重建 Vite optimizer 缓存。若检查报告
`node_modules` 指向其他 worktree，只移除当前 worktree 的链接，再在当前 `web` 目录运行
`npm ci`；不要删除链接实际指向的依赖目录。远端代码合并后，如果 `web/package.json` 或
`web/package-lock.json` 有变化，也应在当前 worktree 重新运行 `npm ci`。

### 本地皱纹运行时自检

`npm run doctor:wrinkle` 必须显示 `ready: true`、V10 检测器版本和预期 checkpoint
哈希。本地插件会优先使用 `LANGERFACE_WRINKLE_PYTHON`、已激活虚拟环境和仓库根
`.venv`，然后才尝试 `python3` / `python`。自检还会按 `requirements-wrinkle-lock.txt`
校验四个数值依赖版本。建议每台电脑都使用仓库 `.venv`，不要依赖个人 Conda 路径。

四区域 V10 需要 Vite 的本地 API 插件，因此必须使用 `npm run dev` 或
`npm run preview`。用普通静态服务器托管 `web/dist/` 只有前端文件，不会提供本地
`/api/wrinkle-v10`，不能作为本地皱纹检测的启动方式。

## Preview / 部署访问

本地环境只负责开发、构建和测试。PR/Production 发布流程见
[CONTRIBUTING](CONTRIBUTING.md#pr--preview-工作流)；Vercel Preview 的创建范围、访问保护、协作者/外部评审/自动化
三种访问方式与 secret 边界统一见
[CI/CD 与 Vercel 部署指南](../quality/CI_CD_VERCEL.md#preview-访问策略)，本文件不复制部署策略。

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
npx playwright install chromium
npm run test:browser
```

## 本地产物目录

- `local_media/`：本地视频、照片和输出视频，例如 `IMG_3458.MOV`、`out_rstl.mp4`。该目录被 git 忽略。
- `logs/`：本地运行日志。该目录被 git 忽略。
- `local_outputs/`：人工目检截图、拼图和单帧调试输出，例如 `local_outputs/debug_frames/`。该目录被 git 忽略。
- `local_archives/`：本地压缩包、外部资料归档。该目录被 git 忽略。
- `web/dist/`：Vite 构建输出。该目录被 git 忽略。
- `web/node_modules/`：npm 依赖。该目录被 git 忽略。

受控单图皱纹/RSTL 复放依赖真实输入和浏览器冻结产物时，必须用 `WRINKLE_LOCAL_*` 或
`WRINKLE_CROWS_*` 环境变量指向上述本地目录；仓库不分发这些隐私材料。两个 runner 默认调用
Windows 的 `python` 或 POSIX 的 `python3`，特殊环境用 `WRINKLE_LOCAL_PYTHON` /
`WRINKLE_CROWS_PYTHON` 指定已安装 `numpy` 与 `cv2` 的解释器。

不要把真实人脸影像、视频、日志或临时调试输出提交到仓库。
