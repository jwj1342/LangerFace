import { Link } from "react-router-dom";

export function AnnotateWorkbench() {
  return (
    <div className="app annotate-workbench">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-top">
            <span className="eyebrow">3D LINE ANNOTATION</span>
            <a className="badge" href="/index.html">返回实时显示</a>
          </div>
          <h1>3D 网页标注</h1>
        </div>

        <div className="card">
          <p className="hint" id="hint">加载网格后开始标注。</p>
          <button className="btn btn-primary" id="btnLoadCanonical" type="button">加载 FLAME 标准脸</button>
          <button className="btn" id="btnLoadFlame" type="button">加载 FLAME 头模</button>
          <button className="btn" id="btnLoadFittedFlame" type="button">加载个体 FLAME（拟合）</button>
          <button className="btn btn-primary" id="btnCloudFit" type="button">☁ 云端拟合 FLAME（演示）</button>
          <label className="btn" htmlFor="meshFile">上传头模（JSON / OBJ / PLY）</label>
          <input type="file" id="meshFile" accept="application/json,.json,.obj,.ply,model/obj,model/ply" hidden />
          <label className="field-label annotate-spacing-label" htmlFor="resampleSpacing">Slicer 曲线重采样间距</label>
          <input className="text-input" id="resampleSpacing" type="number" min="0.2" step="0.2" defaultValue="2" />
          <label className="btn" htmlFor="slicerFile">导入 Slicer 曲线（.mrk.json）</label>
          <input type="file" id="slicerFile" accept=".mrk.json,application/json,.json" hidden />
          <Link className="btn" to="/surgery">沿 RSTL 闭合演示</Link>
          <a className="btn" href="/index.html">返回实时 Langer 线显示</a>
        </div>

        <div className="card">
          <div className="section-title">
            <span>1. 选择线系统</span>
            <span id="drawMode">FLAME 标准脸</span>
          </div>
          <div>
            <label className="field-label" htmlFor="annSystem">线系统</label>
            <select id="annSystem" className="select annotate-system-select" defaultValue="rstl">
              <option value="rstl">RSTL（首选）</option>
              <option value="langer">Langer</option>
            </select>
          </div>
          <div className="section-title">
            <span>2. 填写当前线</span>
            <span>可留空</span>
          </div>
          <input className="text-input" id="annName" placeholder="线名，例如 forehead_h1" />
          <input className="text-input" id="annRegion" placeholder="区域，例如 forehead / cheek / perioral" />
          <div className="current-state" id="currentState">当前没有正在绘制的线。</div>
          <div className="btn-row annotate-actions">
            <button className="btn btn-primary" id="btnNew" type="button">开始一条线</button>
            <button className="btn" id="btnUndo" type="button">撤销上一个点</button>
            <button className="btn" id="btnFinish" type="button">保存当前线</button>
          </div>
        </div>

        <div className="card">
          <div className="quality-top"><span>3. 已保存线</span><span id="annStatus">0 条</span></div>
          <div className="line-list" id="lineList" />
          <div className="btn-row annotate-export-row">
            <button className="btn" id="btnExportAtlas" type="button" disabled>导出图谱</button>
            <button className="btn" id="btnExportXyz" type="button" disabled>导出 xyz</button>
          </div>
          <button className="btn btn-primary" id="btnSetActiveAtlas" type="button" disabled>设为活动图谱并预览</button>
          <button className="btn" id="btnClear" type="button">清空</button>
        </div>

        <details className="card help-doc" open>
          <summary>标注帮助</summary>
          <ol>
            <li>先加载 FLAME 标准脸；如果标注自定义头模，只能导出 xyz 折线。</li>
            <li>选择 RSTL 或 Langer，填写线名和面部分区。</li>
            <li>点击“开始一条线”，然后在 3D 脸表面逐点点击。</li>
            <li>每条线至少 2 个点；点够后点击“保存当前线”。</li>
            <li>相邻控制点会沿网格表面连接，不会直接穿过头模；跨区域时可多点控制走向。</li>
            <li>继续填写下一条线并保存，直到完成该区域。</li>
            <li>在标准脸上标注后导出待复核图谱草案；通过临床评审后再进入项目资产。</li>
          </ol>
          <p>快捷键：Ctrl/⌘ + Z 撤销上一个点；如果当前没有正在画的线，会恢复上一条已保存线继续编辑。</p>
        </details>

        <p className="disclaimer">
          ⚠️ 标注用于生成待复核线图谱草案（决策辅助可视化），非手术指令、非医疗器械。
          在标准脸上标注可导出项目图谱格式（tri,u,v），但不会自动完成临床校验或置 validated:true。
        </p>
      </aside>

      <main className="stage">
        <div className="stage-top">
          <span className="live on"><span className="dot" />标注模式</span>
          <div className="stage-actions">
            <span className="fps">拖拽旋转 · 滚轮缩放 · 点击落点</span>
            <a className="stage-link" href="/index.html">返回实时显示</a>
          </div>
        </div>
        <div className="stage-body">
          <div className="main-wrap">
            <canvas id="stage" />
          </div>
        </div>
      </main>
    </div>
  );
}
