'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('alerta conserva hora, velocidad y lugar aunque el móvil se mueva; exportación y reinicio',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nf-alerts-')),port=25000+Math.floor(Math.random()*1000),base=`http://127.0.0.1:${port}`;let proc;
 const device={Authorization:'Bearer device-test'};
 async function start(){proc=spawn(process.execPath,['server.js'],{cwd:__dirname,env:{...process.env,PORT:String(port),DATA_DIR:dir,NF_TOKEN:'device-test',NF_ADMIN_TOKEN:'office-test'}});await new Promise((r,j)=>{proc.stdout.once('data',r);proc.once('exit',()=>j(Error('No inició')))});}
 async function stop(){const exit=new Promise(r=>proc.once('exit',r));proc.kill();await exit;}
 async function request(p,d,headers=device){const r=await fetch(base+p,{method:d===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},body:d===undefined?undefined:JSON.stringify(d)});return {status:r.status,data:await r.json(),disposition:r.headers.get('content-disposition')};}
 await start();try{
  const detected=Date.now()-120000;
  const alert={vehicleId:'NF-TEST',driverName:'Chofer prueba',alert:'exceso_100_kmh',lat:-34.45262,lon:-58.56238,speedKmh:108.4,speedAvailable:true,occurredAt:detected,alertId:'fixed-event-id',fixAgeMs:121000,alertFixAgeMs:1000,accuracyM:8};
  assert.equal((await request('/api/telemetry',alert)).status,200);
  await request('/api/telemetry',alert);
  await request('/api/telemetry',{vehicleId:'NF-TEST',lat:-35,lon:-59,speedKmh:35,fixAgeMs:0});
  let state=(await request('/api/state')).data;
  assert.equal(state.version,'0.12.8');assert.equal(state.events.length,1);
  const e=state.events[0];assert.equal(e.lat,alert.lat);assert.equal(e.lon,alert.lon);assert.equal(e.speedKmh,108.4);assert.equal(e.occurredAt,detected);assert(e.receivedAt>detected);assert.equal(e.locationStatus,'recent');assert.equal(e.accuracyM,8);assert.equal(e.timeSource,'device');assert.equal(state.vehicles[0].lat,-35);
  await request('/api/telemetry',{vehicleId:'NF-TEST',alert:'posible_cansancio',lat:-34,lon:-58,fixAgeMs:90000,speedAvailable:false,speedKmh:0});
  await request('/api/telemetry',{vehicleId:'NF-TEST',alert:'rostro_no_visible',occurredAt:Date.now()});
  state=(await request('/api/state')).data;
  const missing=state.events.find(e=>e.alert==='rostro_no_visible'),stale=state.events.find(e=>e.alert==='posible_cansancio');
  assert.equal(missing.lat,null);assert.equal(missing.lon,null);assert.equal(missing.speedKmh,null);assert.equal(missing.locationStatus,'missing');assert.equal(stale.locationStatus,'stale');assert.equal(stale.speedKmh,null);assert.equal(stale.timeSource,'received');assert.equal(state.vehicles[0].lat,-34);
  for(const bad of [{lat:91,lon:0},{lat:'-34',lon:-58},{lat:1},{lat:null,lon:1}])assert.equal((await request('/api/telemetry',{vehicleId:'NF-TEST',alert:'bad',...bad})).status,400);
  assert.equal((await request('/api/telemetry',{vehicleId:'NF-TEST'})).status,400);
  assert.equal((await request('/api/alerts/export',undefined,{})).status,401);
  let exported=await request('/api/alerts/export');assert.equal(exported.status,200);assert(exported.disposition.includes('attachment'));assert.equal(exported.data.events.length,3);assert.equal(exported.data.timeZone,'America/Argentina/Buenos_Aires');
  await new Promise(r=>setTimeout(r,50));await stop();
  // Older records must remain readable without inventing coordinates from today's vehicle.
  fs.appendFileSync(path.join(dir,'eventos_guardados.jsonl'),JSON.stringify({vehicleId:'NF-TEST',alert:'old',time:detected-1000})+'\n');
  await start();state=(await request('/api/state')).data;
  assert.equal(state.events.find(e=>e.alert==='exceso_100_kmh').lat,alert.lat);assert.equal(state.events.find(e=>e.alert==='old').lat,undefined);
  exported=await request('/api/alerts/export');assert.equal(exported.data.events.length,4);
 }finally{await stop();fs.rmSync(dir,{recursive:true,force:true});}
});
