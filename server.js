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
function snapshot(){fleet.pending(extension.state,'');return {requests:extension.state.requests||[],drivers:Object.values(extension.state.profiles),zones:extension.state.zones,alarms:extension.state.alarms,alarmEvents:extension.state.alarmEvents,vehicles:[...vehicles.values()].map(v=>({...v,online:Date.now()-v.receivedAt<45000})),events:events.slice(-100).reverse(),serverTime:Date.now()}}
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(fleet.route(req,res,url,extension,vehicles,TOKEN,send,broadcast,snapshot))return;
 if(extension.route(req,res,url,vehicles,TOKEN,send,broadcast,snapshot))return;
 if(url.pathname.startsWith('/api/') && !extension.authorized(req,url,TOKEN))return send(res,401,{error:'Autenticación requerida'});
 if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return fs.createReadStream(path.join(__dirname,'index.html')).pipe(res)}
 if(req.method==='GET'&&url.pathname==='/api/state')return send(res,200,snapshot());
 if(req.method==='GET'&&url.pathname==='/api/stream'){
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Content-Type-Options':'nosniff'});
  res.write('data: '+JSON.stringify(snapshot())+'\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return;
 }
 if(req.method==='POST'&&url.pathname==='/api/telemetry'){
  const provided=(req.headers.authorization||'').replace(/^Bearer /i,'');
  if(Buffer.byteLength(provided)!==Buffer.byteLength(TOKEN)||!crypto.timingSafeEqual(Buffer.from(provided),Buffer.from(TOKEN)))return send(res,401,{error:'Token incorrecto'});
  let body='';req.on('data',c=>{body+=c;if(body.length>12000)req.destroy()});req.on('end',()=>{
   let d;try{d=JSON.parse(body)}catch{return send(res,400,{error:'JSON invalido'})}
   if(typeof d.vehicleId!=='string'||!/^[-\w ]{1,30}$/.test(d.vehicleId)||!Number.isFinite(d.lat)||!Number.isFinite(d.lon)||Math.abs(d.lat)>90||Math.abs(d.lon)>180)return send(res,400,{error:'Datos invalidos'});
   const now=Date.now(),v={vehicleId:d.vehicleId,lat:d.lat,lon:d.lon,speedKmh:Number.isFinite(d.speedKmh)?Math.max(0,Math.min(350,d.speedKmh)):0,monitoring:d.monitoring===true,driverName:typeof d.driverName==='string'?d.driverName.slice(0,80):'',receivedAt:now,fixAt:Number.isFinite(d.fixAgeMs)&&d.fixAgeMs>=0?now-d.fixAgeMs:now,online:true};if(!vehicles.has(v.vehicleId)&&vehicles.size>=200)return send(res,429,{error:'Demasiados móviles'});Object.assign(v,extension.vehicleFields(d));vehicles.set(v.vehicleId,v);extension.persistVehicles(vehicles);
   if(typeof d.alert==='string'&&d.alert.trim() && !events.some(e=>e.vehicleId===v.vehicleId&&e.alert===d.alert.slice(0,160)&&now-e.time<60000)){const event={vehicleId:v.vehicleId,alert:d.alert.slice(0,160),time:now};events.push(event);if(events.length>500)events.shift();fs.appendFile(DATA_FILE,JSON.stringify(event)+'\n',err=>{if(err)console.error('No se pudo guardar evento:',err.message)})}
   broadcast(snapshot());send(res,200,{ok:true,receivedAt:now});
  });return;
 }
 send(res,404,{error:'No encontrado'});
});
setInterval(()=>broadcast(snapshot()),15000);
server.listen(PORT,HOST,()=>console.log(`Central Nuevo Futuro: http://localhost:${PORT} | Red local: puerto ${PORT}`));
