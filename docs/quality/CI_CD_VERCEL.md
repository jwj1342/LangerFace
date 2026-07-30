# CI/CD 与 Vercel 部署指南

本文记录当前推荐的部署方式：**GitHub Actions 做质量门禁，Vercel Git 集成只自动发布 Production；当前开发 Preview 按需手动刷新**。

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
           └─ master: Production Deployment

manual / temporary
      └─ Preview 只在维护者明确需要验收时手动创建，不跟随 feature branch 每次 push
```

这个方案把职责分开，并且把 Vercel 自动部署收敛到生产入口；开发 Preview 不作为 Git 集成的自动入口：

| 部分 | 负责什么 |
|---|---|
| GitHub Actions | 代码质量、Python 测试、Web TypeScript 几何对拍、Vite 构建能否通过 |
| Vercel | Production URL、必要时手动创建的 Preview URL、缓存头、域名 |

不要同时启用“Vercel Git 自动部署”和“GitHub Actions 里用 Vercel CLI 自动部署”，否则同一个 commit 可能产生重复部署和重复状态检查。

## 自动部署范围与限流控制

Vercel 的部署资源不是按“当前打开几个 PR”简单计算的。Git 集成会在允许的分支上为每次 push 创建新的部署任务；如果短时间内连续 push、旧构建没有及时取消，或者多个历史分支仍允许 Preview，就可能触发并发、构建次数或平台侧限流。

本项目默认只保留一个自动部署入口：`master` 发布 Production。Preview 仍可以在需要人工验收时手动创建，但不要让任何长 PR 或集成分支的每次 push 都自动创建新的 Preview Deployment。Vercel 的 Deployment 是不可变历史记录，所以 Dashboard / GitHub 里可能仍能看到旧部署；仓库配置控制的是以后哪些分支还能继续产生新部署。

| 环境 | 分支 | 行为 |
|---|---|---|
| Production | `master` | 合并后自动发布生产站 |
| Preview | 任意开发分支 | 不走 Git 自动部署；需要验收时由维护者手动创建一次性 Preview |

[web/vercel.json](../../web/vercel.json) 已将 `git.deploymentEnabled` 设置为 `* = false` 和 `** = false`，只对白名单生产分支 `master` 开放。配置里仍保留 `github.autoJobCancelation`，用于后续维护者误开或临时打开分支部署时，取消同一 PR / 分支上的较旧构建。

此外，`ignoreCommand` 会运行 [`web/scripts/vercel-ignore-build.ts`](../../web/scripts/vercel-ignore-build.ts)。它是二级保护：

- 非 `master` 分支直接跳过 Vercel 构建，即使 Dashboard 误开了分支部署也不会继续消耗构建资源。
- 即使当前分支允许构建，只要这次 push 相比上一次部署没有改动 Vercel Root Directory `web/`，仍会跳过实际构建。这样 docs / tools / issue 文案类改动仍会保留 GitHub Actions 质量门禁，但不会额外消耗 Vercel Preview 构建。

如果后续需要验收某个开发分支，不要把该分支加入 Git 自动部署白名单；用 Vercel Dashboard 或 Vercel CLI 手动创建一次 Preview 即可。旧的 Deployment URL 属于 Vercel 的历史记录 / 回滚能力；它们可以在 Dashboard 里清理或保留，但仓库配置能控制的是“以后哪些分支继续产生新部署”。如果想让 Dashboard 或 GitHub 仓库主页只显示更少的历史记录，需要在 Vercel Dashboard 清理旧 Deployment，或用 GitHub Deployments API 清理 GitHub 侧 deployment records；这不会退回已经消耗过的 Vercel 构建资源，也不要放进 CI 自动执行。

截至 2026-06-26，GitHub Deployments API 中这个仓库已有 309 条历史记录，其中 272 条是 Preview、37 条是 Production。这类计数是历史 records，不代表仍有 309 个活跃环境；真正会继续消耗 Vercel 额度的是未来新触发的构建/部署任务。

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

## 运行时资产的缓存策略

`dist/assets/` 里住着**两类性质完全不同**的文件，必须用不同的缓存策略，这是踩过的坑：

| 类别 | 例子 | 文件名会变吗 | 策略 |
|---|---|---|---|
| 内容哈希 bundle | `app-ByjyBvTY.js`、`dataSource-DhELnIMr.js` | 会（哈希随内容变） | `public, max-age=31536000, immutable` |
| 固定名运行时资产 | `atlas_rstl.json`、`triangles.json`、`topology_mediapipe_468.json`、`face_landmarker.task`、`flame_basis.bin` | **不会** | `public, max-age=0, must-revalidate`（靠 ETag，未变更时是一次廉价 304） |

两类文件同住 `dist/assets/`：哈希 bundle 由 Vite 产出，固定名资产由 `vite.config.ts` 的
`copy-runtime-assets` 从 `web/assets/` 原样拷入。因此 [web/vercel.json](../../web/vercel.json) 的
header 规则必须**按文件形态而不是按目录**区分，两条 `source` 正则互斥。

**为什么不能给固定名资产上 immutable**：`immutable` 明确告诉浏览器一年内不要回源验证，而这些文件名
永不改变，于是**回访用户会被长期钉在他第一次下载到的那份图谱上，且没有任何提示**。真实事故：图谱升到
v8.1.67（133 条）并已部署到生产后，测试者浏览器里仍在跑 132 条的旧图谱——新的哈希 JS 配旧图谱资产。
对一个把张力线叠加在患者脸上的临床可视化工具，这种静默的版本钉死是不可接受的。

同一个坑还有代码侧的一半：`web/src/services/assetLoader.ts` 取固定名资产时必须使用
`fetch(url, { cache: "no-cache" })`。这不仅避免 `force-cache`，还会让浏览器对 fresh 和 stale
缓存都执行条件验证，因此能迁移已经保存了旧 `immutable` 响应头的回访用户；只改新响应的
`Cache-Control` 或退回默认 fetch，都无法主动更新这些旧条目。

以上两条由 `tools/test_web_architecture.ts`（`npm test` 内）机械守住：它会用 `web/assets/` 下的真实
文件名去匹配每条带 `immutable` 的 header 规则，命中即失败；同时检查固定名资产确实有一条回源验证规则、
以及 `assetLoader` 的真实代码显式使用 `cache: "no-cache"`。`tools/test_asset_loader.ts` 还会 mock fetch，
直接断言运行时请求的 `RequestInit.cache`，避免只靠源码字符串判断。

## Production URL

当前 `master` 生产环境的权威地址是：

- https://langer-face.vercel.app

其余文档只引用本节，避免 Vercel 自动生成域名和人工别名在多处漂移。

本仓库已有 [web/vercel.json](../../web/vercel.json)，里面声明了：
- `installCommand`: `npm ci`
- `buildCommand`: `npm run build`
- `ignoreCommand`: `node scripts/vercel-ignore-build.ts`，作为二级保护：只允许 `master` 构建，并且仅在 `web/` 有变化时构建
- `outputDirectory`: `dist`
- `git.deploymentEnabled`: 默认只允许 `master` 自动部署，避免长 PR / feature branch 高频 push 触发 Vercel 限流和 GitHub deployment record 噪声
- `github.autoJobCancelation`: 同一 PR / 分支有新 commit 时取消较旧构建
- `/assets/*` 是运行时资产根路径，承载 `.task` 模型、atlas JSON、triangles、标准脸等由 `copy-runtime-assets` 复制的文件
- JS/MJS 的 `Content-Type`

如果 Dashboard 与 `web/vercel.json` 同时配置同一项，保持它们一致，避免不同环境行为不一致。

### SPA 路由与运行时资产路径

React SPA 的线上入口是站点根 `/`，Vercel 会把 `/`、`/live`、`/incision`、`/annotate`、`/surgery`、`/settings/(.*)` 以及兼容地址 `/app`、`/app/(.*)` 全部 rewrite 到 `/index.html`。因此 SPA shell 的 JS/CSS
和运行时资产都必须从站点根 `/assets/` 读取，不能写成 document-relative 的 `../assets/`、`assets/` 或 `assets/foo.json`。
在 `/app/incision`、`/app/settings/atlas` 等嵌套路由下，相对路径会被浏览器解析为 `/app/assets/foo.json`、`/app/settings/assets/foo.js`
等错误 URL；这类 URL 会命中 SPA rewrite，返回 HTML，而不是 JSON/JS。浏览器控制台常见表现是：
`SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`。

当前约束如下：

- `web/vite.config.ts` 的 `copy-runtime-assets` 把 `web/assets/` 原样复制到 `dist/assets/`。
- `web/vite.config.ts` 的 `base: "/"` 让构建产物中的 SPA JS/CSS 使用 `/assets/...`，避免深链接下解析成 `/app/**/assets/...`。
- `web/src/services/assetLoader.ts` 的默认 asset base 是 `/assets/`，并把裸 `assets/` 归一到站点根 `/assets/`。
- 只有显式远端资产源才通过 `?assetBase=` 或 `VITE_LANGERFACE_ASSET_BASE_URL` 覆盖；覆盖值必须是浏览器可访问的 HTTPS/API 地址或明确的根路径。
- 排障时看 Network 面板：SPA JS/CSS 和运行时 JSON/task/bin 请求应为 `/assets/...` 或配置的远端 asset base，不应出现 `/app/assets/...` 或 `/app/settings/assets/...`。
- 回归测试在 `tools/test_asset_loader.ts`，会模拟 `https://example.test/app/incision`，防止嵌套路由再次污染资产 URL。

