import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { refineForeheadTrajectories, foreheadCurveDistance } from '../web/src/services/personalized/foreheadTrajectoryAttraction.ts';
import { yoloGuardCurvesCross } from '../web/src/services/personalized/yoloGuidedRstlScope.ts';
type Point = [number, number];
const curve = (id: string, y: number) => ({ name: id, region: 'forehead_bridge_arc_v15', pts: Array.from({length: 101}, (_, x): Point => [x + 10, y]) });
const line = (id: string, y: number, lo = 30, hi = 90) => ({ id, points: Array.from({length: hi-lo+1}, (_, k): Point => [lo+k, y + 2*Math.cos((lo+k-60)/20)]) });
const base = { seeds: [curve('a',30),curve('b',40),curve('c',50),curve('d',60)], lines:[line('furrow',45)], fixedCurves:[], size:128 };
const accepted = (r: ReturnType<typeof refineForeheadTrajectories>) => r.diagnostics.forehead_attraction_records.filter((m: any)=>m.final_accepted);
const both = refineForeheadTrajectories(base);
assert.equal(accepted(both).length,2,'both sides must move toward the furrow with partial attraction');
assert.deepEqual(refineForeheadTrajectories({...base,lines:[]}).curves,base.seeds,'no evidence is an exact identity');
const single = refineForeheadTrajectories({...base,seeds:[curve('a',44)]});
assert.equal(accepted(single).length,1,'one-sided evidence is valid');
const parallel = refineForeheadTrajectories({...base,lines:[line('upper',35),line('lower',55)]});
assert.equal(accepted(parallel).length,4,'parallel furrows retain their own targets');
const fragments = refineForeheadTrajectories({...base,lines:[line('left',45,30,59),line('right',45,60,90)]});
assert.equal(fragments.audit.wrinkleTrends.length,1,'end-to-end fragments merge');
assert.equal(parallel.audit.wrinkleTrends.length,2,'parallel lines never merge');
const crossing = refineForeheadTrajectories({...base,lines:[{id:'crossing',points:Array.from({length:61},(_,k):Point=>[30+k,40+3*Math.sin(k/15)])}]});
assert.ok(crossing.audit.matchRecords.some(r => r.after.medianDirectionDegrees < r.before.medianDirectionDegrees), 'crossing candidate learns direction even when proximity is constrained');
const short = refineForeheadTrajectories({...base,lines:[line('short',45,50,70)]});
assert.ok(accepted(short).length>=1,'short local guidance');
for(const c of short.curves) assert.equal(c.pts[0][1],base.seeds.find(s=>s.name===c.name)!.pts[0][1]);
const scaled = refineForeheadTrajectories({size:256, seeds:base.seeds.map(c=>({...c,pts:c.pts.map(([x,y]):Point=>[2*x,2*y])})),lines:base.lines.map(l=>({...l,points:l.points.map(([x,y]):Point=>[2*x,2*y])})),fixedCurves:[]});
assert.equal(accepted(scaled).length,2);
for(let i=0;i<both.curves.length;i++)for(let k=0;k<both.curves[i].pts.length;k++)assert.ok(Math.abs(scaled.curves[i].pts[k][1]/2-both.curves[i].pts[k][1])<.05,'resolution equivalence');
const fixed = [{name:'brow',region:'orbital_brow_upturn_v11',pts:[[55,63],[55,90]] as Point[]}];
const obstacle = refineForeheadTrajectories({...base,lines:[line('low',61)],fixedCurves:fixed});
for(const c of obstacle.curves)assert.ok(foreheadCurveDistance(c.pts,fixed[0].pts)>=1-1e-5,'continuous obstacle clearance');
const real=JSON.parse(readFileSync(new URL('./fixtures/forehead-attraction/yellow-geometry.json',import.meta.url),'utf8'));
const result=refineForeheadTrajectories(real);
assert.equal(result.curves.length,16);assert.notDeepEqual(result.curves,real.seeds);
for(const id of ['fine-wrinkle-001','fine-wrinkle-002','fine-wrinkle-004','fine-wrinkle-008'])assert.ok(accepted(result).some((r:any)=>r.wrinkle_ids.includes(id)),`real wrinkle ${id} needs a successful direct anchor`);
assert.deepEqual(result.diagnostics.forehead_attraction_rollback_indices,[]);
for(let i=0;i<result.curves.length;i++)for(let j=0;j<i;j++)assert.equal(yoloGuardCurvesCross(result.curves[i].pts,result.curves[j].pts),false);
for(const c of result.curves)for(const o of real.fixedCurves)assert.ok(foreheadCurveDistance(c.pts,o.pts)+1e-5>=Math.min(1,foreheadCurveDistance(real.seeds.find((s:any)=>s.name===c.name).pts,o.pts)));
assert.deepEqual(refineForeheadTrajectories(real),result,'deterministic replay');
console.log('forehead trajectory attraction: synthetic scenarios and real-image geometry passed');

// A changed picture is insufficient: verify bounded partial displacement, improved
// proximity, retained overall curvature and both lower/upper bundle spacing.
for (const r of accepted(result)) {
  assert.ok(r.after.meanDistancePx < r.before.meanDistancePx);
  assert.ok(Math.abs(r.signed_mean_displacement_px) <= .30*r.local_spacing_px);
  assert.equal(r.deformation_strength,1.00);
}
const yAt=(points:Point[],x:number)=>{
 const p=[...points].sort((a,b)=>a[0]-b[0]);
 for(let k=1;k<p.length;k++)if(x<=p[k][0])return p[k-1][1]+(p[k][1]-p[k-1][1])*(x-p[k-1][0])/(p[k][0]-p[k-1][0]);
 return p.at(-1)![1];
};
for(let x=220;x<=400;x+=2) {
 const ordered=result.curves.map((_,i)=>i).sort((a,b)=>yAt(real.seeds[a].pts,x)-yAt(real.seeds[b].pts,x));
 for(let n=1;n<ordered.length;n++) {
  const a=ordered[n-1],b=ordered[n];const old=yAt(real.seeds[b].pts,x)-yAt(real.seeds[a].pts,x);
  const gap=yAt(result.curves[b].pts,x)-yAt(result.curves[a].pts,x);
  assert.ok(gap/old>=.60 && gap/old<=1.40,`spacing ratio ${gap/old} at ${x}`);
 }
}

// Cropping above the forehead must not become an attraction force. The same
// geometry translated above the image remains an identity without evidence.
const cropped = {...base, seeds:base.seeds.map(c=>({...c,pts:c.pts.map(([x,y]):Point=>[x,y-55])})),lines:[]};
assert.deepEqual(refineForeheadTrajectories(cropped).curves,cropped.seeds,'off-image standard curves must not be clamped into the photo');
