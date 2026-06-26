import { Link } from "react-router-dom";

import { dispatchAnnotateMeshCommand } from "../lib/controllerCommand";
import { useAnnotateStore } from "../stores/annotateStore";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function AnnotateMeshSourcePanel() {
  const snapshot = useAnnotateStore((state) => state.snapshot);
  const meshActions = snapshot?.meshActions;
  const showFlame = meshActions?.canLoadFlame ?? true;
  const showFittedFlame = meshActions?.canLoadFittedFlame ?? true;

  return (
    <Card>
      <p className="hint" id="hint">{snapshot?.hint || "加载网格后开始标注。"}</p>
      <Button variant="workbenchPrimary" id="btnLoadCanonical" type="button" onClick={() => dispatchAnnotateMeshCommand("load_canonical")}>加载 FLAME 标准脸</Button>
      <Button variant="workbench" className={showFlame ? "" : "hidden"} id="btnLoadFlame" type="button" onClick={() => dispatchAnnotateMeshCommand("load_flame")}>加载 FLAME 头模</Button>
      <Button variant="workbench" className={showFittedFlame ? "" : "hidden"} id="btnLoadFittedFlame" type="button" onClick={() => dispatchAnnotateMeshCommand("load_fitted_flame")}>加载个体 FLAME（拟合）</Button>
      <Button variant="workbenchPrimary" id="btnCloudFit" type="button" onClick={() => dispatchAnnotateMeshCommand("cloud_fit_flame")}>☁ 云端拟合 FLAME（演示）</Button>
      <Button asChild variant="workbench">
        <label htmlFor="meshFile">上传头模（JSON / OBJ / PLY）</label>
      </Button>
      <Input type="file" id="meshFile" accept="application/json,.json,.obj,.ply,model/obj,model/ply" hidden />
      <Label className="annotate-spacing-label" htmlFor="resampleSpacing">Slicer 曲线重采样间距</Label>
      <Input id="resampleSpacing" type="number" min="0.2" step="0.2" defaultValue="2" />
      <Button asChild variant="workbench">
        <label htmlFor="slicerFile">导入 Slicer 曲线（.mrk.json）</label>
      </Button>
      <Input type="file" id="slicerFile" accept=".mrk.json,application/json,.json" hidden />
      <Button asChild variant="workbench">
        <Link to="/surgery">沿 RSTL 闭合演示</Link>
      </Button>
      <Button asChild variant="workbench">
        <Link to="/live">返回实时 Langer 线显示</Link>
      </Button>
    </Card>
  );
}
