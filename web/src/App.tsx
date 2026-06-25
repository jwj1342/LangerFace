import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { DashboardRoute } from "./routes/DashboardRoute";

const IncisionRoute = lazy(() => import("./routes/IncisionRoute").then((module) => ({ default: module.IncisionRoute })));
const SurgeryRoute = lazy(() => import("./routes/SurgeryRoute").then((module) => ({ default: module.SurgeryRoute })));
const ThreePreviewRoute = lazy(() => import("./routes/ThreePreviewRoute").then((module) => ({ default: module.ThreePreviewRoute })));

function RouteFallback() {
  return (
    <div className="react-page grid place-items-center p-6">
      <div className="card max-w-[420px]">
        <div className="quality-top"><span>正在加载</span><span>route</span></div>
        <p className="hint">正在加载当前工作台模块。</p>
      </div>
    </div>
  );
}

export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<DashboardRoute />} />
        <Route path="/incision" element={<IncisionRoute />} />
        <Route path="/surgery" element={<SurgeryRoute />} />
        <Route path="/three-preview" element={<ThreePreviewRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
