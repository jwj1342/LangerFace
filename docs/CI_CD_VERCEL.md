# CI/CD 与 Vercel 部署指南

本文记录当前推荐的部署方式：**GitHub Actions 做质量门禁，Vercel Git 集成做 Preview / Production 部署**。

官方背景：
- [Vercel GitHub 集成](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel)会自动生成 Preview Deployment URL，并在生产分支更新时部署生产环境。
- [Vercel 官方也支持用 GitHub Actions + Vercel CLI 做部署](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel)，但那适合需要完全控制部署流程、或不能使用 Vercel Git 集成的场景。
- 本仓库是 monorepo 形态，前端项目目录是 `web/`，[Vercel 项目的 Root Directory](https://vercel.com/docs/monorepos) 必须指向 `web`。

## 推荐拓扑

```
pull request / push
      │
      ├─ GitHub Actions
      │    ├─ ruff
      │    ├─ pytest: Python 3.10 / 3.11 / 3.12
      │    └─ web: npm ci + npm run build + npm test
      │
      └─ Vercel Git Integration
           ├─ PR / branch: Preview Deployment
           └─ master: Production Deployment
```

这个方案把职责分开：

| 部分 | 负责什么 |
|---|---|
| GitHub Actions | 代码质量、Python 测试、JS 几何对拍、Vite 构建能否通过 |
| Vercel | 静态前端构建、Preview URL、Production URL、缓存头、域名 |
| Cloudflare（将来） | Worker API、D1、R2、受限数据鉴权；不负责当前静态前端部署 |

不要同时启用“Vercel Git 自动部署”和“GitHub Actions 里用 Vercel CLI 自动部署”，否则同一个 commit 可能产生重复部署和重复状态检查。

## Vercel Project 设置

在 Vercel Dashboard 导入 GitHub 仓库时，使用以下配置：

| 设置 | 值 |
|---|---|
| Framework Preset | Vite |
| Root Directory | `web` |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Production Branch | `master`（除非仓库改成 `main`） |
| Node.js Version | 24.x；项目要求 Node `>=24.15.0`、npm `>=11.0.0` |

本仓库已有 [web/vercel.json](../web/vercel.json)，里面声明了：
- `buildCommand`: `npm run build`
- `outputDirectory`: `dist`
- `/assets/*` 长缓存，适合 `.task` 模型、atlas JSON、triangles 等哈希化静态资产
- JS/MJS 的 `Content-Type`

如果 Dashboard 与 `web/vercel.json` 同时配置同一项，保持它们一致，避免不同环境行为不一致。

## GitHub Branch Protection

建议保护 `master` 分支：

- Require a pull request before merging.
- Require status checks to pass before merging.
- Require branches to be up to date before merging.
- Disable force pushes.
- 多人协作后可要求至少 1 个 approval。

Required status checks 建议包含：

| Check | 来源 |
|---|---|
| `lint` | `.github/workflows/ci.yml` |
| `python-tests (3.10)` | `.github/workflows/ci.yml` matrix |
| `python-tests (3.11)` | `.github/workflows/ci.yml` matrix |
| `python-tests (3.12)` | `.github/workflows/ci.yml` matrix |
| `js-tests` | `.github/workflows/ci.yml` |
| Vercel Preview / Deployment check | Vercel GitHub 集成生成，具体名称以 GitHub UI 显示为准 |

实际 check 名称由 GitHub UI 决定。第一次 PR 跑完后，在 Branch protection 页面选择已经出现的 check，不要手写猜名称。

## 日常发布流程

1. 开 feature branch。
2. 提 PR。
3. GitHub Actions 跑 Python / JS / build。
4. Vercel 自动生成 Preview URL。
5. 在 Preview URL 上手动检查：
   - 首页能加载。
   - `face_landmarker.task`、`hand_landmarker.task`、atlas JSON 能加载。
   - 上传图片或摄像头入口不报资源路径错误。
   - `annotate.html` 能打开。
6. Actions 和 Vercel check 都通过后合并。
7. 合并到 `master` 后，Vercel 自动发布 Production。

## 环境变量

当前纯静态前端不需要 Vercel 环境变量。

将来接 Cloudflare Worker API 时，建议新增：

| 变量 | 示例 | 用途 |
|---|---|---|
| `VITE_API_BASE_URL` | `https://api.langerface.example.com` | 前端访问 Worker API |
| `VITE_APP_ENV` | `preview` / `production` | 可选，用于诊断面板或日志标记 |

Vite 只会把 `VITE_` 前缀变量注入浏览器端。不要把私钥、R2 token、Cloudflare token、Vercel token 放进 `VITE_*`。

## 什么时候改用 GitHub Actions 部署到 Vercel

默认不要这么做。只有满足以下至少一条时才考虑：

- 不能或不想安装 Vercel GitHub App。
- 必须保证“所有测试通过后才创建任何 Vercel 部署”。
- 需要在 GitHub Actions 内先生成工件，再用 `vercel deploy --prebuilt` 上传。
- 需要把部署流程接入更复杂的审批、制品签名或内部流水线。

如果采用这个模式，需要在 GitHub Secrets 中提供：

| Secret | 来源 |
|---|---|
| `VERCEL_TOKEN` | Vercel Account Settings -> Tokens |
| `VERCEL_ORG_ID` | `vercel link` / `.vercel/project.json` 或 Vercel Project Settings |
| `VERCEL_PROJECT_ID` | `vercel link` / `.vercel/project.json` 或 Vercel Project Settings |

并且要关闭 Vercel Git 自动部署，避免重复部署。

一个最小的 CLI 部署流程应使用官方推荐的三步：

```yaml
- run: npm install --global vercel@latest
- run: vercel pull --yes --environment=preview --token=${{ secrets.VERCEL_TOKEN }}
- run: vercel build --token=${{ secrets.VERCEL_TOKEN }}
- run: vercel deploy --prebuilt --token=${{ secrets.VERCEL_TOKEN }}
```

生产环境把 `preview` 换成 `production`，并给 `vercel build` / `vercel deploy` 加 `--prod`。

## 我还需要你提供什么

如果要我继续把线上配置落成可运行状态，需要这些信息：

1. Vercel 使用个人账号还是 team；如果是 team，team slug 是什么。
2. 是否已经把 GitHub 仓库导入 Vercel；如果已经导入，给我 Project 名称或 Project URL。
3. 生产分支确认：继续用 `master`，还是准备迁到 `main`。
4. 是否要绑定自定义域名；域名是什么。
5. 采用哪种部署策略：
   - 推荐：Vercel Git 集成部署。
   - 可选：GitHub Actions + Vercel CLI 部署。
6. 将来 Worker API 的域名或计划域名；如果暂时没有，可以先不配环境变量。

不要把 `VERCEL_TOKEN`、Cloudflare token、R2 密钥直接发在聊天里。需要用它们时，把它们放到 GitHub Repository Secrets 或 Vercel Dashboard Environment Variables。
