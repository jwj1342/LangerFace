# Cloudflare 后端落地与 CI/CD 接入计划

本文记录 Phase 1 后端能力的落地流程：用 Cloudflare Workers 承载瘦 API，用 D1 保存结构化病例与审阅状态，用 R2 保存受限大对象，并通过 GitHub Actions 做验证和部署。架构边界见 [BACKEND_DATA_ARCHITECTURE.md](BACKEND_DATA_ARCHITECTURE.md)；本文只回答“怎么开始做、怎么验证、怎么上线”。

## 目标

- 让病例、肿物输入、划线、候选切口、医生审阅和 provenance 可以跨浏览器会话保存。
- 保持前端仍可用 `LocalDataSource` 离线运行；后端到位后只新增同接口的 `ApiDataSource`。
- 把 Cloudflare 资源、schema、部署配置写入仓库和 CI，而不是依赖 Dashboard 手工状态。
- 明确哪些能力可以放在 Cloudflare 免费层，哪些必须继续留在浏览器、本地或 HPC。

## 非目标

- 不把 MediaPipe 视频批处理、FLAME 拟合、OpenCV、Blender、复杂肿物模拟优化放进 Worker。
- 不在第一版实现电子签名、医院 HIS/EMR 对接、正式临床权限系统或 HIPAA/等保级合规闭环。
- 不把 Cloudflare token、R2 密钥或任何生产 secret 暴露到前端 `VITE_*` 环境变量。

## 推荐工程结构

新增一个独立 Worker 工程：

```text
workers/api/
  package.json
  wrangler.jsonc
  src/
    index.ts
    routes/
    db/
    schemas/
    auth/
  migrations/
    0001_initial.sql
  test/
```

建议从最小可验证 API 开始：

| 路径 | 目的 |
|---|---|
| `GET /health` | CI、部署和人工排障用健康检查 |
| `POST /api/cases` | 创建脱敏病例工作区 |
| `GET /api/cases/:id` | 获取病例、肿物、标注、候选和审阅摘要 |
| `PUT /api/cases/:id` | 更新病例状态或前置参数 |
| `POST /api/cases/:id/tumors` | 保存肿物输入 |
| `POST /api/cases/:id/annotations` | 保存医生划线或图谱标注 |
| `POST /api/cases/:id/incision-candidates` | 保存候选切口、规则 trace、警告和 provenance |
| `POST /api/incision-candidates/:id/review` | 保存医生接受、退回、否决、备注和覆盖原因 |
| `GET /api/cases/:id/export` | 导出结构化审阅包或报告草案 |

## 本地验证流程

第一版不要直接在云端边点边试。先把 Worker、D1 migration、schema 校验和 API 测试在本地跑通：

```bash
cd workers/api
npm ci
npm run typecheck
npm test
npx wrangler dev
npx wrangler d1 migrations apply langerface-dev --local
```

本地测试至少覆盖：

- CORS 允许 Vercel production / preview origin，拒绝未知 origin。
- `POST /api/cases` 能创建脱敏病例，不接受姓名、手机号、医院病历号等明显身份字段。
- `POST /api/cases/:id/incision-candidates` 能保存候选几何、rule trace、warnings 和 candidate version。
- `POST /api/incision-candidates/:id/review` 对高风险候选要求 reviewer note 或 override reason。
- R2 私有对象路径不直接公开，只由 Worker 校验后返回短期访问 URL 或受控响应。
- D1 migration 可以重复在空库上执行，schema 版本可追踪。

## 云端资源少量创建

Cloudflare 端只建议做少量一次性基础资源创建，资源名应稳定、可读、可在文档中复现：

| 资源 | 建议命名 | 用途 |
|---|---|---|
| D1 database | `langerface-prod` / `langerface-preview` | 保存病例、肿物、标注、候选、审阅和审计事件 |
| R2 bucket | `langerface-assets-prod` / `langerface-assets-preview` | 保存受限头模、纹理、脱敏截图、报告导出 |
| Worker service | `langerface-api` | API、鉴权、CORS、D1/R2 访问 |
| 自定义域名 | `api.langerface.example.com` | 前端 `VITE_API_BASE_URL` |

资源创建可以先由维护者手动执行一次，随后把生成的 database id、bucket name 和 Worker name 写入 `wrangler.jsonc` 或环境配置。不要让 CI 在每次运行时自动创建或删除这些基础资源。

## API token 权限

GitHub Actions 的 Cloudflare token 应按最小权限配置。第一版建议：

```text
Account:
- Account Settings Read
- Workers Scripts Read
- Workers Scripts Write
- D1 Read
- D1 Write
- Workers R2 Storage Read
- Workers R2 Storage Write
- Workers Tail Read   # 可选，仅用于 wrangler tail / 排障
```

