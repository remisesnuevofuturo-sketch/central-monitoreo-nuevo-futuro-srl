'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
let JSDOM;try{({JSDOM}=require('jsdom'))}catch{}
function page(state){return new JSDOM(fs.readFileSync(__dirname+'/index.html','utf8').replace(/<script src="[^"]*"><\/script>/g,''),{url:'http://qa.local',runScripts:'dangerously',beforeParse(w){w.fetch=async()=>({ok:true,json:async()=>state});w.EventSource=class{};w.setInterval=()=>0;w.confirm=()=>false;}});}
test('hora argentina 24 h y enlaces inmutables en alertas generales y del chofer',{skip:!JSDOM},async()=>{
 const time=Date.parse('2026-11-15T17:50:05Z');const vehicle={vehicleId:'NF-A',driverName:'Ale',lat:-35,lon:-59,speedKmh:0,receivedAt:time,online:true};
 const events=[{vehicleId:'NF-A',driverName:'Ale',alert:'exceso_100_kmh',time,occurredAt:time,receivedAt:time+120000,timeSource:'device',lat:-34.45262,lon:-58.56238,speedKmh:108.4,locationAgeMs:1000,locationStatus:'recent'}, {vehicleId:'NF-A',alert:'old',time:time-1000}, {vehicleId:'NF-A',alert:'posible_cansancio',time:time-2000,lat:-34,lon:-58,locationAgeMs:90000,locationStatus:'stale'}, {vehicleId:'NF-B',alert:'other',time}];
 const dom=page({vehicles:[vehicle],drivers:[vehicle],events});const w=dom.window;await new Promise(r=>setTimeout(r,25));
 const all=w.document.getElementById('events');assert(all.textContent.includes('14:50:05'));assert(!all.textContent.includes('02:50:05'));assert(all.textContent.includes('108,4 km/h'));assert(all.textContent.includes('máxima operativa 100 km/h'));assert(all.textContent.includes('Recibida en central:'));assert(all.textContent.includes('Sin ubicación registrada'));assert(all.textContent.includes('GPS anterior a la alerta (90 s)'));
 const a=all.querySelector('a.event-map'),url=new URL(a.href);assert.equal(url.searchParams.get('query'),'-34.45262,-58.56238');assert.equal(url.hostname,'www.google.com');assert.equal(a.target,'_blank');assert(a.rel.includes('noopener'));
 const select=w.document.getElementById('mobileVehicle');select.value='NF-A';select.dispatchEvent(new w.Event('change'));
 const own=w.document.getElementById('selectedAlerts');assert.equal(own.children.length,3);assert(!own.textContent.includes('other'));assert.equal(own.querySelector('a').href,a.href);
 assert(w.document.getElementById('details').textContent.includes('15/11/2026, 14:50:05'));
 // UTC day rollover, midnight and noon must never become ambiguous 12-hour output.
 assert.equal(w.formatArgentina(Date.parse('2026-11-16T02:05:00Z')),'15/11/2026, 23:05:00');
 assert.equal(w.formatArgentina(Date.parse('2026-11-15T03:05:00Z')),'15/11/2026, 00:05:00');
 assert.equal(w.formatArgentina(Date.parse('2026-11-15T15:05:00Z')),'15/11/2026, 12:05:00');
 assert.equal(w.formatArgentina(null),'Sin hora registrada');dom.window.close();
});
test('datos de alertas no ejecutan HTML ni crean enlaces con coordenadas inválidas',{skip:!JSDOM},async()=>{
 const dom=page({vehicles:[],events:[{vehicleId:'<img src=x onerror=alert(1)>',alert:'<script>alert(1)</script>',time:Date.now(),lat:'javascript:alert(1)',lon:0}]});
 await new Promise(r=>setTimeout(r,25));const el=dom.window.document.getElementById('events');assert.equal(el.querySelectorAll('script,img,a').length,0);assert(el.textContent.includes('<script>'));assert(el.textContent.includes('Sin ubicación registrada'));dom.window.close();
});
