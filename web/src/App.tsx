import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { ReactPage } from "./components/ReactShell";
import { Card, CardHeader } from "./components/ui/card";
import { Hint } from "./components/ui/hint";
import { DashboardRoute } from "./routes/DashboardRoute";

const AnnotateRoute = lazy(() => import("./routes/AnnotateRoute").then((module) => ({ default: module.AnnotateRoute })));
const IncisionRoute = lazy(() => import("./routes/IncisionRoute").then((module) => ({ default: module.IncisionRoute })));
const LiveRoute = lazy(() => import("./routes/LiveRoute").then((module) => ({ default: module.LiveRoute })));
const PersonalizedRoute = lazy(() => import("./routes/PersonalizedRoute").then((module) => ({ default: module.PersonalizedRoute })));
const SettingsRoute = lazy(() => import("./routes/SettingsRoute").then((module) => ({ default: module.SettingsRoute })));
const SurgeryRoute = lazy(() => import("./routes/SurgeryRoute").then((module) => ({ default: module.SurgeryRoute })));
const V6ReviewRoute = lazy(() => import("./routes/V6ReviewRoute").then((module) => ({ default: module.V6ReviewRoute })));

function RouteFallback() {
  return (
    <ReactPage className="grid place-items-center p-6">
      <Card className="max-w-[420px]">
        <CardHeader><span>正在加载</span><span>route</span></CardHeader>
        <Hint>正在加载当前工作台模块。</Hint>
      </Card>
    </ReactPage>
  );
}

export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<DashboardRoute />} />
        <Route path="/app" element={<DashboardRoute />} />
        <Route path="/settings/atlas" element={<SettingsRoute section="atlas" />} />
        <Route path="/settings/developer" element={<SettingsRoute section="developer" />} />
        <Route path="/annotate" element={<AnnotateRoute />} />
        <Route path="/incision" element={<IncisionRoute />} />
        <Route path="/live" element={<LiveRoute />} />
        <Route path="/personalized" element={<PersonalizedRoute />} />
        <Route path="/surgery" element={<SurgeryRoute />} />
        <Route path="/v6-review" element={<V6ReviewRoute />} />
        <Route path="/current/*" element={<Navigate to="/live" replace />} />
        <Route path="/app/settings/atlas" element={<SettingsRoute section="atlas" />} />
        <Route path="/app/settings/developer" element={<SettingsRoute section="developer" />} />
        <Route path="/app/annotate" element={<AnnotateRoute />} />
        <Route path="/app/incision" element={<IncisionRoute />} />
        <Route path="/app/live" element={<LiveRoute />} />
        <Route path="/app/personalized" element={<PersonalizedRoute />} />
        <Route path="/app/surgery" element={<SurgeryRoute />} />
        <Route path="/app/v6-review" element={<V6ReviewRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
