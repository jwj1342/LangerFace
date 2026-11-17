import assert from 'node:assert/strict';
import {refineNoseHybrid} from '../web/src/services/personalized/noseHybridRefinement.ts';
const points=(y:number):[number,number][]=>Array.from({length:101},(_,i)=>[i,y]);
const base={curves:[30,40,50].map((y,i)=>({name:String(i),region:'nose',pts:points(y)})),
lines:[{id:'curve',points:Array.from({length:61},(_,i):[number,number]=>[20+i,35-4*Math.sin(i*Math.PI/60)])}],size:128,faceWidthPx:300,eyePolygons:[]};
const r=refineNoseHybrid(base);
assert.equal(r.diagnostics.records[0].mode,'attraction');assert.equal(r.direct,null);assert.ok(r.diagnostics.movedExistingCurveCount>0);
assert.deepEqual(refineNoseHybrid({...base,lines:[]}).curves,base.curves);
const vertical={...base,curves:[{name:'vertical',region:'nose',pts:[[10,0],[10,80]] as [number,number][]}]};
const v=refineNoseHybrid(vertical);assert.equal(v.diagnostics.records[0].mode,'direct_generation');assert.deepEqual(v.curves,vertical.curves);assert.equal(v.direct?.curves.length,1);
assert.deepEqual(refineNoseHybrid(base),r,'deterministic');
console.log('nose hybrid synthetic tests passed');
const rotate=([x,y]:[number,number]):[number,number]=>[x*.8-y*.6,x*.6+y*.8];
const rotated=refineNoseHybrid({...base,curves:base.curves.map(c=>({...c,pts:c.pts.map(rotate)})),lines:base.lines.map(l=>({...l,points:l.points.map(rotate)}))});
assert.equal(rotated.diagnostics.records[0].mode,'attraction');assert.ok(rotated.diagnostics.movedExistingCurveCount>0);
const scale=([x,y]:[number,number]):[number,number]=>[2*x,2*y];
const scaled=refineNoseHybrid({...base,size:256,faceWidthPx:600,curves:base.curves.map(c=>({...c,pts:c.pts.map(scale)})),lines:base.lines.map(l=>({...l,points:l.points.map(scale)}))});
assert.equal(scaled.diagnostics.records[0].mode,'attraction');
for(let i=0;i<r.curves.length;i++)for(let k=0;k<r.curves[i].pts.length;k++)assert.ok(Math.hypot(scaled.curves[i].pts[k][0]/2-r.curves[i].pts[k][0],scaled.curves[i].pts[k][1]/2-r.curves[i].pts[k][1])<.05);
