import { Link } from "react-router-dom";

import { useAnnotateStore } from "../stores/annotateStore";

const ANNOTATE_MESH_REACT_COMMAND_EVENT = "langerface:annotate-mesh-react-command";

function dispatchMeshCommand(command: string) {
  window.dispatchEvent(new CustomEvent(ANNOTATE_MESH_REACT_COMMAND_EVENT, { detail: { command } }));
}

export function AnnotateMeshSourcePanel() {
  const snapshot = useAnnotateStore((state) => state.snapshot);
  const meshActions = snapshot?.meshActions;
  const showFlame = meshActions?.canLoadFlame ?? true;
  const showFittedFlame = meshActions?.canLoadFittedFlame ?? true;

  return (
    <div className="card">
      <p className="hint" id="hint">{snapshot?.hint || "加载网格后开始标注。"}</p>
      <button className="btn btn-primary" id="btnLoadCanonical" type="button" onClick={() => dispatchMeshCommand("load_canonical")}>加载 FLAME 标准脸</button>
      <button className={`btn${showFlame ? "" : " hidden"}`} id="btnLoadFlame" type="button" onClick={() => dispatchMeshCommand("load_flame")}>加载 FLAME 头模</button>
      <button className={`btn${showFittedFlame ? "" : " hidden"}`} id="btnLoadFittedFlame" type="button" onClick={() => dispatchMeshCommand("load_fitted_flame")}>加载个体 FLAME（拟合）</button>
      <button className="btn btn-primary" id="btnCloudFit" type="button" onClick={() => dispatchMeshCommand("cloud_fit_flame")}>☁ 云端拟合 FLAME（演示）</button>
      <label className="btn" htmlFor="meshFile">上传头模（JSON / OBJ / PLY）</label>
      <input type="file" id="meshFile" accept="application/json,.json,.obj,.ply,model/obj,model/ply" hidden />
      <label className="field-label annotate-spacing-label" htmlFor="resampleSpacing">Slicer 曲线重采样间距</label>
      <input className="text-input" id="resampleSpacing" type="number" min="0.2" step="0.2" defaultValue="2" />
      <label className="btn" htmlFor="slicerFile">导入 Slicer 曲线（.mrk.json）</label>
      <input type="file" id="slicerFile" accept=".mrk.json,application/json,.json" hidden />
      <Link className="btn" to="/surgery">沿 RSTL 闭合演示</Link>
      <Link className="btn" to="/live">返回实时 Langer 线显示</Link>
    </div>
  );
}
