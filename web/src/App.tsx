import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { Card, CardHeader } from "./components/ui/card";
import { Hint } from "./components/ui/hint";
import { DashboardRoute } from "./routes/DashboardRoute";

const AnnotateRoute = lazy(() => import("./routes/AnnotateRoute").then((module) => ({ default: module.AnnotateRoute })));
const IncisionRoute = lazy(() => import("./routes/IncisionRoute").then((module) => ({ default: module.IncisionRoute })));
const LiveRoute = lazy(() => import("./routes/LiveRoute").then((module) => ({ default: module.LiveRoute })));
const SurgeryRoute = lazy(() => import("./routes/SurgeryRoute").then((module) => ({ default: module.SurgeryRoute })));
const ThreePreviewRoute = lazy(() => import("./routes/ThreePreviewRoute").then((module) => ({ default: module.ThreePreviewRoute })));

function RouteFallback() {
  return (
    <div className="react-page grid place-items-center p-6">
      <Card className="max-w-[420px]">
        <CardHeader><span>正在加载</span><span>route</span></CardHeader>
        <Hint>正在加载当前工作台模块。</Hint>
      </Card>
    </div>
  );
}

export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<DashboardRoute />} />
        <Route path="/annotate" element={<AnnotateRoute />} />
        <Route path="/incision" element={<IncisionRoute />} />
        <Route path="/live" element={<LiveRoute />} />
        <Route path="/surgery" element={<SurgeryRoute />} />
        <Route path="/three-preview" element={<ThreePreviewRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
