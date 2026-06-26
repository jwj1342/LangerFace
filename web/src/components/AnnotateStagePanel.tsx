import { Link } from "react-router-dom";

export function AnnotateStagePanel() {
  return (
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
  );
}
