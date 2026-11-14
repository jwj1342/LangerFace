import { refineForeheadTrajectories } from './foreheadTrajectoryAttraction.ts';
import { buildDirectNoseDorsumRstl } from './directNoseDorsumRstl.ts';

type Point = [number, number];
type Curve = {name: string; region?: string; pts: Point[]; hiddenPointRuns?: Array<[number,number]>};
type Evidence = {id: string; points: Point[]};
const quantile = (v:number[],q:number) => [...v].sort((a,b)=>a-b)[Math.floor((v.length-1)*q)] ?? Infinity;
const mean = (v:number[]) => v.reduce((a,b)=>a+b,0)/Math.max(1,v.length);

// Match in the wrinkle's local frame. Distant upturned tails must not determine
// whether the nearby section is parallel to the evidence.
export function noseCandidateMetrics(points: Point[], line: Point[]) {
  const distances:number[]=[],angles:number[]=[];
  for(let i=1;i<line.length-1;i++) {
    const p=line[i],a=line[Math.max(0,i-3)],b=line[Math.min(line.length-1,i+3)];
    const tx=b[0]-a[0],ty=b[1]-a[1]; let best=Infinity, direction=90;
    for(let k=1;k<points.length;k++) {
      const c=points[k-1],d=points[k],dx=d[0]-c[0],dy=d[1]-c[1],sq=dx*dx+dy*dy;
      if(sq<1e-12)continue;
      const f=Math.max(0,Math.min(1,((p[0]-c[0])*dx+(p[1]-c[1])*dy)/sq));
      const distance=Math.hypot(p[0]-c[0]-f*dx,p[1]-c[1]-f*dy);
      if(distance<best){best=distance; direction=Math.acos(Math.min(1,Math.abs(tx*dx+ty*dy)/Math.max(1e-12,Math.hypot(tx,ty)*Math.sqrt(sq))))*180/Math.PI;}
    }
    distances.push(best);angles.push(direction);
  }
  return {meanDistancePx:mean(distances),p90DistancePx:quantile(distances,.9),medianDirectionDegrees:quantile(angles,.5),p90DirectionDegrees:quantile(angles,.9)};
}

export function refineNoseHybrid(input: {curves:Curve[]; lines:Evidence[]; faceWidthPx:number; size:number; eyePolygons:Point[][]}) {
  let curves=input.curves.map(c=>({...c,pts:c.pts.map(p=>[...p] as Point)}));
  const directLines:Evidence[]=[], records:Record<string,unknown>[]=[];
  const owned=new Set<number>();
  for(const line of [...input.lines].sort((a,b)=>a.id.localeCompare(b.id))) {
    if(line.points.length<3)continue;
    const first=line.points[0],last=line.points.at(-1)!;
    const angle=Math.atan2(last[1]-first[1],last[0]-first[0]),co=Math.cos(angle),si=Math.sin(angle);
    const rotate=([x,y]:Point):Point=>[co*x+si*y,-si*x+co*y];
    const undo=([x,y]:Point):Point=>[co*x-si*y,si*x+co*y];
    const track=line.points.map(rotate),lo=Math.min(...track.map(p=>p[0])),hi=Math.max(...track.map(p=>p[0]));
    const candidates=curves.flatMap((c,index)=>{
      if(owned.has(index)||c.region==='forehead_bridge_arc_v15')return [];
      const points=c.pts.map(rotate),metrics=noseCandidateMetrics(c.pts,line.points);
      // Only graph-like curves can enter the shared trajectory solver. Vertical
      // or folded curves remain fixed obstacles, never flattened into a graph.
      const dx=points.at(-1)![0]-points[0][0];
      const monotone=points.every((p,k)=>!k||(p[0]-points[k-1][0])*Math.sign(dx)>=-1e-6);
      const overlap=Math.max(0,Math.min(hi,Math.max(...points.map(p=>p[0])))-Math.max(lo,Math.min(...points.map(p=>p[0]))))/Math.max(1e-9,hi-lo);
      if(!monotone||overlap<.65||metrics.meanDistancePx>input.faceWidthPx*.025||metrics.p90DistancePx>input.faceWidthPx*.04||metrics.medianDirectionDegrees>25||metrics.p90DirectionDegrees>40)return [];
      return [{index,points,metrics,score:metrics.meanDistancePx/(input.faceWidthPx*.025)+metrics.medianDirectionDegrees/25}];
    }).sort((a,b)=>a.score-b.score||a.index-b.index).slice(0,3);
    if(!candidates.length){directLines.push(line);records.push({wrinkleId:line.id,mode:'direct_generation',reason:'no_near_parallel_curve'});continue;}
    const indices=new Set(candidates.map(c=>c.index));
    const result=refineForeheadTrajectories({size:input.size,transitionGapMultiplier:14,
      seeds:candidates.map(c=>({name:curves[c.index].name||String(c.index),region:curves[c.index].region||'',pts:c.points})),
      lines:[{id:line.id,points:track}],
      fixedCurves:curves.flatMap((c,i)=>indices.has(i)?[]:[{name:c.name||String(i),region:c.region||'',pts:c.pts.map(rotate)}])});
    candidates.forEach((c,i)=>{curves[c.index]={...curves[c.index],pts:result.curves[i].pts.map((p,k)=>
      Math.hypot(p[0]-c.points[k][0],p[1]-c.points[k][1])<1e-9 ? curves[c.index].pts[k] : undo(p))};owned.add(c.index);});
    records.push({wrinkleId:line.id,mode:'attraction',candidates:candidates.map(c=>({curveName:curves[c.index].name,...c.metrics})),
      matches:result.diagnostics.forehead_attraction_records,
      directAccepted:result.diagnostics.forehead_attraction_direct_count,
      constrained:result.diagnostics.forehead_attraction_incomplete_count});
  }
  const direct=directLines.length?buildDirectNoseDorsumRstl({fineLines:directLines,sourceFineLineIds:directLines.map(l=>l.id),
    faceWidthPx:input.faceWidthPx,eyePolygons:input.eyePolygons,existingCurves:curves}):null;
  const movedIndices=curves.flatMap((c,i)=>c.pts.some((p,k)=>Math.hypot(p[0]-input.curves[i].pts[k][0],p[1]-input.curves[i].pts[k][1])>1e-6)?[i]:[]);
  const moved=movedIndices.length;
  return {curves,direct,diagnostics:{algorithm:'nose-hybrid-attraction-or-generation-1.0',records,movedCurveIndices:movedIndices,movedExistingCurveCount:moved,generatedCurveCount:direct?.curves.length||0}};
}