### 限流时的处理顺序

遇到 Vercel rate limit / build queue 被打满时，按这个顺序处理：

1. 先确认 Vercel Project 的 Git 分支部署开关与 [web/vercel.json](../../web/vercel.json) 一致：`master` 为 `true`，所有 PR / feature / integration branch 都不要打开自动 Preview。
2. 如果需要线上验收当前开发分支，由维护者用 Vercel Dashboard 或 CLI 手动创建一次 Preview，不要把该分支加入自动部署白名单。
3. Dashboard / GitHub 仓库主页里看到的一长串旧 Deployment 是不可变历史记录 / 回滚点，不代表仍有一长串“活跃环境”。如果只想保留可见的当前开发和生产两个版本，需要在 Vercel Dashboard 里清理旧 Deployment，或者单独清理 GitHub deployment records；仓库配置只能阻止未来继续生成无关部署。

## GitHub Branch Protection

建议保护 `master` 分支：

- Require a pull request before merging.
- Require status checks to pass before merging.
- Require branches to be up to date before merging.
- Require approvals: `1`.
- Disable force pushes.

Required status checks 建议包含：

| Check | 来源 |
|---|---|
| `lint` | `.github/workflows/ci.yml` |
| `python-tests (3.10)` | `.github/workflows/ci.yml` matrix |
| `python-tests (3.11)` | `.github/workflows/ci.yml` matrix |
| `python-tests (3.12)` | `.github/workflows/ci.yml` matrix |
| `js-tests` | `.github/workflows/ci.yml` |
| Vercel Production Deployment check | Vercel GitHub 集成在 `master` 生产部署时生成，具体名称以 GitHub UI 显示为准 |

