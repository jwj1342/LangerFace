# 受控标记：运行身份与最小回归包

## 1. 先确认跑的是谁

在最新成果 worktree 的 `web` 目录执行。不得按版本名选择另一个较旧的干净工作区。

```powershell
npm run dev:marker-v035 -- --port 4173
```

另开终端核验这个服务（一个短时无头 Chromium，不启用模型或摄像头）：

```powershell
npm run verify:marker-v035 -- http://127.0.0.1:4173
```

浏览器打开 `/__runtime-identity`，检查实际 profile、实现版本、分支、HEAD、工作区指纹、包含未提交代码的源码指纹和关键资产指纹，再进入 `/app/workflow`。此页是独立诊断入口，不增加操作画布上的按钮或文字。它显示的“版本核对通过”不代表整体算法准确率合格，也不单独证明此工作区是最新成果；交付命令还会与当前目标工作区逐项比较。

当前 `color-difference-v0.35` 的实现常量仍是 `0.35`；“v0.35.1 初步测试合格”的 Git 回档名称不等于代码内的实现常量。不可为了让检查通过而改算法版本常量。

本门禁覆盖规范 **开发服务**。普通 `preview`、旧服务、缺失 JSON 身份端点、错误 profile、错误工作区/HEAD、源码或关键资产改变，一律不得用于这份 v0.35 验收。没有给生产包新增身份清单，不能据此声称生产部署已经核验。普通构建与默认 `legacy-v0.23` 保持原语义；通用 Playwright 只调整本地样本的收集范围，见下节。

验收过程中不要修改源码或资产；诊断端点遇到变化返回 409，须重启并重新核验。运行身份不是安全签名，也不替代所有外部资产、RSTL 效果和手机网络检查。

## 2. 固定小包，不重复跑完整图库

这是本地样本专项，不属于默认 CI。执行前须具备独立的浏览器/模型/服务授权及完整本地输入。需要 `tools/fixtures/controlled_marker_browser_samples.local.json`（9例整图参考参数）、image10参考JSON和指定原图目录；这些本地数据被精确忽略，不随仓库发布。离线专用命令另需要 `controlled_marker_reviewed_samples.local.json`（8例裁剪参数）及原裁剪像素，图05专用命令需要其冻结结果。文件名不等于授权，缺输入应报错，不得虚构数据或记通过。

```powershell
$env:CONTROLLED_MARKER_REAL_SAMPLE_DIR='<第三版测试图集的本地绝对目录>'
npm run test:marker-regression
```

若当前 Chromium 没有安装，可在上面命令前指定已安装的 Chrome（不用 Computer Use）：

```powershell
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
```

专用配置使用 4175，避免占用人工验收的 4173。始终单 worker、无头、无自动重试；命令的总墙钟时间最多六分钟，包含服务启动。超时只终止本次启动的测试进程树，不结束其他任务或已复用的服务。手动中断可按 Ctrl+C。

固定范围（7 项，以专用配置的 testMatch/grep 为准）：

1. 既有 `freehand-mobile-regression.spec.ts` 的 3 项：桌面三栏与提示、受限候选不可确认的原因、手机自由描绘与工具栏/滚动回归。尺寸和行为断言沿用原测试，不另复制一份可能漂移的期望。
2. `controlled-marker-color-difference-real-sample.spec.ts` 的图15两个既有落点，准确坐标和原图 SHA-256 由本地整图参考清单保留。缺清单、缺图或哈希不符时失败，不允许跳过后报全绿。
3. 两个落点是历史成功/失败对照；不能固定要求旧失败继续失败。当前测试期望二者均识别，并继续检查实际 seed 误差 ≤1px、中心误差 ≤5px、IoU ≥0.8、参考覆盖率和预测精确度均 ≥0.84，以及正式页面候选叠加。参考椭圆是工程近似，不是临床真值。
4. `controlled-marker-image10.spec.ts` 的桌面与手机视口各1项。它们已有于专用配置；本次修正文档漏记，不是增加运行额度或重新测试。图13独立配置仍保留其1项，不并入这个7项小包。

通用配置精确排除上述 real-sample、image10、image13 三份文件，两个专用配置显式清空继承的 `testIgnore`，避免专项被意外排除。`npm run test:lesion-local-samples` 是3支离线图片检查，`npm run test:workflow-local-sample` 是图05冻结结果检查，均不由默认 `npm test` 执行。默认工程/CI结果与本地样本效果结论分别记录，不能互相代签；这也不替代原有其他环境与资产依赖。

测试前用浏览器实际加载的 selector 与服务身份对照；测试后回读并检查服务未切换。回执在忽略目录 `local_outputs/runtime-identity/run-*/`；截图、诊断和测试产物在 `web/test-results/marker-v035/`。前后身份文件仅证明版本一致，测试结论仍以测试退出码和逐项结果为准。

## 3. 人工检查与剩余边界

1. 电脑和手机分别打开同一服务的 `/__runtime-identity`，应显示目标 profile，且源码/资产/工作区指纹一致。Tailscale HTTPS 地址沿用已确认的本机代理，不另改远端、不默认开放监听。
2. 进入操作页面，桌面与手机原有布局应不变；上传同一原图检查已认可的动作。真机浏览器工具栏高度、微信与浏览器差异仍需要人工观察，模拟视口不能替代真机验收。
3. 若显示旧算法、核对失败或无法打开，提供地址和身份页截图；不要继续用该页面评判算法。本次门禁修复不承诺识别准确率提高，不重跑已保存的 328 张离线阶段图，也不修改 RSTL 功能。
