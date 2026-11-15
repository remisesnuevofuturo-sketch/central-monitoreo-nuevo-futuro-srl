'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=Number(process.env.PORT||8080), HOST=process.env.HOST||'0.0.0.0';
const extension=require('./operations'),fleet=require('./fleet');
const TOKEN=process.env.NF_TOKEN||'';
if(!TOKEN){console.error('Falta NF_TOKEN. Ejecutar INICIAR_CENTRAL.bat');process.exit(1)}
if(process.env.NF_ADMIN_TOKEN===TOKEN){console.error('NF_ADMIN_TOKEN debe ser diferente de NF_TOKEN');process.exit(1)}
const vehicles=new Map(extension.loadVehicles()), events=[]; const clients=new Set();
const DATA_FILE=path.join(process.env.DATA_DIR||path.join(__dirname,'data'),'eventos_guardados.jsonl');
try{for(const line of fs.readFileSync(DATA_FILE,'utf8').trim().split('\n').filter(Boolean).slice(-500)){const ev=JSON.parse(line);if(ev&&typeof ev.alert==='string')events.push(ev)}}catch(e){if(e.code!=='ENOENT')console.error('No se pudo cargar historial:',e.message)}
const send=(res,code,obj)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj))};
const broadcast=(data)=>{for(const c of clients){try{c.write('data: '+JSON.stringify(data)+'\n\n')}catch{clients.delete(c)}}};
function alertRecord(d,now,hasPosition){
 const deviceTime=Number.isFinite(d.occurredAt)&&d.occurredAt>0&&d.occurredAt<=now+300000;
 const age=Number.isFinite(d.alertFixAgeMs)&&d.alertFixAgeMs>=0?d.alertFixAgeMs:Number.isFinite(d.fixAgeMs)&&d.fixAgeMs>=0?d.fixAgeMs:null;
 const speed=hasPosition&&d.speedAvailable!==false&&Number.isFinite(d.speedKmh)&&d.speedKmh>=0&&d.speedKmh<=350?d.speedKmh:null;
 return {id:crypto.randomUUID(),alertId:typeof d.alertId==='string'&&/^[\w-]{1,64}$/.test(d.alertId)?d.alertId:null,
  vehicleId:d.vehicleId,driverName:typeof d.driverName==='string'?d.driverName.slice(0,80):'',alert:d.alert.slice(0,160),
  time:now,receivedAt:now,occurredAt:deviceTime?d.occurredAt:now,timeSource:deviceTime?'device':'received',
  lat:hasPosition?d.lat:null,lon:hasPosition?d.lon:null,speedKmh:speed,
  locationAgeMs:hasPosition?age:null,locationStatus:!hasPosition?'missing':age===null?'unknown':age>45000?'stale':'recent',
  accuracyM:hasPosition&&Number.isFinite(d.accuracyM)&&d.accuracyM>=0?d.accuracyM:null};
}
function snapshot(){const phases=JSON.stringify((extension.state.requests||[]).map(q=>q.status));fleet.pending(extension.state,'');if(phases!==JSON.stringify(extension.state.requests.map(q=>q.status)))extension.save();return {version:'0.12.5',controls:Object.fromEntries([...new Set([...vehicles.keys(),...Object.keys(extension.state.profiles)])].map(id=>[id,fleet.controlState(extension.state.profiles[id],vehicles.get(id))])),requests:extension.state.requests||[],drivers:Object.values(extension.state.profiles),zones:extension.state.zones,alarms:extension.state.alarms,alarmEvents:extension.state.alarmEvents,vehicles:[...vehicles.values()].map(v=>({...v,online:Date.now()-v.receivedAt<45000&&fleet.controlState(extension.state.profiles[v.vehicleId],v).gps!=='off'})),events:events.slice(-100).reverse(),serverTime:Date.now()}}
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(fleet.route(req,res,url,extension,vehicles,TOKEN,send,broadcast,snapshot))return;
 if(extension.route(req,res,url,vehicles,TOKEN,send,broadcast,snapshot))return;
 if(url.pathname.startsWith('/api/') && !extension.authorized(req,url,TOKEN))return send(res,401,{error:'Autenticación requerida'});
 if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return fs.createReadStream(path.join(__dirname,'index.html')).pipe(res)}
 if(req.method==='GET'&&url.pathname==='/api/state')return send(res,200,snapshot());
 if(req.method==='GET'&&url.pathname==='/api/alerts/export'){
  res.setHeader('Content-Disposition','attachment; filename="nuevo-futuro-alertas.json"');
  return send(res,200,{version:'0.12.5',timeZone:'America/Argentina/Buenos_Aires',exportedAt:Date.now(),events:events.slice().reverse()});
 }
 if(req.method==='GET'&&url.pathname==='/api/stream'){
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Content-Type-Options':'nosniff'});
  res.write('data: '+JSON.stringify(snapshot())+'\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return;
 }
 if(req.method==='POST'&&url.pathname==='/api/telemetry'){
  const provided=(req.headers.authorization||'').replace(/^Bearer /i,'');
  if(Buffer.byteLength(provided)!==Buffer.byteLength(TOKEN)||!crypto.timingSafeEqual(Buffer.from(provided),Buffer.from(TOKEN)))return send(res,401,{error:'Token incorrecto'});
  let body='';req.on('data',c=>{body+=c;if(body.length>12000)req.destroy()});req.on('end',()=>{
   let d;try{d=JSON.parse(body)}catch{return send(res,400,{error:'JSON invalido'})}
   if(!d||typeof d!=='object'||Array.isArray(d))return send(res,400,{error:'Datos invalidos'});
   const hasAlert=typeof d.alert==='string'&&!!d.alert.trim();
   const hasPosition=Number.isFinite(d.lat)&&Number.isFinite(d.lon)&&Math.abs(d.lat)<=90&&Math.abs(d.lon)<=180;
   const noPosition=d.lat==null&&d.lon==null;
   if(!fleet.validId(d.vehicleId)||(!hasPosition&&!(hasAlert&&noPosition)))return send(res,400,{error:'Datos invalidos'});
   const now=Date.now();
   if(hasPosition){
    const v={vehicleId:d.vehicleId,lat:d.lat,lon:d.lon,speedKmh:Number.isFinite(d.speedKmh)?Math.max(0,Math.min(350,d.speedKmh)):0,monitoring:d.monitoring===true,driverName:typeof d.driverName==='string'?d.driverName.slice(0,80):'',receivedAt:now,fixAt:Number.isFinite(d.fixAgeMs)&&d.fixAgeMs>=0?now-d.fixAgeMs:now,online:true};
    if(!vehicles.has(v.vehicleId)&&vehicles.size>=200)return send(res,429,{error:'Demasiados móviles'});
    Object.assign(v,extension.vehicleFields(d));vehicles.set(v.vehicleId,v);extension.persistVehicles(vehicles);
   }
   if(hasAlert&&!events.some(e=>e.vehicleId===d.vehicleId&&((d.alertId&&e.alertId===d.alertId)||(e.alert===d.alert.slice(0,160)&&now-e.time<60000)))){
    const event=alertRecord(d,now,hasPosition);events.push(event);if(events.length>500)events.shift();
    fs.appendFile(DATA_FILE,JSON.stringify(event)+'\n',err=>{if(err)console.error('No se pudo guardar evento:',err.message)});
   }
   broadcast(snapshot());send(res,200,{ok:true,receivedAt:now});
  });return;
 }
 send(res,404,{error:'No encontrado'});
});
setInterval(()=>broadcast(snapshot()),15000);
server.listen(PORT,HOST,()=>console.log(`Central Nuevo Futuro: http://localhost:${PORT} | Red local: puerto ${PORT}`));
