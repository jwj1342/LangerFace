import { Link } from "react-router-dom";

import { AnnotateDrawPanel } from "../components/AnnotateDrawPanel";
import { AnnotateLineLibraryPanel } from "../components/AnnotateLineLibraryPanel";
import { AnnotateMeshSourcePanel } from "../components/AnnotateMeshSourcePanel";
import { AnnotateStatePanel } from "../components/AnnotateStatePanel";

export function AnnotateWorkbench() {
  return (
    <div className="app annotate-workbench">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-top">
            <span className="eyebrow">3D LINE ANNOTATION</span>
            <Link className="badge" to="/live">返回实时显示</Link>
          </div>
          <h1>3D 网页标注</h1>
        </div>

        <AnnotateMeshSourcePanel />

        <AnnotateDrawPanel />

        <AnnotateStatePanel />

        <AnnotateLineLibraryPanel />

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
            <Link className="stage-link" to="/live">返回实时显示</Link>
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
