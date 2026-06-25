import { Link } from "react-router-dom";

export function SurgeryWorkbench() {
  return (
    <div className="app surgery-workbench">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-top">
            <span className="eyebrow">RSTL · CLOSURE DEMO</span>
            <Link className="badge" to="/annotate">返回 3D 标注</Link>
          </div>
          <h1>沿 RSTL 闭合演示</h1>
        </div>

        <div className="card">
          <p className="hint" id="hint">加载中...</p>
          <div className="section-title"><span>① 规划切口</span><span id="lesionState">默认在脸颊</span></div>
          <p className="hint">
            在右侧脸上<b>点击</b>定位病灶；拖拽旋转、滚轮缩放。
            右图 <b className="surgery-green-copy">绿色</b>=沿 RSTL 的梭形切除轮廓，随下方滑块更新。
          </p>
          <label className="field-label" htmlFor="sizeRange">切口大小 <span id="sizeVal">110%</span></label>
          <input id="sizeRange" type="range" min="80" max="200" defaultValue="110" />
          <div className="section-title"><span>② 执行切除并闭合</span></div>
          <div className="btn-row surgery-action-row">
            <button className="btn cut-along" id="btnAlong" type="button">沿 RSTL 切除</button>
          </div>
          <button className="btn" id="btnReset" type="button">↺ 复位</button>
          <label className="btn">
            <input type="checkbox" id="showLines" defaultChecked /> 显示 RSTL 张力线
          </label>
        </div>

        <div className="card">
          <div className="quality-top"><span>闭合新增张力</span><span><b id="tensionVal">—</b> / 100</span></div>
          <div className="bar"><div className="bar-fill surgery-tension-bar" id="tensionBar" /></div>
          <div className="legend">
            <span className="legend-sw surgery-legend-skin" />无新增（平和）
            <span className="legend-sw surgery-legend-red" />闭合新增张力升高
          </div>
          <p className="hint" id="verdict">点击沿 RSTL 切除后，观察闭合区域新增张力如何局部集中。</p>
        </div>

        <details className="card help-doc" open>
          <summary>这是在演示什么？</summary>
          <ol>
            <li>右侧是标准脸（MediaPipe 标准头），青色是医生标注的 <b>RSTL 皮肤张力线</b>。</li>
            <li>标一个肿物 → 做一个梭形切除（把那块组织去掉）。</li>
            <li>周围皮肤被<b>预张力</b>拉着把伤口合上，并有轻微回弹。</li>
            <li>颜色 = 闭合<b>新增</b>的张力（已扣除皮肤静息张力）：远处保持肤色，只有伤口处会变。</li>
            <li><b>沿 RSTL 切</b>：演示闭合时伤口周围新增张力如何局部变化。</li>
            <li>该页面只提供力学直觉辅助，不和切口 Agent 的候选生成混用。</li>
          </ol>
        </details>

        <p className="disclaimer">
          ⚠️ 表面质点-弹簧软体的<b>定性</b>模型，非有限元、非患者个体化建模，<b>不是手术指令、非医疗器械</b>。
          真实软组织力学需体网格 FEM + 影像，本工具只为直观呈现 RSTL 与闭合张力的关系。
        </p>
      </aside>

      <main className="stage">
        <div className="stage-top">
          <span className="live on"><span className="dot" />沿 RSTL 闭合演示</span>
          <div className="stage-actions">
            <span className="fps">拖拽旋转 · 滚轮缩放 · 点击标记肿物</span>
            <Link className="stage-link" to="/annotate">返回 3D 标注</Link>
          </div>
        </div>
        <div className="stage-body">
          <div className="main-wrap">
            <canvas id="surgeryCanvas" />
          </div>
        </div>
      </main>
    </div>
  );
}
