import { OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { R3FLoadingCard } from "../components/ui/r3f-loading-card";
import { buildLineGeometry, vertexNormals } from "../services/three3d.ts";
import type { RstlAtlas, RstlAtlasLine } from "../services/rstlField";
import { rstlDirField } from "../services/rstlField";
import type { SoftBody, Triangle, Vec3 } from "../services/softBody";
import { boundaryVerts, buildSoftBody, excise, stepSoftBody, vertexTension } from "../services/softBody";

export interface SurgeryAssets {
  verts: Vec3[];
  tris: Triangle[];
  atlas: RstlAtlas;
}

export interface SurgeryCommand {
  serial: number;
  type: "exciseAlong" | "reset";
}

export type SurgeryVerdictTone = "neutral" | "ok" | "warn";

interface SurgeryR3FSceneProps {
  assets: SurgeryAssets | null;
  command: SurgeryCommand | null;
  loadingText: string;
  showLines: boolean;
  sizePct: number;
  onActiveCutChange: (activeCut: "along" | null) => void;
  onHintChange: (hint: string) => void;
  onLesionStateChange: (state: string) => void;
  onTensionChange: (score: number | null) => void;
  onVerdictChange: (verdict: string, tone?: SurgeryVerdictTone) => void;
}

interface DerivedSurgeryAssets extends SurgeryAssets {
  atlasSub: { lines: RstlAtlasLine[] };
  anchored: Uint8Array;
  dir: Vec3[];
  meanEdge: number;
  normalsRest: Vec3[];
  box: {
    lo: Vec3;
    hi: Vec3;
    center: Vec3;
    size: number;
  };
}

interface RuntimeState {
  baseline: Float64Array | null;
  colors: Vec3[];
  lastScar: number;
  sb: SoftBody | null;
  settled: boolean;
  shortAxis: Vec3 | null;
  simActive: boolean;
  simFrames: number;
}

interface SurfaceState {
  epoch: number;
  faces: Triangle[];
}

interface WoundBedState {
  position: Vec3;
  quaternion: [number, number, number, number];
  scale: number;
}

const EXC_LO = 0.03;
const EXC_HI = 0.13;
const RELEASE = 1.6;
const FUSIFORM = 0.5;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (v: Vec3): Vec3 => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

function neutralColors(count: number): Vec3[] {
  return Array.from({ length: count }, () => [1, 1, 1] as Vec3);
}

function cloneVerts(verts: Vec3[]): Vec3[] {
  return verts.map((v) => [v[0], v[1], v[2]]);
}

function flatVecs(points: Vec3[]) {
  const out = new Float32Array(points.length * 3);
  for (let i = 0; i < points.length; i++) {
    out[i * 3] = points[i][0];
    out[i * 3 + 1] = points[i][1];
    out[i * 3 + 2] = points[i][2];
  }
  return out;
}

function bbox(verts: Vec3[]) {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], v[k]);
      hi[k] = Math.max(hi[k], v[k]);
    }
  }
  const center: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  return {
    lo,
    hi,
    center,
    size: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]),
  };
}

function deriveAssets(assets: SurgeryAssets): DerivedSurgeryAssets {
  const dir = rstlDirField(assets.verts, assets.tris, assets.atlas);
  const anchored = boundaryVerts(assets.tris, assets.verts.length);
  const normalsRest = vertexNormals(assets.verts, assets.tris);
  let edgeSum = 0;
  let edgeCount = 0;
  for (const [a, b, c] of assets.tris) {
    for (const [p, q] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
      edgeSum += len(sub(assets.verts[p], assets.verts[q]));
      edgeCount++;
    }
  }
  return {
    ...assets,
    atlasSub: { lines: (assets.atlas.lines || []).filter((_, index) => index % 2 === 0) },
    anchored,
    dir,
    meanEdge: edgeCount ? edgeSum / edgeCount : 0.01,
    normalsRest,
    box: bbox(assets.verts),
  };
}

