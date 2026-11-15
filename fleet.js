"use strict";
const crypto=require('crypto');
const frames=new Map();
function validId(id){return typeof id==='string'&&/^[-\w ]{1,30}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id)}
function pending(state,id){state.requests=state.requests||[];for(const q of state.requests){if(['pending','received','authorized'].includes(q.status)&&Date.now()>q.expiresAt){q.status=q.status==='pending'?'undelivered':'expired';q.updatedAt=Date.now();(q.history=q.history||[]).push({status:q.status,at:q.updatedAt})}}return state.requests.filter(q=>q.vehicleId===id&&['pending','received','authorized'].includes(q.status))}
function ack(state,d){const q=(state.requests||[]).find(q=>q.id===d.id&&q.vehicleId===d.vehicleId);if(!q)return false;
 const allowed={pending:['received'],received:['authorized','rejected','failed','stopped'],authorized:['active','failed','rejected','stopped'],active:['stopped']};
 if(q.status===d.status)return true;if(d.status==='received'&&q.status!=='pending')return true;if(d.status==='authorized'&&['active','stopped'].includes(q.status))return true;if(!(allowed[q.status]||[]).includes(d.status)||Date.now()>q.expiresAt&&q.status!=='active')return false;
 q.status=d.status;q.updatedAt=Date.now();q[d.status+'At']=Date.now();q.reason=String(d.reason||'').slice(0,160);(q.history=q.history||[]).push({status:q.status,at:q.updatedAt,reason:q.reason});return true}
function route(req,res,url,ops,vehicles,token,send,broadcast,snapshot){
 if(!['/api/monitor-request','/api/dashcam/frame','/api/dashcam/image'].includes(url.pathname))return false;
 const office=ops.operator(req),device=ops.equal((req.headers.authorization||'').replace(/^Bearer /i,''),token);
 if(url.pathname==='/api/dashcam/image'){
 if(req.method!=='GET'||!office){send(res,403,{error:'Sesión de oficina requerida'});return true}
 const id=url.searchParams.get('vehicleId'),f=frames.get(id),profile=ops.state.profiles[id];
 if(!profile?.dashcamConsent||profile.dashcamActive===false||!f||Date.now()-f.at>15000){send(res,404,{error:'Sin imagen reciente autorizada'});return true}
 res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(f.jpeg);return true;
 }
 if(req.method!=='POST'){send(res,405,{error:'Usar POST'});return true}
 if(url.pathname==='/api/monitor-request'&&!office||url.pathname==='/api/dashcam/frame'&&!device){send(res,403,{error:'No autorizado'});return true}
 let bytes=0,chunks=[];req.on('data',c=>{bytes+=c.length;if(bytes>180000)req.destroy();else chunks.push(c)});req.on('end',()=>{try{
 if(url.pathname==='/api/dashcam/frame'){
 const id=req.headers['x-nf-vehicle'],p=ops.state.profiles[id],jpeg=Buffer.concat(chunks);
 if(!validId(id)||!p?.dashcamConsent||p.dashcamActive===false||Date.now()-p.lastSeen>90000||req.headers['x-nf-lens']!=='back')return send(res,403,{error:'Sin autorización de cámara trasera vigente'});
 if(process.env.NODE_ENV==='production'&&req.headers['x-forwarded-proto']!=='https'&&!req.socket.encrypted)return send(res,403,{error:'HTTPS requerido'});
 if(jpeg.length<4||jpeg[0]!==255||jpeg[1]!==216||jpeg[jpeg.length-2]!==255||jpeg[jpeg.length-1]!==217)return send(res,400,{error:'JPEG inválido'});
 const old=frames.get(id);if(old&&Date.now()-old.at<1500)return send(res,429,{error:'Máximo una imagen cada 2 segundos'});
 frames.set(id,{jpeg,at:Date.now()});p.dashcamFrameAt=Date.now();return send(res,200,{ok:true});
 }
 const d=JSON.parse(Buffer.concat(chunks));if(!validId(d.vehicleId))return send(res,400,{error:'Móvil inválido'});
 if(d.kind!==undefined&&d.kind!=='gps')return send(res,400,{error:'Solo se permiten solicitudes GPS; la cámara se inicia en el teléfono'});
 const p=ops.state.profiles[d.vehicleId];if(!p?.remoteConsent)return send(res,409,{error:'El conductor debe habilitar solicitudes de oficina en el teléfono'});
 const pendingRequest=pending(ops.state,d.vehicleId)[0];if(pendingRequest)return send(res,200,{request:pendingRequest,reused:true});
 const q={id:crypto.randomUUID(),vehicleId:d.vehicleId,kind:'gps',status:'pending',history:[{status:'pending',at:Date.now()}],createdAt:Date.now(),updatedAt:Date.now(),expiresAt:Date.now()+30*60000};ops.state.requests.push(q);ops.state.requests=ops.state.requests.slice(-1000);ops.save();broadcast(snapshot());send(res,200,{request:q});
 }catch{send(res,400,{error:'Solicitud inválida'})}});return true;
}
setInterval(()=>{for(const [id,f] of frames)if(Date.now()-f.at>15000)frames.delete(id)},10000).unref();
function controlState(profile, vehicle, now=Date.now()){
 const connected=Boolean(profile&&now-profile.lastSeen<90000);
 const modern=profile?.protocolVersion>=11;
 let gps='unknown',camera='unknown';
 if(modern){
  if(!connected)gps='stale';
  else if(profile.gpsSharing===false)gps='off';
  else if(profile.gpsActive&&vehicle&&now-vehicle.receivedAt<45000&&now-vehicle.fixAt<45000)gps='active';
  else gps='waiting';
 }
 if(profile?.protocolVersion>=12&&typeof profile.monitorActive==='boolean')camera=connected?(profile.monitorActive?(['active','paused','interrupted','starting'].includes(profile.monitorState)?profile.monitorState:'unknown'):'off'):'stale';
 return {connected,gps,camera,lastContactAt:profile?.lastSeen||vehicle?.receivedAt||0,lastLocationAt:vehicle?.fixAt||0};
}
module.exports={route,pending,ack,validId,controlState,clearFrame:id=>frames.delete(id)};
