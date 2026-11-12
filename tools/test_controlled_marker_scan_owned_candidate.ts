import assert from 'node:assert/strict';
import { evaluateCandidate } from '../web/src/services/controlledMarkerFilledCandidate.ts';
import { __controlledMarkerColorForTests } from '../web/src/services/controlledMarkerDetectionColorV035.ts';
import { detectControlledMarkerWithProfileAsync } from '../web/src/services/controlledMarkerDetectionProfile.ts';
const width=192,height=192,data=new Uint8ClampedArray(width*height*4);
for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set(Math.hypot(x-96,y-96)<=18?[67,47,39,255]:[211,174,150,255],(y*width+x)*4);
const boundary=Array.from({length:64},(_,i)=>({x:96+18*Math.cos(i*Math.PI/32),y:96+18*Math.sin(i*Math.PI/32)}));
const baseline:any={ok:true,boundary,area_px:Math.PI*324,center:{x:96,y:96},bbox:{x:78,y:78,width:36,height:36},geometry_mode:'dark_component',seed_relation:'near_marker',warnings:[],diagnostics:{}};
for(const x of [96,112,116,122]){
 const r=evaluateCandidate({width,height,data},{x,y:96},48,36,baseline,baseline);
 assert.equal(r.result.ok,true,`fully enclosed supported target should survive click x=${x}`);
 assert.notEqual(r.route,'retain_baseline',`candidate evidence should pass independently of click x=${x}: ${r.reasons}`);
}
const recoveredBoundary=Array.from({length:64},(_,i)=>({x:96+18*Math.cos(i*Math.PI/32),y:96+18*Math.sin(i*Math.PI/32)}));
const smallerProposal={ok:true,area_px:Math.PI*100,boundary:Array.from({length:64},(_,i)=>({x:96+10*Math.cos(i*Math.PI/32),y:96+10*Math.sin(i*Math.PI/32)}))};
const recoveredBaseline:any={...baseline,boundary:recoveredBoundary,area_px:Math.PI*324,seed_relation:'enclosed',warnings:['solid_component_outer_boundary_recovered','solid_boundary_envelope_recovered','scan_solid_core_anchor_recovered','fixed_scale_unclipped_solid_anchor_recovered'],diagnostics:{solid_component_core_dark_ratio:.95,solid_component_contrast:60,scan_solid_proposal_consensus_count:2,solid_boundary_envelope_support_ratio:1}};
const unmeasured=evaluateCandidate({width,height,data},{x:96,y:96},48,36,recoveredBaseline,smallerProposal);
assert.notEqual(unmeasured.route,'preserved_supported_baseline_boundary','core darkness without measured boundary support is not a preservation certificate');
const supportedBaseline={...recoveredBaseline,diagnostics:{...recoveredBaseline.diagnostics,boundary_support_ratio:1,repair_fraction:0}};
const preserved=evaluateCandidate({width,height,data},{x:96,y:96},48,36,supportedBaseline,smallerProposal);
assert.equal(preserved.result.ok,true,'strong recovered solid baseline must remain accepted');
assert.equal(preserved.route,'preserved_supported_baseline_boundary','strong recovered boundary must not be replaced by a smaller filled proposal');
assert.equal(Math.round(preserved.result.area_px),Math.round(recoveredBaseline.area_px));
console.log('scan-owned candidate: center, inner edge, outer edge and outside clicks accepted');

// Exercise the small-scan recovery entry explicitly, rather than relying on
// the full detector to happen to produce an out-of-scan initial witness.
const crossingBoundary = Array.from({length:64}, (_,i) => ({
 x:96+30*Math.cos(i*Math.PI/32), y:96+30*Math.sin(i*Math.PI/32),
}));
const crossingWitness:any = {...baseline,boundary:crossingBoundary,area_px:Math.PI*900,
 bbox:{x:66,y:66,width:60,height:60}};
const smallOptions = {roiRadius:23,analysisRoiRadius:36,scanDiameterMm:5};
for (const core of [false,true]) {
 const pixels = new Uint8ClampedArray(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
  const distance=Math.hypot(x-96,y-96);
  const color=distance<=30 ? core&&distance<=12 ? [35,25,20] : [90,65,50] : [211,174,150];
  pixels.set([...color,255],(y*width+x)*4);
 }
 const image={width,height,data:pixels};
 const proposal=__controlledMarkerColorForTests.recoverScanSolidCandidate(
  image,{x:96,y:96},smallOptions,36,23,crossingWitness);
 if(core) {
  assert.equal(proposal?.area_px,437,'complete core evidence must remain available');
  assert.equal(proposal?.diagnostics?.scan_solid_proposal_count,9,'crossing witness must exercise expanded observations');
 } else assert.equal(proposal,null,'a clipped large solid alone is not a small complete target');
 const final=await detectControlledMarkerWithProfileAsync('small-lesion-boundary-candidate',image,{x:96,y:96},smallOptions);
 assert.equal(final.ok,false,'an enclosed dark core cannot certify the larger out-of-scan body');
}

for(const radius of [21.84,21.86]) {
 const edge=Array.from({length:64},(_,i)=>({x:96+radius*Math.cos(i*Math.PI/32),y:96+radius*Math.sin(i*Math.PI/32)}));
 const candidate={...baseline,boundary:edge,area_px:Math.PI*radius*radius};
 const evaluated=evaluateCandidate({width,height,data},{x:96,y:96},23,36,candidate,candidate);
 assert.equal(evaluated.reasons.includes('not_enclosed_within_scan'),radius>23*.95,
  'small-scan recovery must preserve the final 95 percent enclosure contract');
}
console.log('small scan: crossing-witness entry, complete-body rejection and enclosure threshold preserved');
