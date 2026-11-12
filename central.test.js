'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('telemetría, autorización, zonas, consentimiento, duplicados y persistencia',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nf-test-')),port=19000+Math.floor(Math.random()*1000),base=`http://127.0.0.1:${port}`;let proc;
 async function start(){proc=spawn(process.execPath,['server.js'],{cwd:__dirname,env:{...process.env,PORT:String(port),NF_TOKEN:'device-key',NF_ADMIN_TOKEN:'office-key',DATA_DIR:dir}});await new Promise((resolve,reject)=>{proc.stdout.once('data',resolve);proc.once('exit',()=>reject(Error('server failed')))});}
 async function stop(){proc.kill();await new Promise(r=>proc.once('exit',r))}
 async function req(p,d,auth={}){const r=await fetch(base+p,{method:d?'POST':'GET',headers:{'Content-Type':'application/json',...auth},body:d?JSON.stringify(d):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
 const device={Authorization:'Bearer device-key'};await start();
 try{
 assert.equal((await req('/api/state')).status,401);assert.equal((await req('/api/login',{key:'bad'})).status,401);
 const login=await req('/api/login',{key:'office-key'});assert.equal(login.status,200);const admin={Cookie:login.cookie};
 const t={vehicleId:'NF-TEST',lat:-34.5,lon:-58.5,speedKmh:20,monitoring:true,alert:'somnolencia_critica'};
 assert.equal((await req('/api/telemetry',t,device)).status,200);await req('/api/telemetry',t,device);
 let state=(await req('/api/state',null,admin)).data;assert.equal(state.vehicles.length,1);assert.equal(state.events.filter(e=>e.vehicleId==='NF-TEST').length,1);
 assert.equal((await req('/api/admin',{action:'zone',name:'X',lat:0,lon:0},device)).status,403);
 assert.equal((await req('/api/admin',{action:'alarm',vehicleId:t.vehicleId,at:Date.now()+3600000},admin)).status,409);
 await req('/api/telemetry',{...t,officeConsent:true,alarmEnabled:true},device);
 assert.equal((await req('/api/admin',{action:'alarm',vehicleId:t.vehicleId,at:Date.now()+3600000,mode:'program'},admin)).status,200);
 const z={vehicleId:t.vehicleId,action:'zoneRequest',requestId:123,name:'Base',lat:-34.5,lon:-58.5};await req('/api/device',z,device);await req('/api/device',z,device);
 state=(await req('/api/state',null,admin)).data;assert.equal(state.zones.length,1);assert.equal(state.zones[0].status,'pendiente');
 await req('/api/admin',{action:'zone',id:state.zones[0].id,status:'aprobada'},admin);
 let config=(await req('/api/device',{vehicleId:t.vehicleId},device)).data;assert.equal(config.zones[0].status,'aprobada');assert.equal(config.alarms.length,1);
 await req('/api/telemetry',{...t,officeConsent:false},device);config=(await req('/api/device',{vehicleId:t.vehicleId},device)).data;assert.equal(config.alarms.length,0);
 await req('/api/device',{vehicleId:'NF-SLEEP',profile:{officeConsent:true,alarmEnabled:true}},device);
 assert.equal((await req('/api/admin',{action:'alarm',vehicleId:'NF-SLEEP',at:Date.now()+3600000},admin)).status,200);
 await req('/api/device',{vehicleId:'NF-SLEEP',profile:{officeConsent:false}},device);
 assert.equal((await req('/api/admin',{action:'alarm',vehicleId:'NF-SLEEP',at:Date.now()+3600000},admin)).status,409);
 await stop();await start();state=(await req('/api/state',null,device)).data;assert.equal(state.vehicles[0].lat,t.lat);assert.equal(state.zones[0].status,'aprobada');
 }finally{await stop();fs.rmSync(dir,{recursive:true,force:true})}
});
