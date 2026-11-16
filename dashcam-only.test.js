'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('dashcam sola sin GPS ni frontal; detenerla invalida imagen previa y rechaza envíos tardíos',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nf-road-only-')),port=31000+Math.floor(Math.random()*2000),base=`http://127.0.0.1:${port}`;
 const proc=spawn(process.execPath,['server.js'],{cwd:__dirname,env:{...process.env,DATA_DIR:dir,NF_TOKEN:'road-device-test',NF_ADMIN_TOKEN:'road-office-test',PORT:String(port)}});
 await new Promise((r,j)=>{proc.stdout.once('data',r);proc.once('exit',()=>j(Error('No inició')))})
 const device={Authorization:'Bearer road-device-test'},jpeg=fs.readFileSync(path.join(__dirname,'test-fixtures/road.jpg'));
 async function req(p,d,h={}){const r=await fetch(base+p,{method:d?'POST':'GET',headers:{'Content-Type':'application/json',...h},body:d?JSON.stringify(d):undefined});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
 const frame=()=>fetch(base+'/api/dashcam/frame',{method:'POST',headers:{...device,'X-NF-Vehicle':'NF-ROAD','X-NF-Lens':'back'},body:jpeg});
 try{
 const office={Cookie:(await req('/api/login',{key:'road-office-test'})).cookie};
 const profile={protocolVersion:12,dashcamConsent:true,dashcamActive:true,monitorActive:false,monitorState:'off',gpsSharing:false,gpsActive:false};
 await req('/api/device',{vehicleId:'NF-ROAD',profile},device);assert.equal((await frame()).status,200);
 assert.equal((await fetch(base+'/api/dashcam/image?vehicleId=NF-ROAD',{headers:office})).status,200);
 const s=(await req('/api/state',null,office)).data;assert.equal(s.vehicles.length,0);assert.equal(s.controls['NF-ROAD'].camera,'off');assert.equal(s.controls['NF-ROAD'].gps,'off');
 await req('/api/device',{vehicleId:'NF-ROAD',profile:{...profile,dashcamActive:false}},device);
 assert.equal((await fetch(base+'/api/dashcam/image?vehicleId=NF-ROAD',{headers:office})).status,404);assert.equal((await frame()).status,403);
 await req('/api/device',{vehicleId:'NF-ROAD',profile},device);
 assert.equal((await fetch(base+'/api/dashcam/image?vehicleId=NF-ROAD',{headers:office})).status,404,'Se exige una imagen nueva');
 }finally{const exited=new Promise(r=>proc.once('exit',r));proc.kill();await exited;fs.rmSync(dir,{recursive:true,force:true})}
});
