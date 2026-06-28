import { Link } from "react-router-dom";

import { AnnotateDrawPanel } from "../components/AnnotateDrawPanel";
import { AnnotateHelpPanel } from "../components/AnnotateHelpPanel";
import { AnnotateLineLibraryPanel } from "../components/AnnotateLineLibraryPanel";
import { AnnotateMeshSourcePanel } from "../components/AnnotateMeshSourcePanel";
import { AnnotateStagePanel } from "../components/AnnotateStagePanel";
import { AnnotateStatePanel } from "../components/AnnotateStatePanel";
import { Disclaimer, WorkbenchLayout } from "../components/WorkbenchLayout";
import { WorkbenchBrand } from "../components/WorkbenchBrand";
import { StatusBadge } from "../components/ui/status-badge";

export function AnnotateWorkbench() {
  return (
    <WorkbenchLayout
      stage={<AnnotateStagePanel />}
      workspace="annotate"
    >
      <WorkbenchBrand
        eyebrow="图谱库管理"
        title="3D 张力线图谱标注"
        action={<StatusBadge asChild><Link to="/cases">返回病例大厅</Link></StatusBadge>}
      />

      <AnnotateMeshSourcePanel />

      <AnnotateDrawPanel />

      <AnnotateStatePanel />

      <AnnotateLineLibraryPanel />

      <AnnotateHelpPanel />

      <Disclaimer>
        标注用于生成待复核线图谱草案（决策辅助可视化），非手术指令、非医疗器械。
        在标准脸上标注可导出项目图谱格式（tri,u,v），但不会自动完成临床校验或置 validated:true。
      </Disclaimer>
    </WorkbenchLayout>
  );
}