实际 check 名称由 GitHub UI 决定。第一次 PR 跑完后，在 Branch protection 页面选择已经出现的 check，不要手写猜名称。

## GitHub Auto-merge 与 stacked PR

仓库设置中保持 **Allow auto-merge** 和 **Automatically delete head branches**
开启。自动删除不是单纯清理：父 PR 合并后，GitHub 会把仍以该 head branch 为 base
的开放 PR 自动 retarget 到父 PR 原来的 base，这是 stacked PR 逐层进入 `master`
的接力点。

`master` 的保护规则还必须保持：

- `strict: true`，PR 分支必须包含最新 `master`；
- 至少 1 个 approving review；
- `dismiss_stale_reviews: true`，任何新提交都会撤销旧 approval；
- 不使用 admin bypass。

2026-07-30 已通过 GitHub API 启用 `dismiss_stale_reviews`。可用下面的只读命令复核，
不要仅依据文档推断线上设置：

```bash
gh api repos/jwj1342/LangerFace/branches/master/protection \
  --jq '{strict:.required_status_checks.strict,
         dismiss_stale_reviews:.required_pull_request_reviews.dismiss_stale_reviews,
         approvals:.required_pull_request_reviews.required_approving_review_count,
         checks:.required_status_checks.contexts}'
```

维护者为允许自动接力的 PR 添加 `automerge:stack` 标签。
[`.github/workflows/automerge-approved.yml`](../../.github/workflows/automerge-approved.yml)
会在以下时机扫描：

- PR 打标、Ready、更新或 base 变化；
- reviewer 提交或撤回 review；
- 每 5 分钟兜底轮询；
- 维护者手动 `workflow_dispatch`。

策略实现位于 [`tools/automerge_policy.mjs`](../../tools/automerge_policy.mjs)，约束为：

1. 只选择 `baseRefName == master`、非 Draft、带 `automerge:stack` 且尚未启用
   Auto-merge 的 PR。子 PR 在仍指向临时父分支时不会被合并。
2. 调用 `gh pr merge --auto --squash --match-head-commit <SHA>`，不使用
   `--admin`。实际合并仍由 GitHub 原生 Auto-merge 等待 branch protection：
   必需 checks 全绿且至少 1 个 approval。
3. 如果 PR 因 `strict: true` 落后于 `master`，先调用 GitHub Update branch API，
   并用 `expected_head_sha` 防止并发覆盖；本轮不会同时启用 Auto-merge。新 head
   重新通过 CI 和审核后，下一轮才登记自动合并。
4. 单个 PR 更新或登记失败不会中断后续 PR；脚本会尝试完全部候选，再汇总失败并让
   workflow 以非零状态结束，便于按 PR 排障。
