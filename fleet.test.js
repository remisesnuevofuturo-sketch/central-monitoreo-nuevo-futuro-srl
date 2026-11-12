"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('solicitudes: consentimiento, entrega, activación confirmada y cámara protegida',async()=>{
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nf-fleet-'));const port=22000+Math.floor(Math.random()*5000),base=`http://127.0.0.1:${port}`;
const proc=spawn(process.execPath,['server.js'],{cwd:__dirname,env:{...process.env,DATA_DIR:dir,NF_TOKEN:'device-test',NF_ADMIN_TOKEN:'office-test',PORT:String(port)}});await new Promise((r,j)=>{proc.stdout.once('data',r);proc.once('exit',()=>j(Error('no inició')))});
const device={Authorization:'Bearer device-test'};const jpeg=fs.readFileSync(path.join(__dirname,'test-fixtures/road.jpg'));
async function req(p,data,headers={},method){const r=await fetch(base+p,{method:method||(data?'POST':'GET'),headers:{'Content-Type':'application/json',...headers},body:data?JSON.stringify(data):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
try{const login=await req('/api/login',{key:'office-test'}),office={Cookie:login.cookie};
assert.equal((await req('/api/monitor-request',{vehicleId:'NF-A'},device)).status,403);
assert.equal((await req('/api/monitor-request',{vehicleId:'NF-A'},office)).status,409);
await req('/api/device',{vehicleId:'NF-A',profile:{remoteConsent:true,dashcamConsent:false}},device);
const r=(await req('/api/monitor-request',{vehicleId:'NF-A'},office)).data.request;assert.equal(r.status,'pending');
const duplicate=(await req('/api/monitor-request',{vehicleId:'NF-A'},office)).data;assert.equal(duplicate.request.id,r.id);assert.equal(duplicate.reused,true);
const cmds=(await req('/api/device',{vehicleId:'NF-A'},device)).data.requests;assert.equal(cmds[0].id,r.id);
assert.equal((await req('/api/device',{vehicleId:'NF-B',action:'monitorAck',id:r.id,status:'received'},device)).status,409);
for(const status of ['received','authorized'])assert.equal((await req('/api/device',{vehicleId:'NF-A',action:'monitorAck',id:r.id,status},device)).status,200);
assert.equal((await req('/api/device',{vehicleId:'NF-A',action:'monitorAck',id:r.id,status:'active'},device)).status,409);
await req('/api/telemetry',{vehicleId:'NF-A',lat:-34.6,lon:-58.4,speedKmh:0,monitoring:false,fixAgeMs:120000},device);
assert.equal((await req('/api/device',{vehicleId:'NF-A',action:'monitorAck',id:r.id,status:'active'},device)).status,409);
await req('/api/telemetry',{vehicleId:'NF-A',lat:-34.6,lon:-58.4,speedKmh:0,monitoring:false,fixAgeMs:0},device);
assert.equal((await req('/api/device',{vehicleId:'NF-A',action:'monitorAck',id:r.id,status:'active'},device)).status,200);
assert.equal((await req('/api/device',{vehicleId:'NF-A'},device)).data.requests.length,0);
assert.equal((await req('/api/dashcam/image?vehicleId=NF-A',null,device)).status,403);
assert.equal((await req('/api/dashcam/image?vehicleId=NF-A',null,office)).status,404);
let up=await fetch(base+'/api/dashcam/frame',{method:'POST',headers:{...device,'X-NF-Vehicle':'NF-A','X-NF-Lens':'back'},body:jpeg});assert.equal(up.status,403);
await req('/api/device',{vehicleId:'NF-A',profile:{remoteConsent:true,dashcamConsent:true}},device);
up=await fetch(base+'/api/dashcam/frame',{method:'POST',headers:{...device,'X-NF-Vehicle':'NF-A','X-NF-Lens':'front'},body:jpeg});assert.equal(up.status,403);
up=await fetch(base+'/api/dashcam/frame',{method:'POST',headers:{...device,'X-NF-Vehicle':'NF-A','X-NF-Lens':'back'},body:jpeg});assert.equal(up.status,200);
const image=await fetch(base+'/api/dashcam/image?vehicleId=NF-A',{headers:office});assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/jpeg');assert.equal((await image.arrayBuffer()).byteLength,jpeg.length);
await req('/api/device',{vehicleId:'NF-A',profile:{dashcamConsent:false}},device);assert.equal((await req('/api/dashcam/image?vehicleId=NF-A',null,office)).status,404);
}finally{proc.kill();await new Promise(r=>proc.once('exit',r));fs.rmSync(dir,{recursive:true,force:true})}
});
test('vencimiento de una solicitud no entregada no se muestra como activación',()=>{const fleet=require('./fleet');const state={requests:[{id:'x',vehicleId:'NF-A',status:'pending',expiresAt:Date.now()-1}]};assert.equal(fleet.pending(state,'NF-A').length,0);assert.equal(state.requests[0].status,'undelivered');assert.equal(fleet.ack(state,{vehicleId:'NF-A',id:'x',status:'active'}),false)});
