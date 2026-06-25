import { Html, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import * as THREE from "three";

import { loadJsonAsset } from "../../assets.js";
import { buildLineGeometry, vertexNormals } from "../../three3d.js";
import { Button } from "../components/ui/button.jsx";
import { useAppStore } from "../stores/appStore.js";

function bbox(verts) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], v[k]);
      hi[k] = Math.max(hi[k], v[k]);
    }
  }
  return { lo, hi, center: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2] };
}

function FaceMesh({ assets }) {
  const { verts, tris, atlas } = assets;
  const box = useMemo(() => bbox(verts), [verts]);
  const meshGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(verts.flat(), 3));
    geometry.setIndex(tris.flat());
    geometry.computeVertexNormals();
    return geometry;
  }, [verts, tris]);
  const lineGeometry = useMemo(() => {
    const normals = vertexNormals(verts, tris);
    return buildLineGeometry(atlas.lines.filter((_, index) => index % 2 === 0), verts, tris, normals, false);
  }, [atlas, verts, tris]);

  return (
    <group position={[-box.center[0], -box.center[1], -box.center[2]]}>
      <mesh geometry={meshGeometry}>
        <meshStandardMaterial color="#d8a98f" roughness={0.68} metalness={0.02} />
      </mesh>
      <lineSegments geometry={lineGeometry} renderOrder={2}>
        <lineBasicMaterial vertexColors toneMapped={false} />
      </lineSegments>
    </group>
  );
}

function R3FScene({ assets, loadingText }) {
  return (
    <Canvas camera={{ position: [0, 0, 2.8], fov: 35 }} dpr={[1, 2]}>
      <color attach="background" args={["#111820"]} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[2.5, 2.8, 3.5]} intensity={1.8} />
      <directionalLight position={[-2, 1, 2]} intensity={0.7} />
      <gridHelper args={[2, 12, "#334155", "#243041"]} position={[0, -0.72, 0]} />
      {assets ? (
        <FaceMesh assets={assets} />
      ) : (
        <Html center>
          <div className="rounded-[10px] border border-white/10 bg-black/60 px-4 py-3 text-center text-sm font-bold text-[#dbe4ee]">
            {loadingText}
          </div>
        </Html>
      )}
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
    </Canvas>
  );
}

export function ThreePreviewRoute() {
  const [assets, setAssets] = useState(null);
  const [loadingText, setLoadingText] = useState("正在加载标准脸资产");
  const setActiveWorkspace = useAppStore((state) => state.setActiveWorkspace);
  const setRouteStatus = useAppStore((state) => state.setRouteStatus);
  const setAssetStatus = useAppStore((state) => state.setAssetStatus);

  useEffect(() => {
    let disposed = false;
    setActiveWorkspace("three-preview");
    setRouteStatus("R3F 预览加载中");

    Promise.all([
      loadJsonAsset("canonicalVertices", { label: "标准脸顶点", onProgress: (evt) => setLoadingText(`${evt.label} 加载中`) }),
      loadJsonAsset("triangles", { label: "三角拓扑", onProgress: (evt) => setLoadingText(`${evt.label} 加载中`) }),
      loadJsonAsset("atlasRstl", { label: "RSTL 图谱", onProgress: (evt) => setLoadingText(`${evt.label} 加载中`) }),
    ]).then(([verts, tris, atlas]) => {
      if (disposed) return;
      setAssets({ verts, tris, atlas });
      setAssetStatus("R3F 标准脸资产已加载");
      setRouteStatus("R3F 预览已就绪");
    }).catch((err) => {
      setLoadingText(`资产加载失败：${err.message}`);
      setRouteStatus("R3F 预览加载失败");
      console.error(err);
    });

    return () => {
      disposed = true;
      setRouteStatus("R3F 预览已卸载");
    };
  }, [setActiveWorkspace, setAssetStatus, setRouteStatus]);

  return (
    <div className="react-page">
      <div className="react-shell">
        <aside className="react-shell-sidebar">
          <div className="brand">
            <div className="brand-top">
              <span className="eyebrow">R3F RENDERER BOUNDARY</span>
              <span className="react-route-status">{assets ? "ready" : "loading"}</span>
            </div>
            <h1>R3F 标准脸预览</h1>
          </div>

          <div className="card">
            <p className="hint">
              这里验证 React Three Fiber / drei 的渲染层接入。当前只承载低频资产加载和相机控制；
              切口工作台的高频拾取与候选线编辑仍由独立 Three.js controller 管理。
            </p>
            <Button asChild>
              <Link to="/"><ArrowLeft size={16} /> 返回 React 入口</Link>
            </Button>
            <Button type="button" onClick={() => window.location.reload()}>
              <RotateCcw size={16} /> 重新加载资产
            </Button>
          </div>
        </aside>
        <main className="react-shell-main">
          <R3FScene assets={assets} loadingText={loadingText} />
        </main>
      </div>
    </div>
  );
}