function defaultLesionIndex(assets: DerivedSurgeryAssets) {
  const { lo, hi, center } = assets.box;
  const target: Vec3 = [center[0] + 0.42 * (hi[0] - lo[0]), center[1], hi[2]];
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < assets.verts.length; i++) {
    if (assets.anchored[i]) continue;
    const dist = len(sub(assets.verts[i], target));
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

function lesionSizes(meanEdge: number, sizePct: number) {
  const la = meanEdge * (sizePct / 100) * 1.6;
  return { la, lb: la * FUSIFORM };
}

function tangentFrame(normal: Vec3, longAxis: Vec3) {
  const v = norm(cross(normal, longAxis));
  return { u: norm(cross(v, normal)), v };
}

function ellipseGeometry(center: Vec3, normal: Vec3, longAxis: Vec3, la: number, lb: number, meanEdge: number) {
  const geometry = new THREE.BufferGeometry();
  const { u, v } = tangentFrame(normal, longAxis);
  const lift = meanEdge * 0.12;
  const pointCount = 56;
  const positions: number[] = [];
  for (let k = 0; k <= pointCount; k++) {
    const t = (k / pointCount) * Math.PI * 2;
    const ca = Math.cos(t);
    const sa = Math.sin(t);
    positions.push(
      center[0] + la * ca * u[0] + lb * sa * v[0] + normal[0] * lift,
      center[1] + la * ca * u[1] + lb * sa * v[1] + normal[1] * lift,
      center[2] + la * ca * u[2] + lb * sa * v[2] + normal[2] * lift,
    );
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function tensionColor(tension: number): Vec3 {
  const f = Math.max(0, Math.min(1, (tension - EXC_LO) / (EXC_HI - EXC_LO)));
  return [1 + 0.6 * f, 1 - 0.85 * f, 1 - 0.88 * f];
}

function createRuntime(vertexCount: number): RuntimeState {
  return {
    baseline: null,
    colors: neutralColors(vertexCount),
    lastScar: 0,
    sb: null,
    settled: false,
    shortAxis: null,
    simActive: false,
    simFrames: 0,
  };
}

function aliveFaces(tris: Triangle[], sb: SoftBody | null) {
  if (!sb) return tris;
  return tris.filter(([a, b, c]) => !sb.removed[a] && !sb.removed[b] && !sb.removed[c]);
}

function buildWoundBed(center: Vec3, normal: Vec3, meanEdge: number, la: number): WoundBedState {
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(normal[0], normal[1], normal[2]),
  );
  return {
    position: [
      center[0] - normal[0] * meanEdge * 0.7,
      center[1] - normal[1] * meanEdge * 0.7,
      center[2] - normal[2] * meanEdge * 0.7,
    ],
    quaternion: [q.x, q.y, q.z, q.w],
    scale: la * 1.15,
  };
}

function SurgeryCamera({ distance }: { distance: number }) {
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.near = 0.01;
      camera.far = Math.max(100, distance * 10);
      camera.updateProjectionMatrix();
    }
  }, [camera, distance]);

  return null;
}

function LoadingScene({ loadingText }: { loadingText: string }) {
  return (
    <>
      <color attach="background" args={["#111820"]} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[2.5, 2.8, 3.5]} intensity={1.8} />
      <gridHelper args={[2, 12, "#334155", "#243041"]} position={[0, -0.72, 0]} />
      <R3FLoadingCard>{loadingText}</R3FLoadingCard>
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
    </>
  );
}

