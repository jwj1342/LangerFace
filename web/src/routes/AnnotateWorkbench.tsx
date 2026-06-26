import { Link } from "react-router-dom";

import { AnnotateDrawPanel } from "../components/AnnotateDrawPanel";
import { AnnotateHelpPanel } from "../components/AnnotateHelpPanel";
import { AnnotateLineLibraryPanel } from "../components/AnnotateLineLibraryPanel";
import { AnnotateMeshSourcePanel } from "../components/AnnotateMeshSourcePanel";
import { AnnotateStagePanel } from "../components/AnnotateStagePanel";
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

        <AnnotateHelpPanel />

        <p className="disclaimer">
          ⚠️ 标注用于生成待复核线图谱草案（决策辅助可视化），非手术指令、非医疗器械。
          在标准脸上标注可导出项目图谱格式（tri,u,v），但不会自动完成临床校验或置 validated:true。
        </p>
      </aside>

      <AnnotateStagePanel />
    </div>
  );
}
