# 工程教训 / 协作避坑（Engineering Lessons）

把多人并行改这个仓库时踩过的坑沉淀到这里，避免重复犯。每条都是真实事故复盘 + 可执行规则。
新踩到坑就追加一条。配套规约见 [CONTRIBUTING.md](CONTRIBUTING.md)、[CI_CD_VERCEL.md](CI_CD_VERCEL.md)。

---

## 1. `git add -A` 把 `node_modules` 符号链接误提交进仓库

**现象**：一次重构 PR 合并后，master 上多出一个被跟踪的 `web/node_modules`（mode 120000，符号链接），
指向开发者本机的绝对路径 `/scratch/.../web/node_modules`（自引用）。随后在本地 `git pull` 时，
git 用这个 symlink 覆盖了本地真实的 `node_modules` 目录，导致本地依赖被一个**自引用空链接**清空。

**根因（三个因素叠加）**：
1. 在 worktree 里为了复用依赖，手动建了 `web/node_modules` → 主仓库 `node_modules` 的符号链接。
2. 提交时用了 `git add -A`，把这个 symlink 一并暂存。
3. `web/.gitignore` 写的是 `node_modules/`（**带尾斜杠**）——尾斜杠只匹配**目录**，**不匹配符号链接**，
   所以 symlink 没被忽略，被 `-A` 收了进去。

**修复**：`git rm web/node_modules` 取消跟踪；`.gitignore` 改为 `node_modules`（去掉尾斜杠，同时覆盖目录与 symlink）。

**规则（务必遵守）**：
- ❌ **永远不要用 `git add -A` / `git add .` 提交**。逐个 `git add <明确的文件/目录>`，只暂存你真正改的东西。
- `.gitignore` 想同时挡住「目录」和「同名符号链接」，用**不带尾斜杠**的 `node_modules`，别用 `node_modules/`。
- 在 worktree 里用 symlink 复用 `node_modules` 没问题，但它必须被 gitignore **且**绝不能被 `-A` 误收。
- 提交前先 `git status --short` 扫一眼有没有意外的 symlink / 临时文件 / 大文件。

---

## 2. 大「伞状」PR 合并后，所有在飞的分支瞬间过期/冲突

**现象**：一个改动面极广的伞状 PR（如 #66 拓扑守卫 + FLAME 轨）合进 master 后，所有其它 open PR 立刻
变成 `BEHIND` / `CONFLICTING`，CI 与合并全部受阻。

**根因**：这些分支都是从「合并前的 master」拉的；伞状 PR 重写了它们也碰的文件（`atlas.py` / `test_atlas.py` /
前端 pipeline / 3D 模式入口 / `package.json` 等），于是逐行冲突。

**处理**：
- 逐个把 master **merge 进分支**（而非 rebase——本仓库 squash 合并，merge commit 最终会被压掉，且不改写他人分支历史），
  解冲突 → **本地重测** → push → 合并。
- 注意 **auto-merge 不会自动改 textual 冲突**；自动合并的 PR（如 codex 的 #71/#72）若早于伞状 PR，必须先人工 rebase + 重解。
- **语义冲突**比文本冲突更隐蔽：例如某测试 `import` 了伞状 PR 改过的常量，文本不冲突但合并后会跑挂——
  这正是分支保护「require branches up to date」(strict) 想拦的，别用 `--admin` 草率绕过它，除非你已确认文件互不相干。

**预防**：互相会改同一文件的 PR（如都改 `tools/export_web_assets.py` 或 `web/src/services/geometryAtlas.ts`）**串行**做——
一个合了再拉下一个，别并行，否则后合的那个必冲突。彼此文件不相交的 PR 才安全并行。

---

## 3. 分支保护与合并机制的几个硬约束

master 受保护：**1 个 approval + 5 个必需检查**（`lint` / `python-tests` 3.10·3.11·3.12 / `js-tests`）+ **strict（分支须最新）**。
（`require_last_push_approval=false`，所以 approve 后再 push 修复不会掉审批。）

- **不能给自己的 PR 点 approve**（GitHub 限制）。自己作者的 PR 要合，只能 `gh pr merge --admin` 绕过审批要求
  （检查仍应为绿）。把这类 PR 拉给 **ArXee** 评审是常态，但合是另一回事。
- **级联过期**：合掉一个 PR 后 master 前进一格，其它 PR 立刻 `BEHIND`。要么 `gh pr update-branch` 再等 CI，
  要么对**文件不相交**的 PR 用 `--admin` 一次性合掉（省一轮 CI），但务必先确认互不冲突。
- `gh pr merge --squash --delete-branch` 对**仍被 worktree 检出**的本地分支会删除失败（报 "Cannot delete branch ... checked out at ..."）——
  **远端分支已删成功**，本地分支需先 `git worktree remove` 再 `git branch -D` 单独清理。
