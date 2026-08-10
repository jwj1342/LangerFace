import { toPixels } from "./geometryAtlas";
import { detectControlledMarker } from "./controlledMarkerDetection";
import type { IncisionRuntimeState } from "./incisionControllerState";
import type { IncisionDomElements } from "./incisionDom";
import {
  confirmLesionDetectionDraft,
  normalizeLesionDetectionAdapter,
  type LesionDetectionAdapterDraft,
} from "./lesionDetectionAdapter";
import type { SurfaceRef } from "./incisionOverlay";
import {
  buildSubcutaneousDiameterEstimateRefs,
  nearestPhotoEndpointHandle,
  pointsToSurfaceRefs,
  renderIncisionPhotoPlanning,
  surfaceRefToModelPoint,
  validateIncisionPhotoFile,
} from "./incisionPhotoPlanning";
import { prepareImageSource } from "./imageSource";
import { modelState } from "./liveState";
import { sourcePointToSurfaceRef } from "./photoPlanningController";
import { ensureImageReady } from "./pipelineModels";
import { detectStaticImageWithRetries } from "./staticImageDetection";
import { shouldClearFreehandBoundaryOnLesionRepick } from "./tumorInput";

interface IncisionPhotoRuntimeOptions {
  elements: IncisionDomElements;
  state: IncisionRuntimeState;
  clearTransientPlanning(): void;
  defaultLesion(): number;
  nearestVertex(point: unknown): number;
  setLesion(index: number, centerRef?: SurfaceRef | null): void;
  updateTumorRing(): void;
  runWorkflow(): void | Promise<void>;
  publishState(reason: string): void;
  dragEndpoint(point: [number, number, number], index: number): void;
  commitEndpointDrag(): void;
}

export interface IncisionPhotoRuntime {
  fit(): void;
  render(): void;
  setMode(active: boolean): void;
  resetView(): void;
  load(file?: File): Promise<void>;
  beginControlledMarkerDetection(): void;
  confirmControlledMarkerDetection(): Promise<void>;
  pick(event: PointerEvent): void;
  endpointHandleFromEvent(event: PointerEvent): number | null;
  dragEndpoint(event: PointerEvent, index: number): void;
  commitEndpointDrag(): void;
  pan(deltaX: number, deltaY: number): void;
  zoom(event: WheelEvent): void;
  toggleMirror(): void;
  dispose(): void;
}

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

