import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { workflowPhotoOpeningIntersection } from "../web/src/services/workflowControllerUtils.ts";
import type { Vec3 } from "../web/src/services/softBody.ts";
import { projectPhotoNostrilZones } from "../web/src/services/incisionPhotoOpeningProjection.ts";
import { buildMediaPipeEngineeringExclusionZones } from "../web/src/services/incisionToolCore.ts";
import { pointInPolygon2d } from "../web/src/services/incisionPathGeometry.ts";

// 真实照片几何只从操作者指定的本地证据读取，不复制患者材料到源码。
const evidence = process.argv[2];
assert.ok(evidence, "pass local geometry evidence JSON");
const probe = JSON.parse(fs.readFileSync(evidence, "utf8")).geometryProbe;
const root = path.resolve(import.meta.dirname, "..");
const reference = {
  vertices: JSON.parse(fs.readFileSync(path.join(root, "web/assets/canonical_vertices.json"), "utf8")) as Vec3[],
  triangles: JSON.parse(fs.readFileSync(path.join(root, "web/assets/topology_mediapipe_468.json"), "utf8")).triangles,
};
const footprint = probe.paths["diagnostic-candidate"].points;
// 修复前：整脸bbox固定椭圆错误覆盖鼻旁切口，返回left-nostril-opening。
assert.equal(workflowPhotoOpeningIntersection(footprint, probe.landmarks, reference), null,
  "original side-face incision must not collide with displaced bbox nostril mask");
console.log("PASS real side-face incision avoids displaced nostril mask");
assert.equal(workflowPhotoOpeningIntersection(footprint, probe.landmarks), "left-nostril-opening", "old displaced path remains a red-capable control");
const zones = projectPhotoNostrilZones(probe.landmarks, reference)!;
assert.equal(zones.length, 2);
let checks = 2;
for (const zone of zones) {
  const min = [0,1].map(k=>Math.min(...zone.polygon.map(p=>p[k])));
  const size = [0,1].map(k=>Math.max(...zone.polygon.map(p=>p[k]))-min[k]);
  const grid = Array.from({length:400},(_,i)=>[min[0]+((i%20)+0.5)*size[0]/20,min[1]+(Math.floor(i/20)+0.5)*size[1]/20] as [number,number]);
  const center = grid.find(p=>pointInPolygon2d(p,zone.polygon));
  assert.ok(center,"projected mask has an actual interior; vertex mean need not be inside a concave mask");
  const inside = [[-0.1,-0.1],[0.1,-0.1],[0.1,0.1],[-0.1,0.1]].map(p => ({x:center[0]+p[0],y:center[1]+p[1]}));
  assert.equal(workflowPhotoOpeningIntersection(inside, probe.landmarks, reference), zone.id);
  assert.equal(workflowPhotoOpeningIntersection(zone.polygon.map(p=>({x:p[0],y:p[1]})), probe.landmarks, reference), zone.id);
  // 同一鼻孔内点经仿射照片坐标变化后仍应被挡；不靠照片尺寸/朝向特判。
  for (const scale of [0.5, 2]) {
    const shifted = probe.landmarks.map((p: Vec3) => [p[0]*scale+31,p[1]*scale-19,p[2]] as Vec3);
    assert.equal(workflowPhotoOpeningIntersection(inside.map(p=>({x:p.x*scale+31,y:p.y*scale-19})), shifted, reference), zone.id);
  }
  checks += 4;
}
const lo=[0,1].map(k=>Math.min(...probe.landmarks.map((p:Vec3)=>p[k])));
const span=[0,1].map(k=>Math.max(...probe.landmarks.map((p:Vec3)=>p[k]))-lo[k]);
for (const zone of buildMediaPipeEngineeringExclusionZones(probe.landmarks,"image_y_down").filter(z=>z.applies_to_tumor!==false&&!String(z.id).includes("nostril"))) {
  const polygon=zone.polygon.map((p:number[])=>({x:lo[0]+p[0]*span[0],y:lo[1]+p[1]*span[1]}));
  const previous = workflowPhotoOpeningIntersection(polygon,probe.landmarks);
  assert.ok(previous);
  assert.equal(workflowPhotoOpeningIntersection(polygon,probe.landmarks,reference),previous);
  checks++;
}
assert.equal(workflowPhotoOpeningIntersection(footprint,probe.landmarks,{vertices:[],triangles:[]}),"photo-opening-check-unavailable");
assert.equal(workflowPhotoOpeningIntersection(footprint,[],reference),"photo-opening-check-unavailable");
assert.equal(projectPhotoNostrilZones(Array.from({length:468},()=>[0,0,0] as Vec3),reference),null);
assert.equal(workflowPhotoOpeningIntersection([{x:NaN,y:0},...footprint],probe.landmarks,reference),"photo-opening-check-unavailable");
const invalidLandmarks=structuredClone(probe.landmarks);invalidLandmarks[33]=[NaN,0,0];
assert.equal(workflowPhotoOpeningIntersection(footprint,invalidLandmarks,reference),"photo-opening-check-unavailable");
checks+=5;
console.log(`PASS ${checks} projection, eye/mouth preservation, inside/crossing and fail-closed checks; real landmarks remain local`);