function SurgerySceneContent({
  assets,
  command,
  showLines,
  sizePct,
  onActiveCutChange,
  onHintChange,
  onLesionStateChange,
  onTensionChange,
  onVerdictChange,
}: Omit<SurgeryR3FSceneProps, "assets" | "loadingText"> & { assets: SurgeryAssets }) {
  const derived = useMemo(() => deriveAssets(assets), [assets]);
  const [hasExcision, setHasExcision] = useState(false);
  const [lesionIndex, setLesionIndex] = useState(() => defaultLesionIndex(derived));
  const [surfaceState, setSurfaceState] = useState<SurfaceState>({ epoch: 0, faces: derived.tris });
  const [woundBed, setWoundBed] = useState<WoundBedState | null>(null);
  const groupOffset = useMemo<Vec3>(() => [-derived.box.center[0], -derived.box.center[1], -derived.box.center[2]], [derived]);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const lineRef = useRef<THREE.LineSegments | null>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const derivedRef = useRef(derived);
  const lesionIndexRef = useRef(lesionIndex);
  const runtimeRef = useRef<RuntimeState>(createRuntime(derived.verts.length));
  const showLinesRef = useRef(showLines);
  const sizePctRef = useRef(sizePct);

  const refreshLineGeometry = useCallback(() => {
    const d = derivedRef.current;
    const line = lineRef.current;
    if (!line) return;
    line.visible = showLinesRef.current;
    if (!showLinesRef.current) return;
    const runtime = runtimeRef.current;
    const positions = runtime.sb ? runtime.sb.pos : d.verts;
    const normals = runtime.sb ? vertexNormals(positions, d.tris) : d.normalsRest;
    const next = buildLineGeometry(d.atlasSub.lines, positions, d.tris, normals, false);
    const old = line.geometry;
    line.geometry = next;
    old.dispose();
  }, []);

  const updateMeshAttributes = useCallback((positions: Vec3[], colors: Vec3[]) => {
    const geometry = geometryRef.current;
    if (!geometry) return;
    const positionAttr = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    const colorAttr = geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
    if (!positionAttr) return;
    const positionArray = positionAttr.array as Float32Array;
    for (let i = 0; i < positions.length && i * 3 + 2 < positionArray.length; i++) {
      positionArray[i * 3] = positions[i][0];
      positionArray[i * 3 + 1] = positions[i][1];
      positionArray[i * 3 + 2] = positions[i][2];
    }
    positionAttr.needsUpdate = true;
    if (colorAttr) {
      const colorArray = colorAttr.array as Float32Array;
      for (let i = 0; i < colors.length && i * 3 + 2 < colorArray.length; i++) {
        colorArray[i * 3] = colors[i][0];
        colorArray[i * 3 + 1] = colors[i][1];
        colorArray[i * 3 + 2] = colors[i][2];
      }
      colorAttr.needsUpdate = true;
    }
    geometry.computeVertexNormals();
  }, []);

  const updateTensionAndColors = useCallback(() => {
    const d = derivedRef.current;
    const runtime = runtimeRef.current;
    if (!runtime.sb || !runtime.shortAxis) return runtime.lastScar;
    const tens = vertexTension(runtime.sb, runtime.shortAxis);
    const { la } = lesionSizes(d.meanEdge, sizePctRef.current);
    const rel = la * RELEASE;
    const wound: number[] = [];
    const center = d.verts[lesionIndexRef.current];
    for (let i = 0; i < d.verts.length; i++) {
      if (runtime.sb.removed[i]) {
        runtime.colors[i] = [0.2, 0.2, 0.22];
        continue;
      }
      const dist = len(sub(d.verts[i], center));
      const mask = Math.max(0, Math.min(1, (rel * 1.9 - dist) / (rel * 0.6)));
      const excess = Math.max(0, tens[i] - (runtime.baseline ? runtime.baseline[i] : 0)) * mask;
      runtime.colors[i] = tensionColor(excess);
      if (!d.anchored[i] && dist < rel * 1.3) wound.push(excess);
    }
    wound.sort((a, b) => b - a);
    const top = wound.slice(0, 3);
    const peak = top.length ? top.reduce((sum, x) => sum + x, 0) / top.length : 0;
    runtime.lastScar = Math.max(0, Math.min(100, ((peak - EXC_LO) / (EXC_HI - EXC_LO)) * 100));
    return runtime.lastScar;
  }, []);

  const selectLesion = useCallback((index: number, label = `顶点 #${index}`) => {
    lesionIndexRef.current = index;
    setLesionIndex(index);
    onLesionStateChange(label);
  }, [onLesionStateChange]);

  const resetScene = useCallback(() => {
    const d = derivedRef.current;
    runtimeRef.current = createRuntime(d.verts.length);
    setHasExcision(false);
    setWoundBed(null);
    setSurfaceState((current) => ({ epoch: current.epoch + 1, faces: d.tris }));
    onActiveCutChange(null);
    onHintChange("已复位：可重新标记肿物并观察沿 RSTL 闭合。");
    onTensionChange(null);
    onVerdictChange("点击沿 RSTL 切除后，观察闭合区域新增张力如何局部集中。", "neutral");
  }, [onActiveCutChange, onHintChange, onTensionChange, onVerdictChange]);

  const exciseAlong = useCallback(() => {
    const d = derivedRef.current;
    const runtime = runtimeRef.current;
    if (runtime.sb) {
      onHintChange("请先复位，再选择新的落点或重新切除。");
      return;
    }
    const lesion = lesionIndexRef.current;
    const longAxis = norm(d.dir[lesion]);
    const shortAxis = norm(cross(d.normalsRest[lesion], longAxis));
    const sb = buildSoftBody(d.verts, d.tris, d.dir, { anchored: d.anchored });
    const { la, lb } = lesionSizes(d.meanEdge, sizePctRef.current);
    const removed = excise(sb, d.verts, d.verts[lesion], longAxis, la, lb, la * RELEASE);
    runtime.sb = sb;
    runtime.baseline = vertexTension(sb, shortAxis);
    runtime.colors = neutralColors(d.verts.length);
    runtime.shortAxis = shortAxis;
    runtime.simActive = true;
    runtime.simFrames = 0;
    runtime.settled = false;
    runtime.lastScar = 0;
    setHasExcision(true);
    setWoundBed(buildWoundBed(d.verts[lesion], d.normalsRest[lesion], d.meanEdge, la));
    setSurfaceState((current) => ({ epoch: current.epoch + 1, faces: aliveFaces(d.tris, sb) }));
    onActiveCutChange("along");
    onHintChange(`沿 RSTL 切除 ${removed} 个顶点，正在闭合。`);
    onTensionChange(null);
    onVerdictChange("软体沉降中：颜色显示闭合新增张力的局部集中。", "neutral");
  }, [onActiveCutChange, onHintChange, onTensionChange, onVerdictChange]);

  const handleMeshClick = useCallback((event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const d = derivedRef.current;
    const runtime = runtimeRef.current;
    if (runtime.sb || !event.face || !meshRef.current || event.delta > 6) return;
    const local = meshRef.current.worldToLocal(event.point.clone());
    const point: Vec3 = [local.x, local.y, local.z];
    let best = event.face.a;
    let bestDist = Infinity;
    for (const vi of [event.face.a, event.face.b, event.face.c]) {
      if (d.anchored[vi]) continue;
      const dist = len(sub(d.verts[vi], point));
      if (dist < bestDist) {
        best = vi;
        bestDist = dist;
      }
    }
    selectLesion(best);
    onHintChange("已更新肿物落点：可调整切口大小后执行沿 RSTL 切除。");
  }, [onHintChange, selectLesion]);

  useEffect(() => {
    derivedRef.current = derived;
    runtimeRef.current = createRuntime(derived.verts.length);
    const defaultIndex = defaultLesionIndex(derived);
    lesionIndexRef.current = defaultIndex;
    setLesionIndex(defaultIndex);
    setHasExcision(false);
    setWoundBed(null);
    setSurfaceState((current) => ({ epoch: current.epoch + 1, faces: derived.tris }));
    onActiveCutChange(null);
    onHintChange("已就绪：在脸上点击标记肿物，再执行沿 RSTL 切除。");
    onLesionStateChange("默认在脸颊");
    onTensionChange(null);
    onVerdictChange("点击沿 RSTL 切除后，观察闭合区域新增张力如何局部集中。", "neutral");
  }, [derived, onActiveCutChange, onHintChange, onLesionStateChange, onTensionChange, onVerdictChange]);

  useEffect(() => {
    showLinesRef.current = showLines;
    if (lineRef.current) lineRef.current.visible = showLines;
    if (showLines) refreshLineGeometry();
  }, [refreshLineGeometry, showLines]);

  useEffect(() => {
    sizePctRef.current = sizePct;
  }, [sizePct]);

  useEffect(() => {
    refreshLineGeometry();
  }, [refreshLineGeometry, surfaceState.epoch]);

  useEffect(() => {
    if (!command) return;
    if (command.type === "exciseAlong") exciseAlong();
    else resetScene();
  }, [command, exciseAlong, resetScene]);

  const surfaceGeometry = useMemo(() => {
    const runtime = runtimeRef.current;
    const geometry = new THREE.BufferGeometry();
    const positions = runtime.sb ? runtime.sb.pos : cloneVerts(derived.verts);
    const colors = runtime.colors.length === derived.verts.length ? runtime.colors : neutralColors(derived.verts.length);
    const faces = surfaceState.faces.length ? surfaceState.faces : derived.tris;
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(flatVecs(positions), 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(flatVecs(colors), 3));
    geometry.setIndex(faces.flat());
    geometry.computeVertexNormals();
    return geometry;
  }, [derived, surfaceState]);

  useEffect(() => {
    return () => surfaceGeometry.dispose();
  }, [surfaceGeometry]);

  const previewGeometry = useMemo(() => {
    if (hasExcision) return new THREE.BufferGeometry();
    const { la, lb } = lesionSizes(derived.meanEdge, sizePct);
    return ellipseGeometry(
      derived.verts[lesionIndex],
      derived.normalsRest[lesionIndex],
      derived.dir[lesionIndex],
      la,
      lb,
      derived.meanEdge,
    );
  }, [derived, hasExcision, lesionIndex, sizePct]);

  const previewLine = useMemo(() => {
    const line = new THREE.Line(
      previewGeometry,
      new THREE.LineBasicMaterial({ color: 0x18c08a, toneMapped: false }),
    );
    line.renderOrder = 5;
    return line;
  }, [previewGeometry]);

  useEffect(() => {
    return () => {
      previewLine.geometry.dispose();
      if (Array.isArray(previewLine.material)) previewLine.material.forEach((material) => material.dispose());
      else previewLine.material.dispose();
    };
  }, [previewLine]);

  useFrame(() => {
    const d = derivedRef.current;
    const runtime = runtimeRef.current;
    if (!runtime.sb || !runtime.simActive) return;
    let maxVelocity = 0;
    stepSoftBody(runtime.sb, 3);
    runtime.simFrames++;
    for (let i = 0; i < runtime.sb.N; i++) {
      if (runtime.sb.anchored[i] || runtime.sb.removed[i]) continue;
      maxVelocity = Math.max(maxVelocity, len(runtime.sb.vel[i]));
    }
    const score = updateTensionAndColors();
    updateMeshAttributes(runtime.sb.pos, runtime.colors);
    if (showLinesRef.current && runtime.simFrames % 2 === 0) refreshLineGeometry();
    if (runtime.simFrames % 8 === 0) onTensionChange(Math.round(score));
    if (maxVelocity < d.meanEdge * 2e-4 || runtime.simFrames > 900) {
      runtime.simActive = false;
      runtime.settled = true;
      onTensionChange(Math.round(score));
      onHintChange("闭合完成：可复位后换一个落点继续观察。");
      onVerdictChange(`沿 RSTL 闭合新增张力指数 ${Math.round(score)} / 100。`, score > 55 ? "warn" : "ok");
    }
  });

  const markerRadius = derived.meanEdge * 0.45;
  const cameraDistance = Math.max(0.35, derived.box.size * 1.6);
  const minDistance = Math.max(0.35, derived.box.size * 0.8);
  const maxDistance = Math.max(minDistance * 1.5, derived.box.size * 3.5);
  const gridScale = Math.max(0.7, derived.box.size * 0.75);
  const gridY = -Math.max(0.45, derived.box.size * 0.38);

  return (
    <>
      <color attach="background" args={["#111820"]} />
      <ambientLight intensity={0.78} />
      <directionalLight position={[2.5, 2.8, 3.5]} intensity={1.8} />
      <directionalLight position={[-2, 1, 2]} intensity={0.7} />
      <SurgeryCamera distance={cameraDistance} />
      <gridHelper args={[2, 12, "#334155", "#243041"]} position={[0, gridY, 0]} scale={gridScale} />
      <group position={groupOffset}>
        <mesh ref={meshRef} geometry={surfaceGeometry} onClick={handleMeshClick}>
          <meshStandardMaterial color="#d8a98f" roughness={0.68} metalness={0.02} vertexColors />
        </mesh>
        <lineSegments ref={lineRef} renderOrder={3}>
          <bufferGeometry />
          <lineBasicMaterial color="#6fe9ff" transparent opacity={0.5} toneMapped={false} />
        </lineSegments>
        {!hasExcision && (
          <>
            <mesh position={derived.verts[lesionIndex]} renderOrder={6}>
              <sphereGeometry args={[markerRadius, 16, 12]} />
              <meshBasicMaterial color="#ff2b4e" toneMapped={false} />
            </mesh>
            <primitive object={previewLine} />
          </>
        )}
        {woundBed && (
          <mesh position={woundBed.position} quaternion={woundBed.quaternion} scale={woundBed.scale} visible={hasExcision}>
            <circleGeometry args={[1, 28]} />
            <meshBasicMaterial color="#7d2b24" side={THREE.DoubleSide} toneMapped={false} />
          </mesh>
        )}
      </group>
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={minDistance}
        maxDistance={maxDistance}
      />
    </>
  );
}

export function SurgeryR3FScene(props: SurgeryR3FSceneProps) {
  return (
    <Canvas id="surgeryCanvas" className="surgery-r3f-canvas" camera={{ position: [0, 0, 2.8], fov: 35 }} dpr={[1, 2]}>
      {props.assets ? <SurgerySceneContent {...props} assets={props.assets} /> : <LoadingScene loadingText={props.loadingText} />}
    </Canvas>
  );
}
