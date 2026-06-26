import { Html, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";

import { buildLineGeometry, vertexNormals } from "../../three3d.js";

export type PreviewVec3 = [number, number, number];
export type PreviewTriangle = [number, number, number];

interface PreviewAtlasLine {
  points?: Array<[number, number, number]>;
  points3d?: PreviewVec3[];
}

export interface PreviewRstlAtlas {
  lines: PreviewAtlasLine[];
}

export interface ThreePreviewAssets {
  verts: PreviewVec3[];
  tris: PreviewTriangle[];
  atlas: PreviewRstlAtlas;
}

function bbox(verts: PreviewVec3[]) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], v[k]);
      hi[k] = Math.max(hi[k], v[k]);
    }
  }
  return { center: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2] };
}

function FaceMesh({ assets }: { assets: ThreePreviewAssets }) {
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

export function ThreePreviewScene({ assets, loadingText }: { assets: ThreePreviewAssets | null; loadingText: string }) {
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
