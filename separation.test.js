'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {controlState}=require('./fleet');
test('GPS y cámara independientes; datos antiguos y modelos anteriores no simulan actividad',()=>{
 const now=1000000,v={receivedAt:now,fixAt:now};let p={protocolVersion:12,lastSeen:now,gpsSharing:false,gpsActive:false,monitorActive:true,monitorState:'active'};
 assert.deepEqual([controlState(p,v,now).gps,controlState(p,v,now).camera],['off','active']);
 p={...p,gpsSharing:true,gpsActive:true,monitorActive:false};assert.deepEqual([controlState(p,v,now).gps,controlState(p,v,now).camera],['active','off']);
 assert.equal(controlState(p,{...v,fixAt:now-50000},now).gps,'waiting');assert.equal(controlState({...p,lastSeen:now-100000},v,now).camera,'stale');assert.equal(controlState({lastSeen:now,protocolVersion:10},{...v,monitoring:true},now).camera,'unknown');
 for(const state of ['paused','interrupted','starting'])assert.equal(controlState({...p,monitorActive:true,monitorState:state},v,now).camera,state);
});
test('API real: consentimiento, solicitud GPS, seguimiento confirmado, apagado y persistencia',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nf-separated-')),port=28000+Math.floor(Math.random()*2000),base=`http://127.0.0.1:${port}`;let proc;
 async function start(){proc=spawn(process.execPath,['server.js'],{cwd:__dirname,env:{...process.env,DATA_DIR:dir,NF_TOKEN:'test-device',NF_ADMIN_TOKEN:'test-office',PORT:String(port)}});await new Promise((r,j)=>{proc.stdout.once('data',r);proc.once('exit',()=>j(Error('No inició')))})}
 async function stop(){const exited=new Promise(r=>proc.once('exit',r));proc.kill();await exited}
 async function req(p,d,h={}){const r=await fetch(base+p,{method:d?'POST':'GET',headers:{'Content-Type':'application/json',...h},body:d?JSON.stringify(d):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
 const device={Authorization:'Bearer test-device'};await start();try{
 let office={Cookie:(await req('/api/login',{key:'test-office'})).cookie};const profile={protocolVersion:12,remoteConsent:true,gpsSharing:false,gpsActive:false,monitorActive:false,monitorState:'off'};
 assert.equal((await req('/api/device',{vehicleId:'__proto__',profile},device)).status,401);await req('/api/device',{vehicleId:'NF-X',profile},device);
 assert.equal((await req('/api/monitor-request',{vehicleId:'NF-X',kind:'camera'},office)).status,400);
 const q=(await req('/api/monitor-request',{vehicleId:'NF-X',kind:'gps'},office)).data.request;assert.equal(q.kind,'gps');let s=(await req('/api/state',null,office)).data;assert.equal(s.controls['NF-X'].camera,'off');assert.equal(s.controls['NF-X'].gps,'off');
 for(const status of ['received','authorized'])assert.equal((await req('/api/device',{vehicleId:'NF-X',action:'monitorAck',id:q.id,status},device)).status,200);
 assert.equal((await req('/api/device',{vehicleId:'NF-X',action:'monitorAck',id:q.id,status:'active'},device)).status,409);
 await req('/api/telemetry',{vehicleId:'NF-X',lat:-34.6,lon:-58.5,fixAgeMs:0,monitoring:false},device);
 assert.equal((await req('/api/device',{vehicleId:'NF-X',action:'monitorAck',id:q.id,status:'active',profile:{...profile,gpsSharing:true,gpsActive:true}},device)).status,200);
 s=(await req('/api/state',null,office)).data;assert.equal(s.controls['NF-X'].gps,'active');assert.equal(s.controls['NF-X'].camera,'off');assert.equal(s.requests[0].history.length,4);
 await req('/api/device',{vehicleId:'NF-X',profile:{...profile,monitorActive:true,monitorState:'active'}},device);s=(await req('/api/state',null,office)).data;assert.equal(s.controls['NF-X'].gps,'off');assert.equal(s.controls['NF-X'].camera,'active');assert.equal(s.vehicles[0].online,false);
 await stop();await start();office={Cookie:(await req('/api/login',{key:'test-office'})).cookie};s=(await req('/api/state',null,office)).data;assert.equal(s.vehicles[0].lat,-34.6);assert.equal(s.controls['NF-X'].gps,'off');assert.equal(s.requests[0].kind,'gps');
 }finally{await stop();fs.rmSync(dir,{recursive:true,force:true})}
});
