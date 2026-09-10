import assert from 'node:assert/strict';
import { createServerYoloSession } from '../web/src/services/personalized/serverYoloSession.ts';
const original=globalThis.fetch;
const sha='a'.repeat(64);
const health={ready:true,yoloProvider:'CUDAExecutionProvider',modelSha256:sha};
const header={modelSha256:sha,outputs:[{name:'output0',dtype:'float32',shape:[1,2],bytes:8}]};
function packet(meta=header){
  const json=Buffer.from(JSON.stringify(meta)),size=Buffer.alloc(4);
  size.writeUInt32LE(json.length);
  return Buffer.concat([size,json,Buffer.from(new Float32Array([1.25,-3.5]).buffer)]);
}
function compactPacket(meta={modelSha256:sha,width:640,height:640,
  classes:['forehead','frown','wrinkle'],candidateCount:4,detectionCount:2,
  inferenceMs:4.5,postprocessMs:7.5,detections:[{classId:0,score:.8,box:[1,2,3,4]}]}){
  const json=Buffer.from(JSON.stringify(meta)),size=Buffer.alloc(4);
  size.writeUInt32LE(json.length);
  const masks=Buffer.alloc(3*640*640);masks[0]=1;masks[640*640]=1;masks[2*640*640]=1;
  return Buffer.concat([size,json,masks]);
}
function packedCompactPacket(){
  const metadata={modelSha256:sha,width:640,height:640,classes:['forehead','frown','wrinkle'],
    candidateCount:4,detectionCount:2,inferenceMs:4.5,postprocessMs:7.5,preprocessingMs:1.25,
    detections:[],maskEncoding:'bitpack-msb',unpackedMaskBytes:3*640*640};
  const json=Buffer.from(JSON.stringify(metadata)),size=Buffer.alloc(4),masks=Buffer.alloc(3*640*640/8);
  size.writeUInt32LE(json.length);masks[0]=0b10000000;masks[640*640/8]=0b10000000;
  masks[2*640*640/8]=0b10000000;return Buffer.concat([size,json,masks]);
}
try{
  let calls=0;
  globalThis.fetch=async url=>url.endsWith('health')?Response.json(health)
    :++calls===1?new Response('',{status:429}):new Response(packet());
  const session=await createServerYoloSession(sha.toUpperCase());
  const output=await session.run({images:{data:new Float32Array(3)}});
  assert.equal(calls,2,'Busy request should retry without CPU fallback');
  assert.deepEqual([...output.output0.data],[1.25,-3.5]);
  globalThis.fetch=async url=>url.endsWith('health')?Response.json(health):new Response(compactPacket());
  const compact=await session.runClassMasks(new Float32Array(3));
  assert.deepEqual(Object.keys(compact.classMasks),['forehead','frown','wrinkle']);
  assert.deepEqual(compact.detections,[{classId:0,score:.8,box:[1,2,3,4]}]);
  assert.equal(compact.classMasks.forehead[0],1);
  assert.equal(compact.classMasks.frown[0],1);
  assert.equal(compact.classMasks.wrinkle[0],1);
  let rgbaRequest;
  globalThis.fetch=async (url,init)=>{
    if(url.endsWith('health'))return Response.json(health);
    rgbaRequest={url,init};return new Response(packedCompactPacket());
  };
  const rgba=new Uint8ClampedArray(640*640*4);rgba[0]=123;
  const rgbaCompact=await session.runClassMasksImageData({width:640,height:640,data:rgba});
  assert.ok(rgbaRequest.url.endsWith('/api/gpu/yolo/class-masks-rgba'));
  assert.equal(rgbaRequest.init.body.byteLength,640*640*4);
  assert.equal(rgbaRequest.init.body[0],123);
  assert.equal(rgbaCompact.diagnostics.preprocessingMs,1.25);
  assert.equal(rgbaCompact.classMasks.forehead[0],1);
  assert.equal(rgbaCompact.classMasks.frown[0],1);
  assert.equal(rgbaCompact.classMasks.wrinkle[0],1);
  globalThis.fetch=async()=>Response.json({...health,yoloProvider:'CPUExecutionProvider'});
  await assert.rejects(()=>createServerYoloSession(sha),/backend or checksum/);
  globalThis.fetch=async url=>url.endsWith('health')?Response.json(health):new Response(packet({...header,modelSha256:'b'.repeat(64)}));
  const changed=await createServerYoloSession(sha);
  await assert.rejects(()=>changed.run({images:{data:new Float32Array(3)}}),/model changed/);
  globalThis.fetch=async url=>url.endsWith('health')?Response.json(health):new Response(packet({...header,outputs:[{...header.outputs[0],shape:[1,3]}]}));
  const malformed=await createServerYoloSession(sha);
  await assert.rejects(()=>malformed.run({images:{data:new Float32Array(3)}}),/Invalid CUDA tensor/);
}finally{globalThis.fetch=original;}
console.log('Server CUDA session: decoding, busy retry, backend/hash and shape rejection passed');
