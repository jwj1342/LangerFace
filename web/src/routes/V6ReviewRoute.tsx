import { useEffect } from "react";

import "../v6Review.css";

export function V6ReviewRoute() {
  useEffect(() => {
    let runtime: typeof import("../services/personalized/v6ReviewRuntime") | null = null;
    let cancelled = false;
    void import("../services/personalized/v6ReviewRuntime").then((module) => {
      if (cancelled) module.disposeV6Review();
      else {
        runtime = module;
        module.mountV6Review();
      }
    });
    return () => {
      cancelled = true;
      runtime?.disposeV6Review();
    };
  }, []);

  return (
    <div className="v6-review-page">
      <header className="v6-shell v6-header">
        <a className="brand" href="/"><span className="brand-mark" aria-hidden="true" /><span>LangerFace</span></a>
        <nav className="top-nav" aria-label="页面导航">
          <a href="#results">实验结果</a><a href="#review">本地审核</a><a href="/personalized">个性化采集</a><a href="/">返回主界面</a>
        </nav>
      </header>
      <main>
        <section className="v6-shell hero">
          <div>
            <div className="eyebrow">Personalized RSTL · Baseline V6</div>
            <h1>皱纹走势引导的<br />局部 RSTL 微调</h1>
            <p className="lead">9 个表情以严格并集汇总个体皱纹证据，在中性脸坐标系内仅沿法向微调原始 216 条曲线。曲线数量、点序与连接关系保持不变。</p>
            <div className="hero-actions"><a className="button button-primary" href="#results">查看 5 例完整结果</a><a className="button" href="#review">审核本地 V6 文件</a></div>
          </div>
          <aside className="hero-card" aria-label="V6 流程"><div className="flow">
            {[
              "YOLOv8 皱纹检测，confidence = 0.07",
              "9 表情配准后严格并集，不取交集",
              "0.013 × face width 软连接与统一方向窗口",
              "连续折线投影、真实证据弧长与覆盖率筛选",
              "曲线局部区间级 0.007 × face width P90 保护",
              "交叉、折角、位移与拓扑检查后导出",
            ].map((label, index) => <div key={label}><div className="flow-row"><span className="flow-n">{index + 1}</span><span>{label}</span></div>{index < 5 ? <div className="flow-arrow" /> : null}</div>)}
          </div></aside>
        </section>
        <section className="section" id="results"><div className="v6-shell">
          <SectionHead eyebrow="Verified experiment" title="V6 完整可视化结果">绿色为皱纹证据，灰色为初始 RSTL，洋红为微调后 RSTL，青色为位移。下列结果均来自 confidence 0.07 与 216 曲线图谱。</SectionHead>
          <div className="subject-tabs" id="subjectTabs" role="tablist" aria-label="受试者" />
          <div className="view-tabs v6-view-tabs" id="viewTabs" role="tablist" aria-label="结果视图" />
          <div className="example-grid"><div className="image-panel"><img id="exampleImage" alt="V6 实验结果" /></div><aside className="v6-metrics" id="exampleMetrics" aria-live="polite" /></div>
        </div></section>
        <section className="section" id="review"><div className="v6-shell">
          <SectionHead eyebrow="Local-only reviewer" title="审核你自己的 V6 输出">一次选择 `personalized_rstl.json`、中性脸图像和可选的 `wrinkle_mask.png`。文件只在当前浏览器中读取，不上传服务器。</SectionHead>
          <div className="review-grid">
            <aside className="control-panel">
              <label className="drop-zone" id="dropZone" htmlFor="fileInput"><strong>选择或拖入 V6 文件</strong><span>JSON + 中性脸图像 + 可选 wrinkle mask</span></label>
              <input id="fileInput" type="file" accept=".json,image/*" multiple hidden />
              <div className="control-group"><span className="control-title">显示图层</span>
                <ReviewToggle id="showPrior" color="#929aaa">初始 RSTL</ReviewToggle><ReviewToggle id="showFinal" color="#ff4fd8">个性化 RSTL</ReviewToggle><ReviewToggle id="showMask" color="#35e99b">皱纹 mask</ReviewToggle><ReviewToggle id="showArrows" color="#43d9ff">法向位移箭头</ReviewToggle>
              </div>
              <div className="control-group"><span className="control-title">背景不透明度</span><input id="backgroundOpacity" type="range" min="0" max="100" defaultValue="86" className="v6-full-width" /></div>
              <div id="reviewStatus" className="review-status">尚未加载 V6 结果。</div><div id="reviewMetrics" className="review-metrics" hidden />
              <button className="button v6-full-width v6-export-button" id="exportButton" type="button" disabled>导出当前对比 PNG</button>
              <p className="privacy">在线页用于结果展示与复核，不在浏览器内运行 YOLO。完整检测与微调仍由本地 V6 一键流程完成。</p>
            </aside>
            <div className="canvas-panel"><div className="canvas-head"><span id="canvasTitle">V6 微调前后叠加</span><span>灰 / 洋红 / 绿 / 青</span></div><div className="canvas-wrap"><canvas id="reviewCanvas" width="768" height="768" aria-label="V6 RSTL 审核画布" /></div></div>
          </div>
        </div></section>
        <section className="section"><div className="v6-shell"><SectionHead eyebrow="What changed in V6" title="证据组织升级，不放大位移" />
          <div className="method-grid"><article className="method-card"><b>区间级 P90</b><p>每条 RSTL 的每个受影响区间独立执行 0.007 × face width 限制，避免少数异常位移压缩其他区域。</p></article><article className="method-card"><b>归一化软连接</b><p>以 0.013 × face width 连接方向相容的短皱纹段；软连接只改善趋势估计，不增加直接证据。</p></article><article className="method-card"><b>曲线区间证据门槛</b><p>以真实弧长、覆盖率与平均置信度决定是否微调，直接点数仅作为辅助条件。</p></article></div>
        </div></section>
      </main>
      <footer className="v6-shell footer"><span>V6 experimental baseline · 仅用于研究与可视化审核</span><span>216 curves · topology preserved</span></footer>
    </div>
  );
}

function SectionHead({ eyebrow, title, children }: { eyebrow: string; title: string; children?: string }) {
  return <div className="section-head"><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2></div>{children ? <p className="section-copy">{children}</p> : null}</div>;
}

function ReviewToggle({ id, color, children }: { id: string; color: string; children: string }) {
  return <label className="check"><span><i className="swatch" style={{ background: color }} />{children}</span><input id={id} type="checkbox" defaultChecked /></label>;
}