export function createIncisionPhotoRuntime(options: IncisionPhotoRuntimeOptions): IncisionPhotoRuntime {
  const {
    elements,
    state,
    clearTransientPlanning,
    defaultLesion,
    nearestVertex,
    setLesion,
    updateTumorRing,
    runWorkflow,
    publishState,
    dragEndpoint,
    commitEndpointDrag,
  } = options;
  let disposed = false;
  let controlledMarkerSeedMode = false;
  let controlledMarkerDraft: LesionDetectionAdapterDraft | null = null;

  const resetControlledMarker = () => {
    controlledMarkerSeedMode = false;
    controlledMarkerDraft = null;
    elements.controlledMarkerConfirm.disabled = true;
  };

  const updateEndpointHandles = () => {
    const wrapRect = elements.wrap.getBoundingClientRect();
    const refs = pointsToSurfaceRefs(state.result?.candidate?.endpoints || [], state.verts, state.tris);
    const points = refs.map((ref) => state.planning2d?.surfaceRefToClient(ref) || null);
    elements.photoEndpointHandles.forEach((handle, index) => {
      const point = state.photoView.active ? points[index] : null;
      handle.hidden = !point;
      if (!point) return;
      handle.style.left = `${point.x - wrapRect.left}px`;
      handle.style.top = `${point.y - wrapRect.top}px`;
    });
  };

  const setStatus = (message: string, tone: "idle" | "loading" | "ready" | "warning" = "idle") => {
    elements.photoStatus.textContent = message;
    elements.photoStatus.dataset.tone = tone;
  };

  const fit = () => {
    if (!state.photoView.active || !state.planning2d) return;
    const frame = state.planning2d.getFrameState();
    if (!frame.source || !frame.width || !frame.height) return;
    const rect = elements.wrap.getBoundingClientRect();
    const transform = state.planning2d.setView({
      viewportLeft: rect.left,
      viewportTop: rect.top,
      viewportWidth: rect.width,
      viewportHeight: rect.height,
      canvasWidth: elements.photoCanvas.width,
      canvasHeight: elements.photoCanvas.height,
      zoom: state.photoView.zoom,
      offsetX: state.photoView.offsetX,
      offsetY: state.photoView.offsetY,
      mirror: state.photoView.mirror,
      devicePixelRatio: Math.min(globalThis.devicePixelRatio || 1, 2),
    });
    if (!transform) return;
    elements.photoCanvas.style.width = `${Math.round(transform.baseWidth)}px`;
    elements.photoCanvas.style.height = `${Math.round(transform.baseHeight)}px`;
    elements.photoCanvas.style.setProperty("--incision-photo-zoom", `${state.photoView.zoom}`);
    elements.photoCanvas.style.setProperty("--incision-photo-pan-x", `${Math.round(state.photoView.offsetX)}px`);
    elements.photoCanvas.style.setProperty("--incision-photo-pan-y", `${Math.round(state.photoView.offsetY)}px`);
    elements.photoCanvas.style.setProperty("--incision-photo-mirror", state.photoView.mirror ? "-1" : "1");
    updateEndpointHandles();
  };

  const render = () => {
    if (!state.photoView.active || !state.planning2d || !state.atlas) return;
    const frame = state.planning2d.getFrameState();
    if (!frame.source || !frame.landmarks?.length) return;
    const context = elements.photoCanvas.getContext("2d");
    if (!context) return;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    elements.photoCanvas.width = Math.max(1, Math.round(frame.width * dpr));
    elements.photoCanvas.height = Math.max(1, Math.round(frame.height * dpr));
    const endpointRefs = pointsToSurfaceRefs(state.result?.candidate?.endpoints || [], state.verts, state.tris);
    const diameterEstimateRefs = elements.tumorKind.value === "subcutaneous"
      ? buildSubcutaneousDiameterEstimateRefs({
        centerRef: state.lesionRef,
        lesionIndex: state.lesion,
        diameterMm: Number(elements.diameter.value),
        unitsPerMm: state.unitsPerMm,
        vertices: state.verts,
        normals: state.normals,
        triangles: state.tris,
      })
      : [];
    const sourceToCssScale = frame.transform?.displayWidth
      ? frame.transform.displayWidth / frame.width
      : 1;
    const geometry = renderIncisionPhotoPlanning({
      context,
      source: frame.source as CanvasImageSource,
      sourceWidth: frame.width,
      sourceHeight: frame.height,
      devicePixelRatio: dpr,
      landmarks: [...frame.landmarks],
      triangles: state.tris,
      atlasLines: state.atlas.lines || [],
      centerRef: state.lesionRef,
      diameterEstimateRefs,
      boundaryRefs: frame.selection.boundaryRefs,
      candidateRefs: pointsToSurfaceRefs(state.result?.candidate?.polyline || [], state.verts, state.tris),
      endpointRefs,
      endpointRadius: 14 / Math.max(sourceToCssScale, 0.05),
    });
    state.planning2d.setOverlaySummary({
      rstlLineCount: geometry.rstl.length,
      tumorVisible: geometry.center !== null,
      candidatePointCount: geometry.candidate.length,
    });
    fit();
    setStatus(
      `照片规划 · RSTL ${geometry.rstl.length} 条 · ${geometry.candidate.length ? "候选已叠加" : "点击面部设置病灶"}`,
      "ready",
    );
  };

  const setMode = (active: boolean) => {
    state.photoView.active = active && Boolean(state.planning2d?.getFrameState().source);
    elements.canvas.classList.toggle("hidden", state.photoView.active);
    elements.photoCanvas.dataset.active = String(state.photoView.active);
    elements.photoMirror.disabled = !state.photoView.active;
    elements.photoReset.disabled = !state.photoView.active;
    elements.surfaceMode.disabled = !state.planning2d?.getFrameState().source;
    elements.controlledMarkerDetect.disabled = !state.photoView.active;
    elements.controlledMarkerConfirm.disabled = !state.photoView.active || !controlledMarkerDraft;
    elements.surfaceMode.title = state.photoView.active
      ? "切换到标准三维规划表面"
      : "返回患者照片规划";
    if (state.photoView.active) {
      fit();
      render();
      elements.stageStatus.textContent = "患者照片规划：点击面部定位，拖拽平移，滚轮缩放";
    } else {
      updateEndpointHandles();
      elements.stageStatus.textContent = "标准表面规划：拖拽旋转 · 滚轮缩放 · 点击定位";
      setStatus("标准表面模式；上传 JPEG 或 PNG 可进入患者照片规划", "idle");
    }
  };

  const resetView = () => {
    state.photoView.zoom = 1;
    state.photoView.offsetX = 0;
    state.photoView.offsetY = 0;
    fit();
  };

  const load = async (file?: File) => {
    if (!file || disposed) return;
    elements.photoInput.value = "";
    const validationError = validateIncisionPhotoFile(file);
    if (validationError) {
      if (state.planning2d?.getFrameState().source) {
        state.photoView.operationId += 1;
        state.planning2d.clearSource();
        clearTransientPlanning();
        setMode(false);
      }
      setStatus(validationError, "warning");
      elements.stageStatus.textContent = validationError;
      return;
    }
    if (!state.verts.length || !state.tris.length || !state.atlas) {
      const message = "切口规划资产仍在加载，请稍后重新选择照片。";
      setStatus(message, "warning");
      elements.stageStatus.textContent = message;
      return;
    }
    const operationId = ++state.photoView.operationId;
    resetControlledMarker();
    state.planning2d?.clearSource();
    clearTransientPlanning();
    setMode(false);
    setStatus("正在本地加载模型并检测照片…", "loading");
    elements.stageStatus.textContent = "患者照片检测中…";
    let objectUrl: string | null = null;
    try {
      await ensureImageReady();
      if (disposed || !state.mounted || operationId !== state.photoView.operationId) return;
      objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      if (disposed || !state.mounted || operationId !== state.photoView.operationId) return;
      const prepared = prepareImageSource(image);
      const releaseUrl = objectUrl;
      const revision = state.planning2d?.replaceSource({
        source: prepared.source,
        kind: "image",
        width: prepared.width,
        height: prepared.height,
        release: () => URL.revokeObjectURL(releaseUrl),
      });
      objectUrl = null;
      if (!state.planning2d || revision == null) return;
      const context = elements.photoCanvas.getContext("2d");
      if (context) {
        const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
        elements.photoCanvas.width = Math.max(1, Math.round(prepared.width * dpr));
        elements.photoCanvas.height = Math.max(1, Math.round(prepared.height * dpr));
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, prepared.width, prepared.height);
        context.drawImage(prepared.source, 0, 0, prepared.width, prepared.height);
        context.setTransform(1, 0, 0, 1, 0, 0);
      }
      state.planning2d.setTopology(state.tris);
      state.planning2d.setDetectorLease({ detector: modelState.imageLandmarker });
      state.planning2d.setDetection({ sourceRevision: revision, status: "detecting" });
      const outcome = detectStaticImageWithRetries(modelState.imageLandmarker, prepared.source);
      if (disposed || !state.mounted || operationId !== state.photoView.operationId) return;
      const faces = outcome.result?.faceLandmarks || [];
      if (faces.length !== 1) {
        const reason = faces.length > 1 ? "multiple_faces" : outcome.error ? "detection_error" : "no_face";
        state.planning2d.setDetection({ sourceRevision: revision, status: "failed", attempts: outcome.attempts, reason });
        setMode(true);
        const message = faces.length > 1
          ? "检测到多张人脸；请上传仅包含一位受试者的照片。"
          : outcome.error
            ? "照片检测失败；请重新上传清晰正脸照片。"
            : "未检测到人脸；请更换正面、清晰、光线充足的照片。";
        setStatus(message, "warning");
        elements.stageStatus.textContent = message;
        return;
      }
      const landmarks = toPixels(faces[0], prepared.width, prepared.height);
      state.planning2d.setDetection({ sourceRevision: revision, status: "ready", landmarks, attempts: outcome.attempts });
      resetView();
      setLesion(defaultLesion(), null);
      setMode(true);
      await runWorkflow();
      render();
    } catch (error) {
      if (disposed || !state.mounted || operationId !== state.photoView.operationId) return;
      const message = `照片加载失败：${errorMessage(error)}`;
      setStatus(message, "warning");
      elements.stageStatus.textContent = message;
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  };

  return {
    fit,
    render,
    setMode,
    resetView,
    load,
    beginControlledMarkerDetection() {
      const frame = state.planning2d?.getFrameState();
      if (!state.photoView.active || !frame?.source || !frame.landmarks?.length) {
        setStatus("请先上传并成功检测一张单人正脸照片。", "warning");
        return;
      }
      controlledMarkerSeedMode = true;
      controlledMarkerDraft = null;
      elements.controlledMarkerConfirm.disabled = true;
      setStatus("受控标记定位：请点击照片中的黑点、贴纸或手绘标记中心。", "loading");
    },
    async confirmControlledMarkerDetection() {
      if (!controlledMarkerDraft) {
        setStatus("当前没有待确认的受控标记定位草案。", "warning");
        return;
      }
      try {
        const kind = elements.tumorKind.value === "cutaneous" ? "cutaneous" : "subcutaneous";
        const confirmed = confirmLesionDetectionDraft(controlledMarkerDraft, {
          kind,
          diameter_mm: Number(elements.diameter.value),
          depth_mm: kind === "subcutaneous" ? Number(elements.depth.value) : null,
          margin_mm: kind === "cutaneous" ? Number(elements.margin.value) : 0,
          boundary_mode: kind === "cutaneous" && elements.boundaryMode.value === "freehand" ? "freehand" : "ellipse",
        }, elements.tumorAuthor.value);
        if (!confirmed.eligible_for_candidate) {
          throw new Error("当前类型、范围或参数尚未通过输入质量检查");
        }
        clearTransientPlanning();
        if (kind === "cutaneous" && elements.boundaryMode.value === "freehand") {
          state.boundaryRefs = [...confirmed.geometry.boundary_refs];
          state.boundaryPoints = [...confirmed.geometry.boundary];
        }
        setLesion(nearestVertex(confirmed.geometry.center), confirmed.geometry.center_ref);
        updateTumorRing();
        resetControlledMarker();
        await runWorkflow();
        render();
        setStatus("受控标记定位已由人工确认，并已使用当前参数生成候选。", "ready");
        publishState("controlled_marker_confirmed");
      } catch (error) {
        setStatus(`确认受控标记失败：${errorMessage(error)}`, "warning");
      }
    },
    pick(event) {
      if (controlledMarkerSeedMode) {
        controlledMarkerSeedMode = false;
        const frame = state.planning2d?.getFrameState();
        const seed = state.planning2d?.clientToSource({ x: event.clientX, y: event.clientY });
        if (!frame?.source || !frame.landmarks?.length || !seed) {
          setStatus("该点击无法映射到照片，请重新进入受控标记定位。", "warning");
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = frame.width;
        canvas.height = frame.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          setStatus("浏览器无法读取本地照片像素。", "warning");
          return;
        }
        context.drawImage(frame.source as CanvasImageSource, 0, 0, frame.width, frame.height);
        const detection = detectControlledMarker(context.getImageData(0, 0, frame.width, frame.height), seed);
        if (!detection.ok || !detection.center) {
          setStatus(`未定位到受控标记：${detection.failure_code || "unknown"}。请更准确点击标记中心。`, "warning");
          return;
        }
        const centerRef = sourcePointToSurfaceRef(detection.center, frame.landmarks, frame.triangles);
        const boundaryRefs = detection.boundary
          .map((point) => sourcePointToSurfaceRef(point, frame.landmarks!, frame.triangles))
          .filter((ref): ref is SurfaceRef => ref !== null);
        const kind = elements.tumorKind.value === "cutaneous" ? "cutaneous" : "subcutaneous";
        if (!centerRef || (kind === "cutaneous" && boundaryRefs.length < 3)) {
          setStatus("标记位于不可映射区域或跨出面部表面，请在面部标记中心重试。", "warning");
          return;
        }
        try {
          controlledMarkerDraft = normalizeLesionDetectionAdapter({
            schema: "lesion-detection-adapter/v0.1",
            source: "detector",
            kind,
            topology: { id: state.headAsset?.topologyId, version: state.headAsset?.topologyVersion },
            center_ref: centerRef,
            boundary_refs: kind === "cutaneous" ? boundaryRefs : [],
            diameter_mm: Number(elements.diameter.value),
            depth_mm: kind === "subcutaneous" ? Number(elements.depth.value) : null,
            margin_mm: kind === "cutaneous" ? Number(elements.margin.value) : 0,
            confidence: detection.confidence,
            units: "mm",
            model: { name: "controlled-marker-connected-component", version: "0.1" },
            warnings: detection.warnings,
          }, {
            topologyId: state.headAsset?.topologyId,
            topologyVersion: state.headAsset?.topologyVersion,
            vertices: state.verts,
            triangles: state.tris,
          });
          clearTransientPlanning();
          setLesion(nearestVertex(controlledMarkerDraft.geometry.center), centerRef);
          state.planning2d?.setSelection({ centerRef, boundaryRefs });
          elements.controlledMarkerConfirm.disabled = false;
          render();
          setStatus(
            `已生成受控标记定位草案（置信度 ${Math.round(detection.confidence * 100)}%），请核对类型和参数后点击“确认定位”。`,
            detection.warnings.length ? "warning" : "ready",
          );
          publishState("controlled_marker_draft");
        } catch (error) {
          resetControlledMarker();
          setStatus(`受控标记草案无效：${errorMessage(error)}`, "warning");
        }
        return;
      }
      resetControlledMarker();
      const ref = state.planning2d?.pickSurfaceRef({ x: event.clientX, y: event.clientY });
      if (!ref) {
        setStatus("该位置不在人脸表面，请点击检测到的面部区域。", "warning");
        return;
      }
      const point = surfaceRefToModelPoint(ref, state.verts, state.tris);
      if (!point) return;
      if (state.boundaryActive && elements.tumorKind.value === "cutaneous" && elements.boundaryMode.value === "freehand") {
        state.boundaryPoints.push(point);
        state.boundaryRefs.push(ref);
        updateTumorRing();
        elements.pickState.textContent = `自由轮廓点：${state.boundaryPoints.length} 个`;
        publishState("tumor_boundary_point");
        return;
      }
      const clearedFreehandBoundary = shouldClearFreehandBoundaryOnLesionRepick({
        kind: elements.tumorKind.value,
        boundaryMode: elements.boundaryMode.value,
        boundaryPointCount: state.boundaryPoints.length,
      });
      if (clearedFreehandBoundary) {
        state.boundaryPoints = [];
        state.boundaryRefs = [];
        state.boundaryActive = false;
        elements.startBoundary.textContent = "开始轮廓";
      }
      setLesion(nearestVertex(point), ref);
      if (clearedFreehandBoundary) {
        elements.pickState.textContent = "已选择新病灶中心；原自由轮廓已清空，请重新绘制。";
      }
      void runWorkflow();
    },
    endpointHandleFromEvent(event) {
      if (!state.photoView.active || !state.planning2d) return null;
      const refs = pointsToSurfaceRefs(state.result?.candidate?.endpoints || [], state.verts, state.tris);
      const endpoints = refs
        .map((ref) => state.planning2d?.surfaceRefToClient(ref))
        .filter((point): point is { x: number; y: number } => point !== null && point !== undefined);
      return nearestPhotoEndpointHandle(
        { x: event.clientX, y: event.clientY },
        endpoints,
        event.pointerType === "touch" ? 20 : 14,
      );
    },
    dragEndpoint(event, index) {
      const ref = state.planning2d?.pickSurfaceRef({ x: event.clientX, y: event.clientY });
      if (!ref) return;
      const point = surfaceRefToModelPoint(ref, state.verts, state.tris);
      if (point) dragEndpoint(point, index);
    },
    commitEndpointDrag,
    pan(deltaX, deltaY) {
      if (!state.photoView.active) return;
      state.photoView.offsetX += deltaX;
      state.photoView.offsetY += deltaY;
      fit();
    },
    zoom(event) {
      if (!state.photoView.active || !state.planning2d) return;
      const sourcePoint = state.planning2d.clientToSource({ x: event.clientX, y: event.clientY });
      const nextZoom = clamp(state.photoView.zoom * Math.exp(-clamp(event.deltaY, -160, 160) * 0.0018), 1, 5);
      if (Math.abs(nextZoom - state.photoView.zoom) < 0.001) return;
      state.photoView.zoom = nextZoom;
      fit();
      if (!sourcePoint) return;
      const projected = state.planning2d.sourceToClient(sourcePoint);
      if (!projected) return;
      state.photoView.offsetX += event.clientX - projected.x;
      state.photoView.offsetY += event.clientY - projected.y;
      fit();
    },
    toggleMirror() {
      if (!state.photoView.active) return;
      state.photoView.mirror = !state.photoView.mirror;
      elements.photoMirror.setAttribute("aria-pressed", String(state.photoView.mirror));
      fit();
    },
    dispose() {
      disposed = true;
      state.photoView.operationId += 1;
    },
  };
}
