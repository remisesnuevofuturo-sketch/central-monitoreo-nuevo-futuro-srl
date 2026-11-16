'use strict';
const hosts=new Set(['www.google.com','google.com','maps.google.com','www.google.com.ar','google.com.ar']);
function allowed(raw){try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&((hosts.has(u.hostname)&&u.pathname.startsWith('/maps'))||(u.hostname==='maps.app.goo.gl'&&u.pathname.length>1)||(u.hostname==='goo.gl'&&u.pathname.startsWith('/maps/')))}catch{return false}}
const num='[-+]?\\d+(?:\\.\\d+)?';
function point(a,b,approximate=false){const lat=Number(a),lon=Number(b);return Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180?{lat,lon,approximate}:null}
function parse(raw){if(typeof raw!=='string'||raw.length>4096||!allowed(raw.trim()))return null;const u=new URL(raw.trim());for(const key of ['destination','query','q']){const val=u.searchParams.get(key);if(!val)continue;const m=val.match(new RegExp(`^(${num}),\\s*(${num})$`));if(m)return point(m[1],m[2])}
 const decoded=decodeURIComponent(u.href);const matches=[...decoded.matchAll(new RegExp(`!3d(${num})!4d(${num})`,'g'))];if(matches.length){const m=matches.at(-1);return point(m[1],m[2])}
 // A viewport centre is only a candidate: the operator must verify it on the map.
 const centre=decoded.match(new RegExp(`@(${num}),(${num}),`));return centre?point(centre[1],centre[2],true):null;
}
async function resolve(raw,fetcher=fetch){if(typeof raw!=='string'||raw.length>4096)throw Error('Pegá un enlace de Google Maps válido.');let url=raw.trim();for(let i=0;i<5;i++){if(!allowed(url))throw Error('Usá un enlace HTTPS de Google Maps.');const location=parse(url);if(location)return location;const response=await fetcher(url,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(5000)});if(![301,302,303,307,308].includes(response.status))break;const next=response.headers.get('location');if(!next)break;url=new URL(next,url).href}throw Error('El enlace no contiene un punto identificable. Abrilo en Maps y compartí el lugar exacto, o marcá el punto en el mapa.');}
module.exports={allowed,parse,resolve};