- **`--admin` 不绕过 draft**：草稿（draft）PR 即便 `gh pr merge --admin` 也会失败（报 "Pull Request is still a draft"）。
  合并前先查 `gh pr view N --json isDraft`；是草稿就先 `gh pr ready N` 标就绪。（codex 自动建的 PR 常是 draft。）
- **别用管道吞掉合并的退出码**：`gh pr merge --admin --delete-branch | grep …` 会吃掉失败的 merge 退出码——
  于是 merge 没成、`--delete-branch` 却照删，**分支被删 + PR 被关**。真实事故见 #77（草稿合并失败 + 管道吞码），
  所幸提交还在本地分支上，靠「重推分支 → `gh pr reopen` + `gh pr ready` → 正常合并」恢复。
  **合并步骤单独跑并检查退出码，别和清理串进同一条管道。**
- **关联 issue 规约**：完全解决才用 `Closes`，部分进展用 `Refs`，**绝不**用 `Closes` 自动关掉 epic
  （详见 [CONTRIBUTING.md](CONTRIBUTING.md) 与团队约定）。`Closes #N` 必须是**纯文本**——写进反引号代码块里 GitHub 不解析。

---

## 4. 登录节点（HPC）上的测试约定

不在登录节点跑重计算；但 ruff / pytest / `npm test` / `npm run build` 属轻量，可直接跑。

- **Python**：仓库 `.venv` 用**纯 `.pth`**（只写 src 路径）做 editable 安装，所以可用
  `PYTHONPATH=<worktree>/src .venv/bin/python -m pytest ...` 干净地让每个 worktree 跑自己的代码，支持并行测试。
- **cv2 装不上**：集群通过 Lmod dummy-wheel 提供 opencv，`pip install opencv-python[-headless]` 会在构建步失败。
  因此 `tests/test_render.py::test_overlay_draws_lines` 与 `tests/test_pipeline.py::test_fade_out_after_face_lost`
  在本机必然 `ModuleNotFoundError: cv2` ——**这是预期基线**，GitHub Actions（ubuntu，装了 opencv）会覆盖它们。
  本地别为这 2 个失败惊慌；用 `--continue-on-collection-errors` 或只跑相关子集。
- **web**：在 worktree 里 `ln -sfn <主仓库>/web/node_modules <worktree>/web/node_modules` 复用依赖，避免重装；
  但见教训 #1——这个 symlink 绝不能被 `git add -A` 收进去。

---

## 5. 行为保持式重构的纪律

把「重构」做成可证明的 no-op，而不是「我觉得等价」：

- **逐字搬运**：拆分文件时函数体**原样复制**，只动 import/export，不顺手「优化」逻辑。
- **两步式拆分导出面**：大文件拆模块时可以先用临时 barrel re-export 稳住行为；完成调用方迁移后，应切到直接导入目标 TypeScript service 并删除旧 facade。
- **靠现成测试兜底**：本仓库有几类强力测试——跨语言**对拍 fixture**（`one-euro fixture error 0.0` 之类逐位比对）、
  **import 无环检查**（`test_web_architecture.mjs`）、Umeyama/遮挡数值测试。重构后这些全绿，等价性才算证到。
- **生成物要确定性 + CI 漂移门禁**：跨语言单一真源（如从 `constants.py` 生成 `web/src/services/constantsGenerated.ts`，见 #30）——
  生成器输出必须逐次字节一致，并在 CI 里 `git diff --exit-code` 生成物，改了源却忘了重生成即报错。

---

## 6. 评审别人（含 agent 产出）的 PR 时，对抗式核对

合并前，针对性地证伪而非默认信任：
- **import 真能解析**：新代码引用的符号（如 `os`、`TOPOLOGY_ID`）在该文件里是否已 import？跑挂的常是 `NameError`。
- **行为是否真保持**：是不是只加了日志/字段而没动控制流？异常仍照常上抛？
- **测试是否非恒真**：扰动一下被测对象，测试会不会失败？还是 mock 到什么都没测？
- **隐私边界**：诊断/日志导出有没有混入像素、人脸纹理、患者身份（本项目硬约束，见 [PRIVACY_AND_AUDIT.md](PRIVACY_AND_AUDIT.md)）。

---

## 速查清单（提交前过一遍）

- [ ] 用 `git add <明确路径>`，**不用** `-A` / `.`；`git status --short` 扫一眼无意外文件。
- [ ] 新忽略项用不带尾斜杠的模式，确保目录与 symlink 都挡住。
- [ ] 与他人会改同一文件的 PR 串行；不相交的才并行。
- [ ] 本地跑 ruff + pytest + `npm test` + `npm run build`（容忍那 2 个已知 cv2 失败）。
- [ ] 关联 issue：完全解决 `Closes`（纯文本）、部分 `Refs`、epic 不自动关。
- [ ] 自己作者的 PR 合不了别人审 → `--admin`（先确认非 draft，必要时 `gh pr ready`）；合并与清理分两步、检查退出码，别串进一条管道。
