"use strict";
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const dir=process.env.DATA_DIR||path.join(__dirname,'data');fs.mkdirSync(dir,{recursive:true});
function read(name,fallback){try{return JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;return fallback}}
function write(name,data){const p=path.join(dir,name);fs.writeFileSync(p+'.tmp',JSON.stringify(data));fs.renameSync(p+'.tmp',p)}
const state=read('operations.json',{zones:[],alarms:[],alarmEvents:[]});
state.profiles=state.profiles||{};
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
function authorized(req,url,token){return equal((req.headers.authorization||'').replace(/^Bearer /i,''),token)||equal(req.headers.cookie?.split('; ').find(x=>x.startsWith('nf_session='))?.slice(11),session)}
function operator(req){return equal(req.headers.cookie?.split('; ').find(x=>x.startsWith('nf_session='))?.slice(11),session)}
const failures=new Map();
const session=crypto.randomBytes(32).toString('hex');
const save=()=>write('operations.json',state);
function vehicleFields(d){return {safeZone:d.safeZone===true,alarmEnabled:d.alarmEnabled===true,officeConsent:d.officeConsent===true,preparationMinutes:Number.isInteger(d.preparationMinutes)?d.preparationMinutes:30,protocolVersion:d.protocolVersion===11?11:10,remoteConsent:d.remoteConsent===true,gpsActive:d.gpsActive===true,shiftActive:d.shiftActive===true,dashcamConsent:d.dashcamConsent===true,dashcamStatus:String(d.dashcamStatus||'inactiva').slice(0,160),lastFixAt:Number.isFinite(d.lastFixAt)?d.lastFixAt:0}}
function route(req,res,url,vehicles,token,send,broadcast,snapshot){
 const p=url.pathname;if(!['/api/login','/api/logout','/api/admin','/api/device'].includes(p))return false;
 if(req.method!=='POST'){send(res,405,{error:'Usar POST'});return true}
 let body='';req.on('data',c=>{body+=c;if(body.length>64000)req.destroy()});req.on('end',()=>{
 try{const d=JSON.parse(body);
 if(p==='/api/login'){const ip=req.socket.remoteAddress,attempt=failures.get(ip)||{count:0,at:Date.now()};if(Date.now()-attempt.at>900000){attempt.count=0;attempt.at=Date.now()}if(attempt.count>=5)return send(res,429,{error:'Demasiados intentos. Esperá 15 minutos'});attempt.count++;failures.set(ip,attempt);if(!equal(d.key,process.env.NF_ADMIN_TOKEN||'' )||!process.env.NF_ADMIN_TOKEN)return send(res,401,{error:'Clave incorrecta'});failures.delete(ip);res.setHeader('Set-Cookie',`nf_session=${session}; HttpOnly; SameSite=Strict; Path=/${process.env.NODE_ENV==='production'?'; Secure':''}`);return send(res,200,{ok:true})}
 if(p==='/api/logout'){res.setHeader('Set-Cookie','nf_session=; Max-Age=0; Path=/');return send(res,200,{ok:true})}
 const device=equal((req.headers.authorization||'').replace(/^Bearer /i,''),token);
 if(p==='/api/device'){
 if(!device||typeof d.vehicleId!=='string'||!/^[-\w ]{1,30}$/.test(d.vehicleId))return send(res,401,{error:'No autorizado'});
 if(d.profile){state.profiles[d.vehicleId]={...vehicleFields(d.profile),vehicleId:d.vehicleId,driverName:String(d.profile.driverName||'').slice(0,80),lastSeen:Date.now()}}
 if(d.action==='zoneRequest'){
 if(typeof d.name!=='string'||!d.name.trim()||!Number.isFinite(d.lat)||Math.abs(d.lat)>90||!Number.isFinite(d.lon)||Math.abs(d.lon)>180) return send(res,400,{error:'Zona inválida'});
 if(!state.zones.some(z=>z.requestId===d.requestId&&z.vehicleId===d.vehicleId))state.zones.push({id:Date.now(),requestId:d.requestId,name:d.name.slice(0,70),lat:d.lat,lon:d.lon,radius:100,status:'pendiente',vehicleId:d.vehicleId});
 }
 if(d.action==='alarmEvent'&&['scheduled','ringing','dismissed','cancelled','permission_required'].includes(d.event)){
 if(!state.alarmEvents.some(e=>e.eventId===d.eventId&&e.vehicleId===d.vehicleId))state.alarmEvents.push({vehicleId:d.vehicleId,eventId:d.eventId,event:d.event,alarmId:d.alarmId,occurredAt:Number.isFinite(d.occurredAt)?d.occurredAt:Date.now(),time:Date.now()});state.alarmEvents=state.alarmEvents.slice(-2000);
 }
 if(d.action==='monitorAck'){if(d.status==='active'){const q=(state.requests||[]).find(q=>q.id===d.id&&q.vehicleId===d.vehicleId),v=vehicles.get(d.vehicleId);if(!v||Date.now()-v.receivedAt>45000||Date.now()-(v.fixAt||0)>45000||(v.fixAt||0)<(q?.createdAt||Infinity))return send(res,409,{error:'Falta telemetría GPS reciente para confirmar activación'})}if(!require('./fleet').ack(state,d))return send(res,409,{error:'Transición de solicitud inválida'})}
 if(d.action==='ack') {const a=state.alarms.find(a=>a.id===d.id&&a.vehicleId===d.vehicleId);if(a)a.status=d.status==='accepted'?'accepted':'rejected'}
 const requests=require('./fleet').pending(state,d.vehicleId);save();return send(res,200,{requests,zones:state.zones.filter(z=>!z.vehicleId||z.vehicleId===d.vehicleId),alarms:(state.profiles[d.vehicleId]||vehicles.get(d.vehicleId))?.officeConsent?state.alarms.filter(a=>a.vehicleId===d.vehicleId&&a.status==='pending'):[]});
 }
 // Administrative writes require the operator session, never the telemetry key.
 if(!equal(req.headers.cookie?.split('; ').find(x=>x.startsWith('nf_session='))?.slice(11),session))return send(res,403,{error:'Sesión administrativa requerida'});
 if(d.action==='zone'){
 let z=state.zones.find(z=>z.id===d.id);
 if(d.delete){state.zones=state.zones.filter(z=>z.id!==d.id)}else{
 const n={id:z?.id||Date.now(),name:String(d.name||z?.name||'').slice(0,70),lat:d.lat??z?.lat,lon:d.lon??z?.lon,radius:d.radius??z?.radius??100,status:d.status||z?.status||'aprobada',vehicleId:z?.vehicleId||''};
 if(!n.name||!Number.isFinite(n.lat)||Math.abs(n.lat)>90||!Number.isFinite(n.lon)||Math.abs(n.lon)>180||!Number.isFinite(n.radius)||n.radius<30||n.radius>1000||!['pendiente','aprobada','rechazada'].includes(n.status))return send(res,400,{error:'Zona inválida'});
 if(z)Object.assign(z,n);else state.zones.push(n);
 }
 }else if(d.action==='alarm'){
 const v=state.profiles[d.vehicleId]||vehicles.get(d.vehicleId);if(!v?.officeConsent||Date.now()-(v.lastSeen||v.receivedAt)>20*60000)return send(res,409,{error:'El conductor debe estar conectado y autorizar alarmas de oficina'});
 if(!Number.isFinite(d.at)||d.at<Date.now()+60000)return send(res,400,{error:'Horario inválido'});
 state.alarms.push({id:crypto.randomUUID(),vehicleId:d.vehicleId,at:d.at,mode:d.mode==='program'?'program':'suggest',status:'pending',createdAt:Date.now()});
 }else return send(res,400,{error:'Acción inválida'});
 save();broadcast(snapshot());send(res,200,{ok:true});
 }catch(e){send(res,400,{error:'Solicitud inválida'})}
 });return true;
}
module.exports={state,save,equal,operator,route,authorized,vehicleFields,loadVehicles:()=>read('vehicles.json',[]),persistVehicles:v=>write('vehicles.json',[...v])};