5. `pull_request_target` 场景只从受保护的默认分支 checkout
   `tools/automerge_policy.mjs`，不读取或执行 PR head 代码；checkout credential
   不持久化。
6. workflow 的 job 权限只提升到 `contents: write` 和
   `pull-requests: write`，不允许机器人提交 approving review。
7. GitHub 在 PR 切换 base 时会取消旧 Auto-merge 请求；workflow 在子 PR
   retarget 到 `master` 后重新启用，避免把它提前合进临时父分支。

Branch protection 的 required checks 是显式 allowlist，不会因为 workflow 新增 job
自动扩充。新增 `browser-tests`、文档同步或其他合并门禁时，必须等该 job 已在默认分支
存在、所有仍指向 `master` 的开放 PR 都能产生该 check 后，再把它加入 required
contexts；在完成设置更新前，不得把新 job 仅写成“必需”而实际仍为 optional。

### 启用、暂停和排障

启用：

```bash
gh pr edit <PR号> --add-label 'automerge:stack'
```

如果 PR 已经直接指向 `master`，也可立即登记原生 Auto-merge：

```bash
gh pr merge <PR号> --auto --squash
```

暂停时需要同时移除授权标签和已有的原生请求：

```bash
gh pr edit <PR号> --remove-label 'automerge:stack'
gh pr merge <PR号> --disable-auto
```

PR 没有自动前进时依次检查：

1. PR 是否 Ready、带 `automerge:stack`，当前 base 是否确实为 `master`。
2. GitHub 合并框是否显示 Auto-merge 已启用；若没有，手动运行
   `Auto-merge approved PRs` workflow 或等待下一次 5 分钟轮询。
3. `master` 的必需 checks 是否全部成功、是否已有满足 branch protection 的
   approving review、是否存在冲突或待更新分支。
4. Repository Actions 设置是否允许 workflow 请求
   `contents: write` / `pull-requests: write`；不要用 admin bypass 解决权限或 CI
   问题。

## 日常发布流程

协作者的日常流程见 [CONTRIBUTING.md](../onboarding/CONTRIBUTING.md#pr--preview-工作流)。本文件只保留维护者需要的 Vercel / GitHub 设置细节。

## Preview 访问策略

Vercel [Deployment Protection](https://vercel.com/docs/deployment-protection) 可以保护 Preview 和 Production URL。当前项目的默认建议是：**Production 公开；Preview 受保护**。原因是后续 Preview 可能包含未发布功能、受限头模或临床评审素材。

协作者访问方式：

| 场景 | 推荐做法 | 说明 |
|---|---|---|
| 项目组成员看 Preview | 加入 Vercel project/team，用自己的 Vercel 账号登录 | 适合长期协作者；权限可撤销 |
| 外部医生 / 短期评审 | 维护者生成 Vercel [Shareable Link](https://vercel.com/docs/deployments/sharing-deployments)，或启用 [Password Protection](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/password-protection) 后单独发密码 | 不要求对方加入 Vercel team |
| 自动化测试访问 protected Preview | 使用 [Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)，secret 放在 GitHub Secrets | 只给 CI / E2E / monitoring；不要人工分享 |
| 完全公开 Preview | 仅在确认不含受限数据、真实人脸影像、未发布临床材料时使用 | 便利性高，但风险也最高 |

不要把 Vercel bypass token 写进仓库、PR、issue、聊天记录或前端环境变量。若需要 E2E 自动化访问 protected Preview，单独新增 GitHub Secret，并在 workflow 中通过 header 或 Vercel 官方支持的 bypass 方式注入。

## 环境变量

当前纯静态前端不需要 Vercel 环境变量。
当前产品边界不包含病例后端、Worker API、D1/R2 数据库或远端病例数据源。若仅为诊断面板增加公开配置，仍要记住 Vite 会把
`VITE_` 前缀变量注入浏览器端，任何私钥或平台 token 都不能放进 `VITE_*`。

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

## 排障时需要收集什么

Preview / Production 出问题时，先收集这些信息再排查：

1. PR URL 和 commit SHA。
2. Vercel Preview URL 和 Vercel Deployment URL。
3. 失败的 GitHub check 名称和链接。
4. 浏览器控制台错误截图或文本。
5. Network 面板里失败资源的 URL、status code、response。
6. 是否正在访问 protected Preview；如果是，访问者是否有 Vercel 权限或 Shareable Link。

不要把 `VERCEL_TOKEN`、Cloudflare token、R2 密钥、Vercel bypass token 直接发在聊天里。需要用它们时，把它们放到 GitHub Repository Secrets 或 Vercel Dashboard Environment Variables。