如果 CI 不负责配置自定义域名、Worker route、DNS 或 Cloudflare Access policy，就不要授予 Zone / DNS / Access 写权限。后续若需要自动管理域名，再单独扩权并记录原因。

## GitHub Secrets

建议新增：

| Secret | 用途 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | GitHub Actions 调用 Wrangler |
| `CLOUDFLARE_ACCOUNT_ID` | 目标 Cloudflare account |
| `CLOUDFLARE_D1_DATABASE_ID` | production D1 database id |
| `CLOUDFLARE_R2_BUCKET` | production R2 bucket name |

这些 secret 只进入 GitHub Actions。前端只需要公开的 API base：

| 变量 | 位置 | 用途 |
|---|---|---|
| `VITE_API_BASE_URL` | Vercel / frontend env | 浏览器访问 Worker API |

## CI/CD 接入

PR 阶段只做验证，不部署 production：

```yaml
worker-tests:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: "24"
        cache: npm
        cache-dependency-path: workers/api/package-lock.json
    - working-directory: workers/api
      run: npm ci
    - working-directory: workers/api
      run: npm run typecheck
    - working-directory: workers/api
      run: npm test
```

`master` 合并后再部署 Worker：

```yaml
deploy-worker:
  if: github.ref == 'refs/heads/master'
  runs-on: ubuntu-latest
  needs: [worker-tests]
  steps:
    - uses: actions/checkout@v4
    - uses: cloudflare/wrangler-action@v3
      with:
        apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        workingDirectory: workers/api
        command: deploy
```

D1 migration 建议作为单独可见步骤执行，不要隐式塞进普通 deploy：

```yaml
- uses: cloudflare/wrangler-action@v3
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    workingDirectory: workers/api
    command: d1 migrations apply langerface-prod --remote
```

生产 migration 是否自动执行，应由 PR 风险决定。破坏性 schema 变更必须单独说明回滚策略。

## 前端接入边界

React 前端不应直接散落 `fetch("/api/...")`。后端接入点应收敛在数据源实现里：

```text
web/src/services/dataSource.ts
  LocalDataSource  # 当前浏览器 localStorage/sessionStorage/静态资产实现
  ApiDataSource    # 后端到位后新增，调用 Worker API
```

切换策略：

- 没有 `VITE_API_BASE_URL` 时默认使用 `LocalDataSource`。
- 有 `VITE_API_BASE_URL` 且健康检查通过时启用 `ApiDataSource`。
- API 不可用时显示明确反馈，不静默丢失医生划线或候选方案。
- 失败重试不应重复创建病例或候选，写接口需要幂等键或客户端 draft id。

## 数据保存优先级

第一版应优先保存结构化状态：

1. 病例脱敏编号、年龄分档、前置参数。
2. 影像/模型引用，不保存真实姓名、病历号、原始照片或视频 payload。
3. 肿物输入：层次、切缘、中心、边界、直径、来源、作者。
4. 标注线：坐标系、点序列、作者、版本、校验状态。
5. 候选切口：几何、候选类型、RSTL 依据、guardrails、warnings、provenance。
6. 审阅记录：接受/退回/否决、医生备注、高风险覆盖原因、时间戳。
7. 审计事件：创建、编辑、确认、导出、失败原因。

真实患者照片、视频、3D 纹理、超声资料默认不进入公开仓库；如需在线访问，只能放在受控 R2 或医院内网存储，并由 Worker 鉴权和审计。

## 回滚与排障

- Worker 代码回滚：使用 Git revert 或 Cloudflare deployment rollback，不在 Dashboard 手动改线上脚本。
- D1 schema 回滚：优先前向兼容 migration；破坏性变更需独立 PR 和数据备份说明。
- R2 对象误传：先撤销访问路径或签名 URL，再清理对象；不要公开桶。
- 前端 API 故障：`ApiDataSource` 应提示后端不可用，并保留本地 draft，避免医生输入丢失。
- 排障时收集：commit SHA、Worker deployment id、GitHub Actions run、Cloudflare request id、失败接口、status code、脱敏 request body 摘要。

## PR 验收重点

- `workers/api` 可以本地启动，`GET /health` 返回稳定 JSON。
- D1 migration 在本地空库上可执行。
- PR CI 新增 Worker typecheck/test，不影响现有 Python 和 Web 测试。
- 生产部署 job 只在 `master` 运行。
- GitHub Secrets 和前端 `VITE_API_BASE_URL` 的边界清楚。
- 文档明确 Worker 不承载重计算，不保存未授权真实临床影像。
