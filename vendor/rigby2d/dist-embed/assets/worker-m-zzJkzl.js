const e=[`transform`,`path`,`physics`];function t(t){let n=t.ik.map((e,t)=>({type:`ik`,name:e.name,order:e.order??t,ik:t}));for(let e of t.extra?.constraints??[])n.push({type:e.data.type,name:e.data.name,order:e.index,data:e.data,entry:e});for(let r of e)(t.extra?.[r]??[]).forEach((e,t)=>n.push({type:r,name:e.name,order:e.order??t,data:e,legacy:r}));return n.sort((e,t)=>e.order-t.order)}function n(e,t,n){t.type===`ik`?e.ik[t.ik].order=n:t.entry?t.entry.index=n:t.data.order=n}function r(e){t(e).forEach((t,r)=>n(e,t,r))}function i(n,i){let o=t(n).find(e=>e.name===i);if(!o)return!1;if(o.type===`ik`){n.ik.splice(o.ik,1);for(let e of n.animations){e.ik=e.ik.filter(e=>e.constraint!==o.ik);for(let t of e.ik)t.constraint>o.ik&&t.constraint--}for(let e of n.skins)e.ik=e.ik.filter(e=>e!==o.ik).map(e=>e>o.ik?e-1:e)}else{o.entry?n.extra.constraints.splice(n.extra.constraints.indexOf(o.entry),1):n.extra[o.legacy].splice(n.extra[o.legacy].indexOf(o.data),1);for(let e of n.animations)e.extra?.[o.type]&&delete e.extra[o.type][i];for(let t of n.skins)for(let n of[`constraints`,...e])a(t.extra?.[n],i)}return r(n),!0}function a(e,t){if(!Array.isArray(e))return;let n=e.indexOf(t);n>=0&&e.splice(n,1)}function o(e){return t(e).filter(e=>e.type!==`ik`).map(e=>({...e,path:e.type===`path`}))}function s(e){let t=new Set(e.bones.map(e=>e.name)),n=new Set(e.slots.map(e=>e.name)),r=[];for(let i of o(e)){let e=i.data,a=[...e.bones??[],...[`bone`,`source`].map(t=>e[t]).filter(e=>e!==void 0)];!i.path&&e.target!==void 0&&a.push(e.target);let o=i.path?[e.slot??e.target].filter(e=>e!==void 0):[],s=a.some(e=>!t.has(e)),c=Array.isArray(e.bones)&&e.bones.length===0&&i.type!==`slider`&&i.type!==`physics`;(s||c||o.some(e=>!n.has(e)))&&r.push(i.name)}for(let t of r)i(e,t);return r}const c=`linear`,l=`stepped`,u=Object.freeze({bezier:Object.freeze([.42,0,.58,1])}),d=Object.freeze({bezier:Object.freeze([.42,0,1,1])}),f=Object.freeze({bezier:Object.freeze([0,0,.58,1])}),p=e=>typeof e==`object`&&!!e,m=e=>Array.isArray(e)&&e.length===4;function h(e){return p(e)&&(m(e.bezier)||Array.isArray(e.beziers)&&e.beziers.length>0)}function g(e){if(e===`stepped`)return l;let t=c;return p(e)&&m(e.bezier)?t={bezier:e.bezier.map(Number)}:p(e)&&Array.isArray(e.beziers)&&e.beziers.length&&e.beziers.every(m)&&(t={beziers:e.beziers.map(e=>e.map(Number))}),t!==`linear`&&p(e.src)&&(t.src=JSON.parse(JSON.stringify(e.src))),t}function _(e,t=0){return p(e)?m(e.bezier)?e.bezier:Array.isArray(e.beziers)?e.beziers[t]??e.beziers[0]??null:null:null}const v=e=>Math.min(1,Math.max(0,e));function y(e,t,n=0){if(t=v(t),e===`stepped`)return 0;let r=_(e,n);return r?te(r[0],r[1],r[2],r[3],t):t}function b(e,t,n){let r=1-n;return 3*r*r*n*e+3*r*n*n*t+n*n*n}function ee(e,t,n){let r=1-n;return 3*r*r*e+6*r*n*(t-e)+3*n*n*(1-t)}function te(e,t,n,r,i){e=v(e),n=v(n);let a=i;for(let o=0;o<8;o++){let o=b(e,n,a)-i;if(Math.abs(o)<1e-5)return b(t,r,a);let s=ee(e,n,a);if(Math.abs(s)<1e-6)break;a=v(a-o/s)}let o=0,s=1;a=i;for(let t=0;t<30;t++){let t=b(e,n,a);if(Math.abs(t-i)<1e-5)break;t<i?o=a:s=a,a=(o+s)*.5}return b(t,r,a)}const ne=Math.PI/180;function x(e,t,n){return e+(t-e)*n}function re(e=0,t=0,n=0){return{x:e,y:t,rotation:n,scale_x:1,scale_y:1,shear_x:0,shear_y:0}}function ie(){return re()}function ae(e,t){return t.x=e.x,t.y=e.y,t.rotation=e.rotation,t.scale_x=e.scale_x,t.scale_y=e.scale_y,t.shear_x=e.shear_x??0,t.shear_y=e.shear_y??0,t}function oe(e){return{x:e.x,y:e.y,rotation:e.rotation,scale_x:e.scale_x,scale_y:e.scale_y,shear_x:e.shear_x??0,shear_y:e.shear_y??0}}function se(e,t=new C){let n=(e.rotation+(e.shear_x??0))*ne,r=(e.rotation+90+(e.shear_y??0))*ne;return t.set(Math.cos(n)*e.scale_x,Math.sin(n)*e.scale_x,Math.cos(r)*e.scale_y,Math.sin(r)*e.scale_y,e.x,e.y)}function S(e){return e=((e+180)%360+360)%360-180,e===-180?180:e}var C=class e{constructor(e=1,t=0,n=0,r=1,i=0,a=0){this.a=e,this.b=t,this.c=n,this.d=r,this.tx=i,this.ty=a}static identity(){return new e}clone(){return new e(this.a,this.b,this.c,this.d,this.tx,this.ty)}set(e,t,n,r,i,a){return this.a=e,this.b=t,this.c=n,this.d=r,this.tx=i,this.ty=a,this}static multiply(e,t,n){return n.set(e.a*t.a+e.c*t.b,e.b*t.a+e.d*t.b,e.a*t.c+e.c*t.d,e.b*t.c+e.d*t.d,e.a*t.tx+e.c*t.ty+e.tx,e.b*t.tx+e.d*t.ty+e.ty)}mul(t){return new e(this.a*t.a+this.c*t.b,this.b*t.a+this.d*t.b,this.a*t.c+this.c*t.d,this.b*t.c+this.d*t.d,this.a*t.tx+this.c*t.ty+this.tx,this.b*t.tx+this.d*t.ty+this.ty)}determinant(){return this.a*this.d-this.b*this.c}inverse(){let t=this.determinant();if(Math.abs(t)<1e-12)return new e;let n=1/t,r=this.d*n,i=-this.b*n,a=-this.c*n,o=this.a*n;return new e(r,i,a,o,-(r*this.tx+a*this.ty),-(i*this.tx+o*this.ty))}apply(e){return[this.a*e[0]+this.c*e[1]+this.tx,this.b*e[0]+this.d*e[1]+this.ty]}applyVector(e){return[this.a*e[0]+this.c*e[1],this.b*e[0]+this.d*e[1]]}rotation(){return Math.atan2(this.b,this.a)/ne}decompose(){let e=Math.hypot(this.a,this.b);if(e<1e-12)return{x:this.tx,y:this.ty,rotation:0,scale_x:0,scale_y:0,shear_x:0,shear_y:0};let t=this.rotation(),n=this.determinant(),r=Math.hypot(this.c,this.d)*(n<0?-1:1),i=S((r===0?t+90:Math.atan2(this.d/r,this.c/r)/ne)-t-90);return{x:this.tx,y:this.ty,rotation:t,scale_x:e,scale_y:r,shear_x:0,shear_y:Math.abs(i)<1e-9?0:i}}};const w=[`rotate`,`translate`,`scale`,`shear`],ce=[`translateX`,`translateY`,`scaleX`,`scaleY`,`shearX`,`shearY`],T=[...w,...ce,`inherit`],E=[`attachment`,`color`,`rgb`,`alpha`,`rgba2`,`rgb2`];function le(e,t,n=c){return{time:e,value:t,curve:n}}function ue(e){return Array.isArray(e)?e.slice():e}function de(e,t,n,r){return typeof e==`number`?x(e,t,y(r,n,0)):Array.isArray(e)?e.map((e,i)=>x(e,t[i],y(r,n,i))):e}function D(e,t){if(!e||e.length===0)return;if(t<=e[0].time)return ue(e[0].value);let n=me(e,e=>e.time<=t);if(n>=e.length)return ue(e[e.length-1].value);let r=e[n-1],i=e[n],a=i.time-r.time,o=a>0?(t-r.time)/a:1;return de(r.value,i.value,o,r.curve)}const fe=(e,t)=>Array.isArray(e.value)?e.value[t]:e.value;function O(e,t,n=0){if(t<=e[0].time)return fe(e[0],n);let r=me(e,e=>e.time<=t);if(r>=e.length)return fe(e[e.length-1],n);let i=e[r-1],a=e[r],o=a.time-i.time,s=fe(i,n);return s+(fe(a,n)-s)*y(i.curve,o>0?(t-i.time)/o:1,n)}function pe(e,t){return me(e,e=>e.time<=t)-1}function me(e,t){let n=0,r=e.length;for(;n<r;){let i=n+r>>1;t(e[i])?n=i+1:r=i}return n}function he(e,t,n,r=c){let i=e.findIndex(e=>Math.abs(e.time-t)<5e-4);if(i>=0)return e[i].value=n,i;let a=me(e,e=>e.time<t);return e.splice(a,0,le(t,n,r)),a}function ge(e){let t={bone:e};for(let e of T)t[e]=[];return t}function _e(e){let t={slot:e};for(let e of E)t[e]=[];return t}var ve=class{constructor(e=``,t=0){this.name=e,this.duration=t,this.bones=[],this.slots=[],this.deform=[],this.drawOrder=[],this.events=[],this.ik=[],this.extra={}}boneTimeline(e){return this.bones.find(t=>t.bone===e)}boneTimelineMut(e){let t=this.boneTimeline(e);return t||(t=ge(e),this.bones.push(t)),t}slotTimeline(e){return this.slots.find(t=>t.slot===e)}slotTimelineMut(e){let t=this.slotTimeline(e);return t||(t=_e(e),this.slots.push(t)),t}prune(){this.bones=this.bones.filter(e=>T.some(t=>e[t].length)),this.slots=this.slots.filter(e=>E.some(t=>e[t].length)),this.deform=this.deform.filter(e=>e.keys.length),this.ik=this.ik.filter(e=>e.keys.length)}lastKeyTime(){let e=0,t=t=>{for(let n of t)e=Math.max(e,n.time)};for(let e of this.bones)for(let n of T)t(e[n]);for(let e of this.slots)for(let n of E)t(e[n]);for(let e of this.deform)t(e.keys);for(let e of this.ik)t(e.keys);return t(this.drawOrder),t(this.events),e}};const ye=[`x`,`y`,`rotation`,`scale_x`,`scale_y`,`shear_x`,`shear_y`];function be(e){return Array.isArray(e)?e.filter(e=>e&&typeof e.name==`string`).map(e=>({name:e.name,bones:Object.fromEntries(Object.entries(e.bones??{}).filter(([,e])=>e&&typeof e==`object`).map(([e,t])=>[e,Object.fromEntries(ye.map(e=>[e,typeof t[e]==`number`&&Number.isFinite(t[e])?t[e]:+!!e.startsWith(`scale`)]))])),slots:Object.fromEntries(Object.entries(e.slots??{}).map(([e,t])=>[e,typeof t==`string`?t:null]))})):[]}function xe(e){return Array.isArray(e)?e.filter(e=>e&&typeof e.name==`string`&&typeof e.to==`string`).map(e=>({name:e.name,from:typeof e.from==`string`?e.from:null,to:e.to,value:typeof e.value==`number`?Math.min(1,Math.max(0,e.value)):0})):[]}const k=Math.PI/180,A=1e-5,j=[`rotate`,`x`,`y`,`scaleX`,`scaleY`,`shearY`],Se={rotate:`rotation`,x:`x`,y:`y`,scaleX:`scaleX`,scaleY:`scaleY`,shearY:`shearY`},Ce=/* @__PURE__ */ new WeakMap;function we(e){let t=Ce.get(e);if(t&&Ee(t.signature,e))return t.list;let n=Te(e),r=De(e);return Ce.set(e,{signature:n,list:r}),r}function Te(e){let t=e.extra??{};return[t.constraints,t.transform,t.path,e.bones.length,e.slots.length]}function Ee(e,t){let n=t.extra??{};return e[0]===n.constraints&&e[1]===n.transform&&e[2]===n.path&&e[3]===t.bones.length&&e[4]===t.slots.length}function De(e){let t=new Map(e.bones.map((e,t)=>[e.name,t])),n=new Map(e.slots.map((e,t)=>[e.name,t])),r=[];for(let t of e.extra?.constraints??[])r.push({data:t.data,type:t.data.type,order:t.index});for(let t of[`transform`,`path`,`physics`])(e.extra?.[t]??[]).forEach((e,n)=>r.push({data:e,type:t,order:e.order??n}));let i=[];for(let{data:a,type:o,order:s}of r){if(o===`slider`){let n=e.animations.findIndex(e=>e.name===a.animation),r=a.bone===void 0?null:t.get(a.bone);if(n<0||r===void 0)continue;i.push({name:a.name,order:s,skinRequired:!!a.skin,bones:r===null?[]:[r],type:o,animation:n,bone:r,property:a.property??`rotate`,scale:a.scale??1,offset:a.offset??0,local:!!a.local,loop:!!a.loop,additive:!!a.additive,setup:{time:a.time??0,mix:a.mix??1}});continue}if(o===`physics`){let e=t.get(a.bone);if(e===void 0)continue;i.push({name:a.name,order:s,skinRequired:!!a.skin,bones:[e],type:o,bone:e,...ke(a)});continue}let r=(a.bones??[]).map(e=>t.get(e));if(!r.length||r.some(e=>e===void 0))continue;let c={name:a.name,order:s,skinRequired:!!a.skin,bones:r};if(o===`transform`){let e=t.get(a.source??a.target);if(e===void 0)continue;i.push({...c,type:o,source:e,...Ae(a)})}else if(o===`path`){let e=n.get(a.slot??a.target);if(e===void 0)continue;i.push({...c,type:o,slot:e,...je(a)})}}return i}const Oe=[`inertia`,`strength`,`damping`,`mass`,`wind`,`gravity`,`mix`];function ke(e){let t={};for(let n of Oe)t[n]=!!e[`${n}Global`];return{weights:{x:e.x??0,y:e.y??0,rotate:e.rotate??0,scaleX:e.scaleX??0,shearX:e.shearX??0},limit:e.limit??5e3,fps:e.fps??60,globals:t,setup:{inertia:e.inertia??.5,strength:e.strength??100,damping:e.damping??.85,mass:e.mass??1,wind:e.wind??0,gravity:e.gravity??0,mix:e.mix??1}}}function Ae(e){let t=e.rotateMix!==void 0||e.translateMix!==void 0||e.scaleMix!==void 0||e.shearMix!==void 0,n={};for(let t of j)n[t]=e[Se[t]]??0;let r;if(t){let t=e.translateMix??1,n=e.scaleMix??1;r={rotate:e.rotateMix??1,x:t,y:t,scaleX:n,scaleY:n,shearY:e.shearMix??1}}else{let t=e.mixX??1,n=e.mixScaleX??1;r={rotate:e.mixRotate??1,x:t,y:e.mixY??t,scaleX:n,scaleY:e.mixScaleY??n,shearY:e.mixShearY??1}}let i;i=e.properties?Object.entries(e.properties).filter(([e])=>j.includes(e)).map(([e,t])=>({from:e,offset:t.offset??0,to:Object.entries(t.to??{}).filter(([e])=>j.includes(e)).map(([e,t])=>({prop:e,offset:t.offset??0,max:t.max??1,scale:t.scale??1}))})):j.map(e=>({from:e,offset:0,to:[{prop:e,offset:0,max:1,scale:1}]}));let a=!!e.local;return{offsets:n,mix:r,props:i,localSource:e.localSource??a,localTarget:e.localTarget??a,additive:!!(e.additive??e.relative),clamp:!!e.clamp}}function je(e){let t=e.rotateMix!==void 0||e.translateMix!==void 0,n=t?e.translateMix??1:e.mixX??1;return{positionMode:e.positionMode??`percent`,spacingMode:e.spacingMode??`length`,rotateMode:e.rotateMode??`tangent`,offsetRotation:e.rotation??0,setup:{position:e.position??0,spacing:e.spacing??0,mixRotate:t?e.rotateMix??1:e.mixRotate??1,mixX:n,mixY:t?n:e.mixY??n}}}function Me(e){return e.map(e=>e.type===`transform`?{mix:{...e.mix}}:{...e.setup})}function Ne(e,t){e.forEach((e,n)=>{e.type===`transform`?Object.assign(t[n].mix,e.mix):Object.assign(t[n],e.setup)})}function Pe(e,t){if(!t.skinRequired)return!0;let n=e.skin?e.findSkin(e.skin):null;if(!n)return!1;let r=n.extra??{};return[r.constraints,r.transform,r.path,r.physics].some(e=>Array.isArray(e)&&e.includes(t.name))}function Fe(e,t,n,r,i){let a=n.extra??{};(a.transform||a.path||a.physics||a.slider)&&e.forEach((e,n)=>{let o=t[n];if(e.type===`transform`){let t=a.transform?.[e.name];if(!Array.isArray(t)||!t.length)return;let n=t.some(e=>e.rotateMix!==void 0||e.translateMix!==void 0||e.scaleMix!==void 0||e.shearMix!==void 0)?M(t,r,e=>{let t=e.translateMix??1,n=e.scaleMix??1;return[e.rotateMix??1,t,t,n,n,e.shearMix??1]}):M(t,r,e=>{let t=e.mixX??1,n=e.mixScaleX??1;return[e.mixRotate??1,t,e.mixY??t,n,e.mixScaleY??n,e.mixShearY??1]});j.forEach((e,t)=>o.mix[e]+=(n[t]-o.mix[e])*i)}else if(e.type===`slider`){let t=a.slider?.[e.name];if(!t)return;for(let e of[`time`,`mix`]){if(!Array.isArray(t[e])||!t[e].length)continue;let[n]=M(t[e],r,t=>[t.value??+(e===`mix`)]);o[e]+=(n-o[e])*i}}else if(e.type===`physics`){for(let[t,n]of[[a.physics?.[e.name],!1],[a.physics?.[``],!0]])if(t)for(let a of Oe){let s=t[a];if(!Array.isArray(s)||!s.length||n&&!e.globals[a])continue;let[c]=M(s,r,e=>[e.value??0]);o[a]+=(c-o[a])*i}}else if(e.type===`path`){let t=a.path?.[e.name];if(!t)return;if(t.position?.length){let[e]=M(t.position,r,e=>[e.value??e.position??0]);o.position+=(e-o.position)*i}if(t.spacing?.length){let[e]=M(t.spacing,r,e=>[e.value??e.spacing??0]);o.spacing+=(e-o.spacing)*i}if(t.mix?.length){let[e,n,a]=M(t.mix,r,e=>e.rotateMix!==void 0||e.translateMix!==void 0?[e.rotateMix??1,e.translateMix??1,e.translateMix??1]:[e.mixRotate??1,e.mixX??1,e.mixY??e.mixX??1]);o.mixRotate+=(e-o.mixRotate)*i,o.mixX+=(n-o.mixX)*i,o.mixY+=(a-o.mixY)*i}}})}function M(e,t,n){if(t<(e[0].time??0))return n(e[0]);let r=0;for(;r+1<e.length&&(e[r+1].time??0)<=t;)r++;let i=e[r],a=e[r+1],o=n(i);if(!a||i.curve===`stepped`)return o;let s=n(a),c=i.time??0,l=a.time??0;if(l<=c)return s;let u=i.curve;return o.map((e,n)=>{let r=s[n];if(Array.isArray(u)&&u.length>=4*(n+1)&&u.length>=4*o.length)return Ie(c,e,u[4*n],u[4*n+1],u[4*n+2],u[4*n+3],l,r,t);let a=(t-c)/(l-c);return typeof u==`number`?a=Le(u,i.c2??0,i.c3??1,i.c4??1,a):Array.isArray(u)&&u.length===4&&(a=Le(u[0],u[1],u[2],u[3],a)),e+(r-e)*a})}function N(e,t,n,r,i){let a=1-i;return a*a*a*e+3*a*a*i*t+3*a*i*i*n+i*i*i*r}function Ie(e,t,n,r,i,a,o,s,c){let l=0,u=1,d=(c-e)/(o-e);for(let t=0;t<40;t++){let t=N(e,n,i,o,d);if(Math.abs(t-c)<1e-7)break;t<c?l=d:u=d,d=(l+u)/2}return N(t,r,a,s,d)}function Le(e,t,n,r,i){return Ie(0,0,e,t,n,r,1,1,i)}function Re(e,t){if(!t)return;let n=Math.cos(t*k),r=Math.sin(t*k),{a:i,b:a,c:o,d:s}=e;e.a=n*i-r*a,e.b=r*i+n*a,e.c=n*o-r*s,e.d=r*o+n*s}const P=(e,t)=>Math.atan2(t,e)/k;function ze(e,t){if(t.localSource){let n=e.applied[t.source];return{rotate:n.rotation,x:n.x,y:n.y,scaleX:n.scale_x,scaleY:n.scale_y,shearY:n.shear_y??0}}let n=e.world[t.source],[r,i]=n.apply([t.offsets.x,t.offsets.y]),a=P(n.a,n.b);return{rotate:a,x:r,y:i,scaleX:Math.hypot(n.a,n.b),scaleY:Math.hypot(n.c,n.d),shearY:S(P(n.c,n.d)-a-90)}}function Be(e,t){let n=ze(e,t),r=!t.localSource&&e.world[t.source].determinant()<0,i={};for(let e of t.props){let a=n[e.from]-e.offset;for(let n of e.to){let o=a*n.scale+n.offset;t.clamp&&(o=Math.min(Math.max(o,Math.min(n.offset,n.max)),Math.max(n.offset,n.max)));let s=!t.localSource&&(n.prop===`x`||n.prop===`y`)&&(e.from===`x`||e.from===`y`)?0:t.offsets[n.prop];r&&(n.prop===`rotate`||n.prop===`shearY`)&&(s=-s),i[n.prop]=(i[n.prop]??0)+o+s}}return i}function Ve(e,t,n){let r=n.mix;if(!j.some(e=>r[e]!==0))return null;let i=Be(e,t);if(t.localTarget){for(let n of t.bones){let a=e.applied[n],o=e=>i[e]===void 0?0:r[e];t.additive?(o(`rotate`)&&(a.rotation+=i.rotate*r.rotate),o(`x`)&&(a.x+=i.x*r.x),o(`y`)&&(a.y+=i.y*r.y),o(`scaleX`)&&(a.scale_x*=(i.scaleX-1)*r.scaleX+1),o(`scaleY`)&&(a.scale_y*=(i.scaleY-1)*r.scaleY+1),o(`shearY`)&&(a.shear_y=(a.shear_y??0)+i.shearY*r.shearY)):(o(`rotate`)&&(a.rotation+=S(i.rotate-a.rotation)*r.rotate),o(`x`)&&(a.x+=(i.x-a.x)*r.x),o(`y`)&&(a.y+=(i.y-a.y)*r.y),o(`scaleX`)&&(a.scale_x+=(i.scaleX-a.scale_x)*r.scaleX),o(`scaleY`)&&(a.scale_y+=(i.scaleY-a.scale_y)*r.scaleY),o(`shearY`)&&(a.shear_y=(a.shear_y??0)+S(i.shearY-(a.shear_y??0))*r.shearY))}return{local:t.bones}}let a=/* @__PURE__ */ new Map;for(let n of t.bones){let o=e.world[n].clone();i.rotate!==void 0&&r.rotate&&Re(o,(t.additive?i.rotate:S(i.rotate-P(o.a,o.b)))*r.rotate),i.x!==void 0&&r.x&&(o.tx+=t.additive?i.x*r.x:(i.x-o.tx)*r.x),i.y!==void 0&&r.y&&(o.ty+=t.additive?i.y*r.y:(i.y-o.ty)*r.y);let s=(e,n,r,i)=>{let a=Math.hypot(o[r],o[i]);if(a<A)return;let s=t.additive?(e-1)*n+1:(a+(e-a)*n)/a;o[r]*=s,o[i]*=s};if(i.scaleX!==void 0&&r.scaleX&&s(i.scaleX,r.scaleX,`a`,`b`),i.scaleY!==void 0&&r.scaleY&&s(i.scaleY,r.scaleY,`c`,`d`),i.shearY!==void 0&&r.shearY){let e=P(o.a,o.b),n=S(P(o.c,o.d)-e),a=t.additive?n+i.shearY*r.shearY:n+S(90+i.shearY-n)*r.shearY,s=Math.hypot(o.c,o.d);o.c=Math.cos((e+a)*k)*s,o.d=Math.sin((e+a)*k)*s}a.set(n,o)}return{world:a}}function He(e,t,n,r){let{mixRotate:i,mixX:a,mixY:o}=r;if(i===0&&a===0&&o===0)return null;let s=t.slotAttachment(e,n.slot);if(!s||s.type!==`path`)return null;let c=Ue(t.worldVertices(e,n.slot,s),s);if(!c)return null;let l=n.bones.length,u=n.rotateMode===`tangent`,d=n.rotateMode===`chainScale`,f=u?l:l+1,p=n.bones.map(n=>e.bones[n].length*Math.hypot(t.world[n].a,t.world[n].b)),m=Array(f).fill(0),h=n.spacingMode===`percent`;for(let e=0;e<f-1;e++){let t=p[e];switch(n.spacingMode){case`percent`:case`fixed`:m[e+1]=r.spacing;break;case`proportional`:m[e+1]=t;break;default:m[e+1]=t<A?0:t+r.spacing}}if(n.spacingMode===`proportional`){let e=m.reduce((e,t)=>e+t,0);if(e>A)for(let t=1;t<f;t++)m[t]*=c.length*(1-Math.min(1,r.spacing))/e}let g=r.position;n.positionMode===`percent`&&(g*=c.length);let _=[],v=g;for(let e=0;e<f;e++)v+=h?m[e]*c.length:m[e],_.push(c.at(v));let y=/* @__PURE__ */ new Map,b=e=>e.determinant()<0?-1:1;for(let e=0;e<l;e++){let r=n.bones[e],s=t.world[r].clone(),[c,l,f]=_[e];if(s.tx+=(c-s.tx)*a,s.ty+=(l-s.ty)*o,i>0){let t;if(u)t=f;else{let[n,r]=_[e+1],a=n-s.tx,o=r-s.ty;if(d&&p[e]>=A){let t=(Math.hypot(a,o)/p[e]-1)*i+1;s.a*=t,s.b*=t}t=Math.hypot(a,o)>A?P(a,o):f}t=S(t-P(s.a,s.b)+n.offsetRotation*b(s)),Re(s,t*i)}y.set(r,s)}return{world:y}}function Ue(e,t){let n=Math.floor(e.length/6);if(n<2&&!(t.closed&&n>=1))return null;let r=[],i=t.closed?n:n-1;for(let a=0;a<i;a++){let i=6*a,o=t.closed&&a===n-1?0:i+6;r.push([e[i+2],e[i+3],e[i+4],e[i+5],e[o],e[o+1],e[o+2],e[o+3]])}let a=r.map(e=>{let t=[0],[n,r]=[e[0],e[1]];for(let i=1;i<=16;i++){let a=i/16,o=N(e[0],e[2],e[4],e[6],a),s=N(e[1],e[3],e[5],e[7],a);t.push(t[i-1]+Math.hypot(o-n,s-r)),[n,r]=[o,s]}return t}),o=[];if(t.constantSpeed||!t.lengths?.length){let e=0;for(let t of a)o.push(e+=t[16])}else for(let e=0;e<i;e++)o.push(t.lengths[e]??o[e-1]??0);let s=o[o.length-1]??0;if(s<A)return null;let c=(e,t)=>{let n=r[e],i=N(n[0],n[2],n[4],n[6],t),a=N(n[1],n[3],n[5],n[7],t),o=(e,n,r,i)=>3*(1-t)*(1-t)*(n-e)+6*(1-t)*t*(r-n)+3*t*t*(i-r),s=o(n[0],n[2],n[4],n[6]),c=o(n[1],n[3],n[5],n[7]);return Math.hypot(s,c)<A&&([s,c]=[n[6]-n[0],n[7]-n[1]]),[i,a,P(s,c)]};return{length:s,at:e=>{if(t.closed)e%=s,e<0&&(e+=s);else if(e<0){let t=r[0],n=P(t[2]-t[0],t[3]-t[1]);return[t[0]+Math.cos(n*k)*e,t[1]+Math.sin(n*k)*e,n]}else if(e>s){let t=r[r.length-1],n=P(t[6]-t[4],t[7]-t[5]),i=e-s;return[t[6]+Math.cos(n*k)*i,t[7]+Math.sin(n*k)*i,n]}let n=0;for(;n<o.length-1&&e>o[n];)n++;let i=n>0?o[n-1]:0,l=o[n]-i,u=l>A?(e-i)/l:0;if(!t.constantSpeed&&t.lengths?.length)return c(n,u);let d=a[n],f=u*d[16],p=1;for(;p<16&&d[p]<f;)p++;let m=d[p]-d[p-1],h=(p-1+(m>A?(f-d[p-1])/m:0))/16;return c(n,h)}}}function We(e,t,n,r,i,a){let o=n.weights,s=r.mix,c=t.world[n.bone],l=t.placement&&Math.sqrt(Math.abs(t.placement.determinant()))||1,u=Math.hypot(c.a,c.b)||1,d=Math.max(10,e.bones[n.bone].length*u/l),f=[c.tx/l,c.ty/l],p=[f[0]+c.a/u*d,f[1]+c.b/u*d];if(i.ready||Object.assign(i,{ready:!0,rest:0,o:[0,0],ov:[0,0],t:[0,0],tv:[0,0],lastOrigin:f,lastTip:p}),a>0){let e=1/Math.max(1,n.fps);i.rest+=a;let t=Math.floor(i.rest/e);if(i.rest-=t*e,t=Math.min(t,Math.max(1,n.fps)),t>0){for(let e=0;e<2;e++)i.o[e]-=(f[e]-i.lastOrigin[e])*r.inertia,i.t[e]-=(p[e]-i.lastTip[e])*r.inertia;let a=r.mass>0?1/r.mass:1,o=Math.min(1,Math.max(0,r.damping))**(60*e),s=[r.wind*100,-r.gravity*100];for(let c=0;c<t;c++)for(let[t,c]of[[i.o,i.ov],[i.t,i.tv]]){for(let n=0;n<2;n++)c[n]=(c[n]+(s[n]-r.strength*t[n])*a*e)*o;let i=Math.hypot(c[0],c[1]);i>n.limit&&(c[0]*=n.limit/i,c[1]*=n.limit/i),t[0]+=c[0]*e,t[1]+=c[1]*e}i.lastOrigin=f,i.lastTip=p}}if(s===0)return null;let m=c.clone();if(m.tx+=i.o[0]*o.x*s*l,m.ty+=i.o[1]*o.y*s*l,o.rotate||o.scaleX||o.shearX){let e=[p[0]-f[0],p[1]-f[1]],t=[e[0]+i.t[0],e[1]+i.t[1]],n=S(P(t[0],t[1])-P(e[0],e[1]));if(Re(m,n*o.rotate*s),o.shearX){let e=n*o.shearX*s*k,[t,r]=[m.a,m.b];m.a=t*Math.cos(e)-r*Math.sin(e),m.b=t*Math.sin(e)+r*Math.cos(e)}if(o.scaleX){let e=(Math.hypot(t[0],t[1])/d-1)*o.scaleX*s+1;m.a*=e,m.b*=e}}return{world:/* @__PURE__ */ new Map([[n.bone,m]])}}function Ge(e,t,n,r){let i=e.animations[n.animation];if(!i||r.mix<=0)return null;let a=r.time;n.bone!==null&&(a=(n.local?Ke(t.applied[n.bone],n.property):qe(t.world[n.bone],n.property))*n.scale+n.offset);let o=i.duration;o>0&&(a=n.loop?(a%o+o)%o:Math.min(o,Math.max(0,a)));let s=t.local;t.local=t.applied;try{t.apply(e,i,a,Math.min(1,r.mix))}finally{t.local=s}return{all:!0}}function Ke(e,t){switch(t){case`x`:return e.x;case`y`:return e.y;case`scaleX`:return e.scale_x;case`scaleY`:return e.scale_y;case`shearY`:return e.shear_y??0;default:return e.rotation}}function qe(e,t){switch(t){case`x`:return e.tx;case`y`:return e.ty;case`scaleX`:return Math.hypot(e.a,e.b);case`scaleY`:return Math.hypot(e.c,e.d);case`shearY`:return S(P(e.c,e.d)-P(e.a,e.b)-90);default:return P(e.a,e.b)}}function Je(e,t){let n=e.sequence,r=n.start??1,i=n.digits??0,a=Math.max(1,n.count??1),o=Math.min(a-1,Math.max(0,t|0));return`${e.image??e.name}${String(r+o).padStart(i,`0`)}`}function Ye(e){return e.sequence?.setup??0}function Xe(e,t,n){let r=-1,i=0;for(let n=0;n<e.length&&(e[n].time??0)<=t;n++)r=n,i=e[n].delay??i;if(r<0)return null;let a=e[r],o=a.mode??`hold`,s=a.index??0;if(o===`hold`||n<=1)return Math.min(n-1,Math.max(0,s));let c=i>0?Math.floor((t-(a.time??0))/i+1e-6):0,l=o.endsWith(`Reverse`),u=o.replace(`Reverse`,``),d=s+c;if(u===`once`)d=Math.min(d,n-1);else if(u===`loop`)d%=n;else if(u===`pingpong`){let e=2*(n-1);d%=e,d>=n&&(d=e-d)}return l?n-1-d:d}const Ze=Math.PI/180,F=e=>Math.atan2(e[1],e[0])/Ze,I=(e,t)=>[e[0]-t[0],e[1]-t[1]],L=e=>Math.hypot(e[0],e[1]),Qe=new C;var $e=class{constructor(e){this.applied=[],this.world=[],this.constraintList=null,this.physics=/* @__PURE__ */ new Map,this.physicsDelta=0,this.placement=null,this.setToSetup(e)}setToSetup(e){this.reset(e),this.updateWorld(e)}reset(e){let t=e.bones,n=e.slots;if(!this.local||this.local.length!==t.length)this.local=t.map(e=>oe(e.setup)),this.inherit=t.map(e=>e.inherit??`normal`);else for(let e=0;e<t.length;e++)ae(t[e].setup,this.local[e]),this.inherit[e]=t[e].inherit??`normal`;if(!this.attachment||this.attachment.length!==n.length)this.attachment=n.map(e=>e.attachment),this.color=n.map(e=>e.color.slice()),this.dark=n.map(e=>e.dark?e.dark.slice():null),this.drawOrder=n.map((e,t)=>t),this.sequence=n.map(()=>-1);else for(let e=0;e<n.length;e++){let t=n[e];this.attachment[e]=t.attachment,this.sequence[e]=-1;let r=this.color[e];for(let e=0;e<4;e++)r[e]=t.color[e];if(t.dark){let n=this.dark[e]??(this.dark[e]=[0,0,0]);for(let e=0;e<3;e++)n[e]=t.dark[e]}else this.dark[e]=null;this.drawOrder[e]=e}this.deform?this.deform.clear():this.deform=/* @__PURE__ */ new Map,(!this.ik||this.ik.length!==e.ik.length)&&(this.ik=e.ik.map(()=>({})));for(let t=0;t<e.ik.length;t++){let n=e.ik[t],r=this.ik[t];r.mix=n.mix,r.softness=n.softness,r.bendPositive=n.bendPositive,r.compress=n.compress,r.stretch=n.stretch}Ne(this.ensureConstraints(e),this.constraintState)}ensureConstraints(e){let t=we(e);return t!==this.constraintList&&(this.constraintList=t,this.constraintState=Me(t)),t}apply(e,t,n,r){let i=r>=.5;for(let a of t.bones){let t=e.bones[a.bone];if(!t)continue;let o=t.setup,s=this.local[a.bone],{x:c,y:l,rotation:u,scale_x:d,scale_y:f,shear_x:p,shear_y:m}=s,h=e=>e!==void 0&&e.length>0;h(a.rotate)&&(u=o.rotation+O(a.rotate,n,0)),h(a.translate)&&(c=o.x+O(a.translate,n,0),l=o.y+O(a.translate,n,1)),h(a.translateX)&&(c=o.x+O(a.translateX,n,0)),h(a.translateY)&&(l=o.y+O(a.translateY,n,0)),h(a.scale)&&(d=o.scale_x*O(a.scale,n,0),f=o.scale_y*O(a.scale,n,1)),h(a.scaleX)&&(d=o.scale_x*O(a.scaleX,n,0)),h(a.scaleY)&&(f=o.scale_y*O(a.scaleY,n,0)),h(a.shear)&&(p=(o.shear_x??0)+O(a.shear,n,0),m=(o.shear_y??0)+O(a.shear,n,1)),h(a.shearX)&&(p=(o.shear_x??0)+O(a.shearX,n,0)),h(a.shearY)&&(m=(o.shear_y??0)+O(a.shearY,n,0)),i&&h(a.inherit)&&(this.inherit[a.bone]=D(a.inherit,n)),r>=1?(s.x=c,s.y=l,s.rotation=u,s.scale_x=d,s.scale_y=f,s.shear_x=p,s.shear_y=m):(s.x=x(s.x,c,r),s.y=x(s.y,l,r),s.rotation=x(s.rotation,u,r),s.scale_x=x(s.scale_x,d,r),s.scale_y=x(s.scale_y,f,r),s.shear_x=x(s.shear_x??0,p??0,r),s.shear_y=x(s.shear_y??0,m??0,r))}for(let e of t.slots){let t=e.slot;if(t>=this.attachment.length)continue;let a;i&&(a=D(e.attachment,n))!==void 0&&(this.attachment[t]=a);let o=this.color[t].slice(),s=this.dark[t]?this.dark[t].slice():null;(a=D(e.color,n))!==void 0&&o.splice(0,4,...a),(a=D(e.rgb,n))!==void 0&&o.splice(0,3,...a),(a=D(e.alpha,n))!==void 0&&(o[3]=a),(a=D(e.rgba2,n))!==void 0&&(o.splice(0,4,...a.slice(0,4)),s=a.slice(4,7)),(a=D(e.rgb2,n))!==void 0&&(o.splice(0,3,...a.slice(0,3)),s=a.slice(3,6));let c=this.color[t];for(let e=0;e<4;e++)c[e]=x(c[e],o[e],r);s&&(this.dark[t]=(this.dark[t]??s).map((e,t)=>x(e,s[t],r)))}for(let i of t.deform){if(!i.keys.length)continue;let t=e.slots[i.slot]&&e.attachment(i.slot,i.attachment,i.skin??e.skin);if(!t)continue;let a=e.meshSource(i.slot,t)??t,o=et(i.keys,n,tt(a)),s=`${i.slot}/${i.attachment}`,c=this.deform.get(s);this.deform.set(s,c&&r<1?c.map((e,t)=>x(e,o[t],r)):o)}if(i&&t.extra?.attachments)for(let[r,i]of Object.entries(t.extra.attachments))for(let[t,a]of Object.entries(i)){let i=e.slots.findIndex(e=>e.name===t);if(!(i<0))for(let[t,o]of Object.entries(a)){if(!Array.isArray(o.sequence)||this.attachment[i]!==t)continue;let a=e.attachment(i,t,r==="default"?null:r)??e.attachment(i,t);if(!a?.sequence)continue;let s=Xe(o.sequence,n,a.sequence.count??1);s!==null&&(this.sequence[i]=s)}}if(i&&t.drawOrder.length){let r=pe(t.drawOrder,n);r>=0&&(this.drawOrder=ot(e.slots.length,t.drawOrder[r].value))}Fe(this.ensureConstraints(e),this.constraintState,t,n,r);for(let e of t.ik){let t=this.ik[e.constraint];if(!t)continue;let a=pe(e.keys,n);if(a<0)continue;let o=e.keys[a],s=e.keys[a+1],c=s&&s.time>o.time&&o.curve!==`stepped`?(n-o.time)/(s.time-o.time):0,l=(e,t)=>{let n=o.value[e]??t;return x(n,s?s.value[e]??t:n,c)};t.mix=x(t.mix,l(`mix`,1),r),t.softness=x(t.softness,l(`softness`,0),r),i&&(t.bendPositive=o.value.bendPositive??!0,t.compress=o.value.compress??!1,t.stretch=o.value.stretch??!1)}}updateWorld(e){let t=this.local.length;for(let e=0;e<t;e++)this.applied[e]=this.applied[e]?ae(this.local[e],this.applied[e]):oe(this.local[e]);this.applied.length=t,this.computeWorld(e);let n=this.ensureConstraints(e),r=this.physicsDelta;this.physicsDelta=0;let i=this.constraintSteps(e,n);for(let t=0;t<i.length;t++){let a=i[t];if(a.ik!==void 0){let t=e.ik[a.ik];if(t.skinRequired&&!this.skinActive(e,e=>e.ik.includes(a.ik)))continue;this.solveIk(e,t,this.ik[a.ik]);continue}let o=n[a.other];if(!Pe(e,o))continue;let s=this.constraintState[a.other],c;if(o.type===`transform`)c=Ve(this,o,s);else if(o.type===`path`)c=He(e,this,o,s);else if(o.type===`slider`)c=Ge(e,this,o,s);else{let t=this.physics.get(o.name);t||this.physics.set(o.name,t={}),c=We(e,this,o,s,t,r)}if(c?.all)this.computeWorld(e);else if(c?.world)this.setWorlds(e,c.world);else if(c?.local)for(let t of c.local)this.updateBranch(e,t)}}constraintSteps(e,t){let n=this._steps,r=!n||this._stepsIk!==e.ik||this._stepsList!==t||n.length!==e.ik.length+t.length;if(!r)for(let i=0;i<n.length;i++){let a=n[i];if((a.ik===void 0?t[a.other]?.order:e.ik[a.ik]?.order)!==a.order){r=!0;break}}return r&&(n=[...e.ik.map((e,t)=>({order:e.order,ik:t})),...t.map((e,t)=>({order:e.order,other:t}))],n.sort((e,t)=>e.order-t.order),this._steps=n,this._stepsIk=e.ik,this._stepsList=t),n}resetPhysics(){this.physics.clear()}setWorlds(e,t){let n=this.dirtyFlags(e),r=e.bones,i=r.length;for(let e of t.keys())i=Math.min(i,e);for(let a=i;a<r.length;a++){let i=r[a].parent,o=t.get(a);o?(this.applied[a]=i===null&&this.placement?nt(this.placement,o,`normal`):nt(i===null?null:this.world[i],o,this.inherit[a]),this.world[a]=o,n[a]=1):i!==null&&n[i]&&(this.updateBone(e,a),n[a]=1)}}dirtyFlags(e){let t=e.bones.length;return!this.dirty||this.dirty.length!==t?this.dirty=new Uint8Array(t):this.dirty.fill(0),this.dirty}updateBranch(e,t){let n=this.dirtyFlags(e),r=e.bones;n[t]=1,this.updateBone(e,t);for(let i=t+1;i<r.length;i++){let t=r[i].parent;t!==null&&n[t]&&(n[i]=1,this.updateBone(e,i))}}updateBone(e,t){let n=e.bones[t].parent,r=this.world[t]??(this.world[t]=new C);n===null?this.placement?C.multiply(this.placement,se(this.applied[t],Qe),r):se(this.applied[t],r):at(this.world[n],se(this.applied[t],Qe),this.inherit[t],r)}skinActive(e,t){let n=e.skin?e.findSkin(e.skin):null;return!!n&&t(n)}computeWorld(e){this.world.length=e.bones.length;for(let t=0;t<e.bones.length;t++)this.updateBone(e,t)}solveIk(e,t,n){let r=n.mix;if(r<=0||!t.bones.length)return;let i=this.world[t.target].apply([0,0]),a=t=>{let n=e.bones[t].parent;return n!==null&&this.world[n].determinant()<0?-1:1},o=(e,t,n)=>{let o=S(F(I(i,t))-F(I(n,t)));this.applied[e].rotation+=o*r*a(e)};if(t.bones.length===1){let a=t.bones[0],s=this.world[a],c=s.apply([0,0]);o(a,c,s.apply([1,0]));let l=e.bones[a].length*L([s.a,s.b]),u=L(I(i,c));if(l>1e-4&&(n.compress&&u<l||n.stretch&&u>l)){let e=(u/l-1)*r+1;this.applied[a].scale_x*=e,t.uniform&&(this.applied[a].scale_y*=e)}this.updateBranch(e,a);return}let[s,c]=t.bones,l=this.world[s].apply([0,0]),u=this.world[c].apply([0,0]),d=this.world[c].apply([e.bones[c].length,0]),f=L(I(u,l)),p=L(I(d,u));if(f<1e-4||p<1e-4){o(s,l,u.some((e,t)=>e!==l[t])?u:this.world[s].apply([1,0])),this.updateBranch(e,s);return}let m=L(I(i,l));if(n.stretch&&m>f+p){let o=(m/(f+p)-1)*r+1;return this.applied[s].scale_x*=o,t.uniform&&(this.applied[s].scale_y*=o),this.updateBranch(e,s),l=this.world[s].apply([0,0]),u=this.world[c].apply([0,0]),this.finishTwoBone(e,s,c,i,r,n,a)}let h=n.softness;h>0&&m>f+p-h&&(m=f+p-h*Math.exp(-(m-(f+p-h))/h)),m=Math.min(Math.max(m,Math.abs(f-p)+1e-6),f+p-1e-6);let g=Math.min(1,Math.max(-1,(f*f+m*m-p*p)/(2*f*m))),_=Math.acos(g)/Ze,v=(n.bendPositive?1:-1)*(this.world[s].determinant()<0?-1:1),y=S(F(I(i,l))-v*_-F(I(u,l)));this.applied[s].rotation+=y*r*a(s),this.updateBranch(e,s),this.finishTwoBone(e,s,c,i,r,n,a)}finishTwoBone(e,t,n,r,i,a,o){let s=this.world[n].apply([0,0]),c=this.world[n].apply([Math.max(e.bones[n].length,.001),0]),l=S(F(I(r,s))-F(I(c,s)));this.applied[n].rotation+=l*i*o(n),this.updateBranch(e,n)}imageOf(e,t){if(!t.sequence)return t.image??t.name;let n=this.sequence?.[e]??-1;return Je(t,n>=0?n:Ye(t))}attachmentWorld(e,t,n){return this.world[e.slots[t].bone].mul(se(n.offset))}slotAttachment(e,t){return e.attachment(t,this.attachment[t])}deformOf(e,t){if(this.deform.size)return this.deform.get(t.type===`linkedmesh`&&t.deform?`${e}/${t.parent}`:`${e}/${t.name}`)}worldVertices(e,t,n,r=[]){r.length=0;let i=e.meshSource(t,n);if(!i)return r;let a=this.deformOf(t,n),o=this.world;if(i.weights){let e=0,t=i.weights;for(let n=0;n<t.length;n++){let i=t[n],s=0,c=0;for(let t=0;t<i.length;t++){let n=i[t],r=n.x+(a?a[e]:0),l=n.y+(a?a[e+1]:0);e+=2;let u=o[n.bone];s+=(u.a*r+u.c*l+u.tx)*n.weight,c+=(u.b*r+u.d*l+u.ty)*n.weight}r.push(s,c)}}else{let n=this.world[e.slots[t].bone],o=i.vertices??[];for(let e=0;e+1<o.length;e+=2){let t=o[e]+(a?a[e]:0),i=o[e+1]+(a?a[e+1]:0);r.push(n.a*t+n.c*i+n.tx,n.b*t+n.d*i+n.ty)}}return r}quads(e){let t=[];for(let n of this.drawOrder){let r=e.slots[n];if(!r)continue;let i=this.slotAttachment(e,n);if(!i)continue;let a=this.color[n],o=i.color?a.map((e,t)=>e*i.color[t]):a,s=r.blend??`normal`;if(i.type===`region`||i.type===void 0){let r=this.attachmentWorld(e,n,i),a=i.width*.5,c=i.height*.5;t.push({kind:`region`,image:this.imageOf(n,i),slot:n,attachment:i,positions:[[-a,c],[a,c],[a,-c],[-a,-c]].map(e=>r.apply(e)),uvs:[[0,0],[1,0],[1,1],[0,1]],color:o,blend:s})}else if(i.type===`mesh`||i.type===`linkedmesh`){let r=e.meshSource(n,i);if(!r)continue;let a=this.worldVertices(e,n,i),c=[];for(let e=0;e+1<a.length;e+=2)c.push([a[e],a[e+1]]);t.push({kind:`mesh`,slot:n,attachment:i,image:this.imageOf(n,i.type===`linkedmesh`?i:r),positions:c,uvs:it(r),triangles:r.triangles,color:o,blend:s})}}return t}};function et(e,t,n){let r=e=>{let t=new Float64Array(n),{offset:r=0,vertices:i=[]}=e.value??{};for(let e=0;e<i.length&&r+e<n;e++)t[r+e]=i[e];return t},i=Math.max(0,pe(e,t)),a=e[i],o=e[i+1],s=r(a);if(!o||t<=a.time||a.curve===`stepped`)return s;let c=r(o),l=y(a.curve,(t-a.time)/(o.time-a.time),0);for(let e=0;e<n;e++)s[e]+=(c[e]-s[e])*l;return s}function tt(e){return e.weights?e.weights.reduce((e,t)=>e+t.length*2,0):(e.vertices?.length??gt(e)*2)|0}function nt(e,t,n){if(!e)return t.decompose();let[r,i]=e.inverse().apply([t.tx,t.ty]),a=at(e,new C,n);a.tx=0,a.ty=0;let o=a.inverse().mul(new C(t.a,t.b,t.c,t.d,0,0));return o.tx=r,o.ty=i,o.decompose()}const rt=/* @__PURE__ */ new WeakMap;function it(e){let t=rt.get(e);if(t&&t.uvs===e.uvs)return t.pairs;let n=[];for(let t=0;t+1<e.uvs.length;t+=2)n.push([e.uvs[t],e.uvs[t+1]]);return rt.set(e,{uvs:e.uvs,pairs:n}),n}function at(e,t,n,r=new C){if(n===`normal`||!n)return C.multiply(e,t,r);let i=e.a*t.tx+e.c*t.ty+e.tx,a=e.b*t.tx+e.d*t.ty+e.ty,o=Math.hypot(e.a,e.b),s=e.determinant(),c,l,u,d;switch(n){case`onlyTranslation`:[c,l,u,d]=[1,0,0,1];break;case`noRotationOrReflection`:[c,l,u,d]=[o,0,0,o>1e-12?Math.abs(s)/o:0];break;case`noScale`:case`noScaleOrReflection`:{let t=o>1e-12?e.a/o:1,r=o>1e-12?e.b/o:0,i=n===`noScale`&&s<0?-1:1;[c,l,u,d]=[t,r,-r*i,t*i];break}default:return C.multiply(e,t,r)}return r.set(c*t.a+u*t.b,l*t.a+d*t.b,c*t.c+u*t.d,l*t.c+d*t.d,i,a)}function ot(e,t){let n=Array.from({length:e},(e,t)=>t);if(!t||!t.length)return n;let r=Array(e).fill(-1),i=[],a=0;for(let{slot:n,offset:o}of[...t].sort((e,t)=>e.slot-t.slot)){if(n>=e)continue;for(;a<n;)i.push(a++);let t=a+o;t>=0&&t<e&&r[t]===-1?r[t]=a:i.push(a),a++}for(;a<e;)i.push(a++);for(let t=e-1;t>=0;t--)r[t]===-1&&(r[t]=i.pop());return r}function st(e){if(!e||typeof e.animation!=`string`||!e.animation)return null;let t=(e,t,n=-1/0)=>typeof e==`number`&&Number.isFinite(e)&&e>=n?e:t;return{animation:e.animation,start:t(e.start,0,0),in:t(e.in,0,0),out:e.out===null||e.out===void 0?null:t(e.out,null,0),speed:t(e.speed,1,.01),loops:Math.round(t(e.loops,1,0)),blend:t(e.blend,.2,0)}}function ct(e){if(!e||typeof e!=`object`)return null;let t=(Array.isArray(e.actors)?e.actors:[]).filter(e=>e&&typeof e.id==`string`&&typeof e.name==`string`&&typeof e.bone==`string`&&typeof e.slot==`string`).map(e=>({id:e.id,name:e.name,bone:e.bone,slot:e.slot,source:typeof e.source==`string`?e.source:null,skin:typeof e.skin==`string`&&e.skin?e.skin:null,flip:!!e.flip,ground:typeof e.ground==`number`&&Number.isFinite(e.ground)?e.ground:0,clips:Object.fromEntries(Object.entries(e.clips&&typeof e.clips==`object`?e.clips:{}).map(([e,t])=>[e,(Array.isArray(t)?t:[]).map(st).filter(Boolean).sort((e,t)=>e.start-t.start)]))})),n={};for(let[t,r]of Object.entries(e.depth&&typeof e.depth==`object`?e.depth:{}))typeof r==`number`&&Number.isFinite(r)&&r>-950&&(n[t]=r);return{actors:t,depth:n,focal:typeof e.focal==`number`&&e.focal>0?e.focal:1e3}}const lt=`rigby-snapshot/1`,ut=[`normal`,`onlyTranslation`,`noRotationOrReflection`,`noScale`,`noScaleOrReflection`],dt=[`normal`,`additive`,`multiply`,`screen`],ft=[`linear`,`nearest`],pt=[`region`,`mesh`,`linkedmesh`,`boundingbox`,`path`,`point`,`clipping`];function mt(){return{fps:30,width:1920,height:1080,background:null,frame:null}}var R=class extends Error{constructor(e,t){super(e===`json`?`invalid JSON: ${t}`:`invalid skeleton: ${t}`),this.name=`LoadError`,this.kind=e}};function ht(e,t,n,r){return{name:e,parent:t,length:r,setup:n,inherit:`normal`,skinRequired:!1,color:null}}function gt(e){return e.weights?e.weights.length:e.type===`mesh`?e.uvs.length/2:e.vertexCount??(e.vertices?.length??0)/2}var _t=class e{constructor(){this.format=lt,this.name=`untitled`,this.bones=[ht(`root`,null,ie(),0)],this.slots=[],this.skins=[],this.skin=null,this.ik=[],this.events=[],this.animations=[],this.images=[],this.header=null,this.extra={},this.settings=mt(),this.settingsInFile=!1,this.textureFilter=`linear`,this.pixelGrid=0,this.poses=[],this.controllers=[],this.workspace=null,this.audio=[],this.scene=null}static fromJson(t){let n;try{n=JSON.parse(t)}catch(e){throw new R(`json`,e.message)}let r=e.fromObject(n),i=r.validate();if(i)throw new R(`invalid`,i);return r}static fromObject(e){try{return kt(e)}catch(e){throw e instanceof R?e:new R(`json`,e.message)}}toObject(){return jt(this)}toSnapshot(){return JSON.stringify(this.toObject())}toJson(){return JSON.stringify(this.toObject(),null,2)}clone(){return e.fromObject(this.toObject())}validate(){let e=this.bones.length,t=this.slots.length;if(e===0)return`skeleton has no bones`;for(let t=0;t<e;t++){let e=this.bones[t].parent;if(e!==null&&e>=t)return`bone '${this.bones[t].name}' must come after its parent`}let n=(t,n)=>{for(let r of t.weights??[])for(let t of r)if(t.bone>=e)return`${n} references missing bone ${t.bone}`;return null};for(let t of this.slots){if(t.bone>=e)return`slot '${t.name}' references missing bone ${t.bone}`;for(let e of t.attachments){let t=n(e,`attachment '${e.name}'`);if(t)return t}}for(let e of this.skins)for(let r of e.slots){if(r.slot>=t)return`skin '${e.name}' references missing slot ${r.slot}`;for(let e of r.attachments){let t=n(e,`attachment '${e.name}'`);if(t)return t}}for(let t of this.ik)if(t.target>=e||t.bones.some(t=>t>=e))return`IK constraint '${t.name}' references a missing bone`;for(let n of this.animations){for(let t of n.bones)if(t.bone>=e)return`animation '${n.name}' references missing bone ${t.bone}`;for(let e of n.slots)if(e.slot>=t)return`animation '${n.name}' references missing slot ${e.slot}`;for(let e of n.deform)if(e.slot>=t)return`animation '${n.name}' references missing slot ${e.slot}`;for(let e of n.ik)if(e.constraint>=this.ik.length)return`animation '${n.name}' references missing IK constraint`}return null}boneIndex(e){let t=this.bones.findIndex(t=>t.name===e);return t<0?null:t}slotIndex(e){let t=this.slots.findIndex(t=>t.name===e);return t<0?null:t}animation(e){return this.animations.find(t=>t.name===e)}findSkin(e){return this.skins.find(t=>t.name===e)}skinAttachments(e,t){return t==null||t==="default"?this.slots[e]?.attachments??[]:this.findSkin(t)?.slots.find(t=>t.slot===e)?.attachments??[]}attachment(e,t,n=this.skin){if(t!=null){if(n){let r=this.skinAttachments(e,n).find(e=>e.name===t);if(r)return r}return this.slots[e]?.attachments.find(e=>e.name===t)}}meshSource(e,t){if(t.type!==`linkedmesh`)return t;let n=this.skinAttachments(e,t.skin).find(e=>e.name===t.parent)??this.attachment(e,t.parent);return n&&n.type===`mesh`?n:null}children(e){let t=[];return this.bones.forEach((n,r)=>{n.parent===e&&t.push(r)}),t}isDescendant(e,t){let n=e;for(;n!=null;){if(n===t)return!0;n=this.bones[n].parent}return!1}uniqueBoneName(e){return vt(e,e=>this.boneIndex(e)!==null)}uniqueSlotName(e){return vt(e,e=>this.slotIndex(e)!==null)}addBone(e){e.inherit??=`normal`,e.skinRequired??=!1,e.color??=null;let t;if(e.parent===null)t=this.bones.length;else{let n=e.parent;for(t=n+1;t<this.bones.length&&this.isDescendant(t,n);)t++}this.bones.splice(t,0,e);let n=e=>e>=t?e+1:e;return this.bones.forEach((e,r)=>{r!==t&&e.parent!==null&&(e.parent=n(e.parent))}),this.remapBoneRefs(n),t}removeBone(e){if(e===0)return;let t=this.bones.map((t,n)=>this.isDescendant(n,e)),n=[],r=0;for(let e of t)n.push(e?null:r++);this.bones=this.bones.filter((e,n)=>!t[n]);for(let e of this.bones)e.parent=e.parent===null?null:n[e.parent];for(let e=this.slots.length-1;e>=0;e--)t[this.slots[e].bone]&&this.removeSlot(e);this.remapBoneRefs(e=>n[e]),s(this)}reparentBone(e,t){if(e===0||this.isDescendant(t,e))return;let n=this.bones.map((e,t)=>t),r=n.filter(t=>this.isDescendant(t,e)),i=n.filter(e=>!r.includes(e)),a=i.indexOf(t)+1;for(;a<i.length&&this.isDescendant(i[a],t);)a++;let o=[...i.slice(0,a),...r,...i.slice(a)],s=[];o.forEach((e,t)=>s[e]=t),this.bones[e].parent=t,this.bones=o.map(e=>this.bones[e]);for(let e of this.bones)e.parent!==null&&(e.parent=s[e.parent]);this.remapBoneRefs(e=>s[e])}removeSlot(e){this.slots.splice(e,1),this.remapSlotRefs(t=>t===e?null:t>e?t-1:t),s(this)}moveSlot(e,t){if(e===t||e>=this.slots.length||t>=this.slots.length)return;let[n]=this.slots.splice(e,1);this.slots.splice(t,0,n),this.remapSlotRefs(n=>n===e?t:e<t&&n>e&&n<=t?n-1:t<e&&n>=t&&n<e?n+1:n)}remapSlotRefs(e){let t=t=>e(t)!==null&&e(t)!==void 0;for(let n of this.skins){n.slots=n.slots.filter(e=>t(e.slot));for(let t of n.slots)t.slot=e(t.slot)}for(let n of this.animations){n.slots=n.slots.filter(e=>t(e.slot));for(let t of n.slots)t.slot=e(t.slot);n.deform=n.deform.filter(e=>t(e.slot));for(let t of n.deform)t.slot=e(t.slot);for(let r of n.drawOrder)if(r.value){r.value=r.value.filter(e=>t(e.slot));for(let t of r.value)t.slot=e(t.slot)}}let n=n=>{n.type===`clipping`&&n.end!==null&&n.end!==void 0&&(n.end=t(n.end)?e(n.end):null)};for(let e of this.slots)e.attachments.forEach(n);for(let e of this.skins)for(let t of e.slots)t.attachments.forEach(n)}remapBoneRefs(e){let t=t=>e(t)!==null&&e(t)!==void 0,n=t=>{for(let n of t.weights??[])for(let t of n)t.bone=e(t.bone)??0};for(let t of this.slots)t.bone=e(t.bone)??0,t.attachments.forEach(n);for(let r of this.skins){r.bones=r.bones.filter(t).map(e);for(let e of r.slots)e.attachments.forEach(n)}let r=[];this.ik=this.ik.filter((e,n)=>{let i=t(e.target)&&e.bones.every(t);return i||r.push(n),i});for(let t of this.ik)t.target=e(t.target),t.bones=t.bones.map(e);for(let n of this.animations){n.bones=n.bones.filter(e=>t(e.bone));for(let t of n.bones)t.bone=e(t.bone);if(r.length){n.ik=n.ik.filter(e=>!r.includes(e.constraint));for(let e of n.ik)e.constraint-=r.filter(t=>t<e.constraint).length}}}};function vt(e,t){if(!t(e))return e;for(let n=2;;n++){let r=`${e}${n}`;if(!t(r))return r}}function z(e,t,n){if(e==null){if(t===void 0)throw new R(`json`,`missing field \`${n}\``);return t}if(typeof e!=`number`||!Number.isFinite(e))throw new R(`json`,`\`${n}\` must be a number`);return e}function B(e,t,n=!1){if(e==null&&n)return null;if(!Number.isInteger(e)||e<0)throw new R(`json`,`\`${t}\` must be a non-negative integer`);return e}function V(e,t,n){if(e==null){if(t===void 0)throw new R(`json`,`missing field \`${n}\``);return t}if(typeof e!=`string`)throw new R(`json`,`\`${n}\` must be a string`);return e}function H(e,t){if(e==null)return[];if(!Array.isArray(e))throw new R(`json`,`\`${t}\` must be an array`);return e}function U(e,t,n){if(!Array.isArray(e)||t!==null&&e.length!==t)throw new R(`json`,`\`${n}\` must have ${t} numbers`);return e.map(e=>z(e,void 0,n))}const yt=(e,t,n)=>e==null?null:U(e,t,n),W=(e,t)=>typeof e==`boolean`?e:t,G=(e,t,n)=>t.includes(e)?e:n,K=e=>e===void 0?void 0:JSON.parse(JSON.stringify(e)),q=e=>e.extra&&typeof e.extra==`object`&&Object.keys(e.extra).length?{extra:K(e.extra)}:{},bt=(e,t)=>{t.extra&&Object.keys(t.extra).length&&(e.extra=K(t.extra))};function xt(e){return{x:z(e.x,0,`x`),y:z(e.y,0,`y`),rotation:z(e.rotation,0,`rotation`),scale_x:z(e.scale_x,1,`scale_x`),scale_y:z(e.scale_y,1,`scale_y`),shear_x:z(e.shear_x,0,`shear_x`),shear_y:z(e.shear_y,0,`shear_y`)}}function St(e){let t={x:e.x,y:e.y,rotation:e.rotation,scale_x:e.scale_x,scale_y:e.scale_y};return e.shear_x&&(t.shear_x=e.shear_x),e.shear_y&&(t.shear_y=e.shear_y),t}function J(e,t,n){return H(e,t).map(e=>le(z(e.time,void 0,`time`),n(e.value),g(e.curve??`linear`)))}function Y(e,t){return e.map(e=>{let n={time:e.time,value:t(e.value)};return e.curve!==`linear`&&(n.curve=g(e.curve)),n})}const Ct=e=>e==null?null:V(e,void 0,`value`),wt=e=>Array.isArray(e)?e.slice():e&&typeof e==`object`?K(e):e,Tt={rotate:e=>z(e,void 0,`value`),translate:e=>U(e,2,`value`),scale:e=>U(e,2,`value`),shear:e=>U(e,2,`value`),translateX:e=>z(e,void 0,`value`),translateY:e=>z(e,void 0,`value`),scaleX:e=>z(e,void 0,`value`),scaleY:e=>z(e,void 0,`value`),shearX:e=>z(e,void 0,`value`),shearY:e=>z(e,void 0,`value`),inherit:e=>G(e,ut,`normal`)},Et={attachment:Ct,color:e=>U(e,4,`value`),rgb:e=>U(e,3,`value`),alpha:e=>z(e,void 0,`value`),rgba2:e=>U(e,7,`value`),rgb2:e=>U(e,6,`value`)};function Dt(e){let t=G(e.type,pt,`region`),n={name:V(e.name,void 0,`name`),type:t,image:V(e.image,e.name,`image`),color:e.color===void 0?[1,1,1,1]:U(e.color,4,`color`)};return(t===`region`||t===`point`)&&(n.offset=xt(e)),(t===`region`||e.width!==void 0)&&(n.width=z(e.width,void 0,`width`)),(t===`region`||e.height!==void 0)&&(n.height=z(e.height,void 0,`height`)),t===`mesh`&&(n.uvs=U(e.uvs,null,`uvs`),n.triangles=H(e.triangles,`triangles`).map(e=>B(e,`triangles`)),n.hull=z(e.hull,0,`hull`),n.edges=e.edges?H(e.edges,`edges`).map(e=>B(e,`edges`)):null),t===`linkedmesh`&&(n.parent=V(e.parent,void 0,`parent`),n.skin=e.skin===void 0||e.skin===null?null:V(e.skin,void 0,`skin`),n.deform=W(e.deform,!0)),[`mesh`,`boundingbox`,`path`,`clipping`].includes(t)&&(n.vertices=e.vertices?U(e.vertices,null,`vertices`):null,n.weights=e.weights?H(e.weights,`weights`).map(e=>H(e,`weights`).map(e=>({bone:B(e.bone,`bone`),x:z(e.x,0,`x`),y:z(e.y,0,`y`),weight:z(e.weight,0,`weight`)}))):null,t!==`mesh`&&(n.vertexCount=B(e.vertexCount??0,`vertexCount`))),t===`path`&&(n.closed=W(e.closed,!1),n.constantSpeed=W(e.constantSpeed,!0),n.lengths=e.lengths?U(e.lengths,null,`lengths`):[]),t===`clipping`&&(n.end=B(e.end,`end`,!0)),e.sequence!==void 0&&(n.sequence=K(e.sequence)),e.colorSet&&(n.colorSet=!0),Object.assign(n,q(e)),n}function Ot(e){let t={name:e.name};e.type!==`region`&&(t.type=e.type),e.image!==e.name&&(t.image=e.image),e.offset&&Object.assign(t,St(e.offset)),e.width!==void 0&&(t.width=e.width),e.height!==void 0&&(t.height=e.height),e.color&&e.color.some(e=>e!==1)&&(t.color=e.color.slice());for(let n of[`uvs`,`triangles`,`hull`,`edges`,`vertices`,`vertexCount`,`parent`,`skin`,`deform`,`closed`,`constantSpeed`,`lengths`,`end`])e[n]!==void 0&&e[n]!==null&&(t[n]=wt(e[n]));return e.weights&&(t.weights=e.weights.map(e=>e.map(e=>({...e})))),e.sequence!==void 0&&(t.sequence=K(e.sequence)),e.colorSet&&(t.colorSet=!0),bt(t,e),t}function kt(e){if(typeof e!=`object`||!e)throw new R(`json`,`expected an object`);let t=new _t;if(t.format=V(e.format,lt,`format`),t.name=V(e.name,``,`name`),!Array.isArray(e.bones))throw new R(`json`,"missing field `bones`");return t.bones=e.bones.map(e=>({...ht(V(e.name,void 0,`name`),B(e.parent,`parent`,!0),xt(e),z(e.length,0,`length`)),inherit:G(e.inherit,ut,`normal`),skinRequired:W(e.skinRequired,!1),color:e.color===void 0||e.color===null?null:V(e.color,void 0,`color`),...q(e)})),t.slots=H(e.slots,`slots`).map(e=>({name:V(e.name,void 0,`name`),bone:B(e.bone,`bone`),attachments:H(e.attachments,`attachments`).map(Dt),attachment:e.attachment===void 0||e.attachment===null?null:V(e.attachment,void 0,`attachment`),color:e.color===void 0?[1,1,1,1]:U(e.color,4,`color`),dark:yt(e.dark,3,`dark`),blend:G(e.blend,dt,`normal`),...q(e)})),t.skins=H(e.skins,`skins`).map(e=>({name:V(e.name,void 0,`name`),slots:H(e.slots,`slots`).map(e=>({slot:B(e.slot,`slot`),attachments:H(e.attachments,`attachments`).map(Dt)})),bones:H(e.bones,`bones`).map(e=>B(e,`bones`)),ik:H(e.ik,`ik`).map(e=>B(e,`ik`)),color:e.color??null,extra:K(e.extra)??{}})),t.skin=e.skin===void 0||e.skin===null?null:V(e.skin,void 0,`skin`),t.ik=H(e.ik,`ik`).map(e=>({name:V(e.name,void 0,`name`),order:z(e.order,0,`order`),skinRequired:W(e.skinRequired,!1),bones:H(e.bones,`bones`).map(e=>B(e,`bones`)),target:B(e.target,`target`),mix:z(e.mix,1,`mix`),softness:z(e.softness,0,`softness`),bendPositive:W(e.bendPositive,!0),compress:W(e.compress,!1),stretch:W(e.stretch,!1),uniform:W(e.uniform,!1),...q(e)})),t.events=H(e.events,`events`).map(e=>({name:V(e.name,void 0,`name`),int:z(e.int,0,`int`),float:z(e.float,0,`float`),string:e.string===void 0||e.string===null?null:V(e.string,void 0,`string`),audio:e.audio===void 0||e.audio===null?null:V(e.audio,void 0,`audio`),volume:z(e.volume,1,`volume`),balance:z(e.balance,0,`balance`),...q(e)})),t.animations=H(e.animations,`animations`).map(e=>{let t=new ve(V(e.name,void 0,`name`),z(e.duration,void 0,`duration`));return t.bones=H(e.bones,`bones`).map(e=>{let t=ge(B(e.bone,`bone`));for(let n of T)t[n]=J(e[n],n,Tt[n]);return t}),t.slots=H(e.slots,`slots`).map(e=>{let t=_e(B(e.slot,`slot`));for(let n of E)t[n]=J(e[n],n,Et[n]);return t}),t.deform=H(e.deform,`deform`).map(e=>({skin:e.skin??null,slot:B(e.slot,`slot`),attachment:V(e.attachment,void 0,`attachment`),keys:J(e.keys,`keys`,e=>({offset:B(e?.offset??0,`offset`),vertices:U(e?.vertices??[],null,`vertices`)}))})),t.drawOrder=J(e.drawOrder,`drawOrder`,e=>e==null?null:H(e,`value`).map(e=>({slot:B(e.slot,`slot`),offset:z(e.offset,0,`offset`)}))),t.events=H(e.events,`events`).map(e=>({...K(e),time:z(e.time,0,`time`),name:V(e.name,void 0,`name`)})),t.ik=H(e.ik,`ik`).map(e=>({constraint:B(e.constraint,`constraint`),keys:J(e.keys,`keys`,e=>({...K(e)}))})),t.extra=K(e.extra)??{},t}),t.images=H(e.images,`images`).map(e=>({name:V(e.name,void 0,`name`),path:e.path===void 0||e.path===null?null:V(e.path,void 0,`path`),width:B(e.width,`width`),height:B(e.height,`height`)})),t.header=K(e.header)??null,t.extra=K(e.extra)??{},t.settings=At(e.settings),t.settingsInFile=e.settings!==void 0,t.textureFilter=G(e.textureFilter,ft,`linear`),t.pixelGrid=Number.isFinite(e.pixelGrid)&&e.pixelGrid>0?e.pixelGrid:0,t.poses=be(e.poses),t.controllers=xe(e.controllers),t.workspace=G(e.workspace,[`game`,`film`],null),t.scene=ct(e.scene),t.audio=H(e.audio,`audio`).filter(e=>e&&typeof e.sound==`string`&&typeof e.animation==`string`).map(e=>({sound:e.sound,animation:e.animation,offset:Number.isFinite(e.offset)?e.offset:0,volume:Number.isFinite(e.volume)?Math.max(0,e.volume):1})),t}function At(e){let t=mt();if(!e||typeof e!=`object`)return t;let n=(e,t,n)=>typeof e==`number`&&Number.isFinite(e)&&e>0&&e<=n?e:t,r=e=>Array.isArray(e)&&e.length===4&&e.every(e=>typeof e==`number`&&e>=0&&e<=1)?e.slice():null,i=e.frame,a=i&&typeof i==`object`&&[i.x,i.y].every(e=>typeof e==`number`&&Number.isFinite(e))&&n(i.scale,0,1e6)>0?{x:i.x,y:i.y,scale:i.scale,...i.camera?{camera:!0}:{}}:null;return{fps:n(e.fps,t.fps,240),width:Math.round(n(e.width,t.width,16384)),height:Math.round(n(e.height,t.height,16384)),background:r(e.background),frame:a}}function jt(e){let t={format:e.format,name:e.name,bones:e.bones.map(e=>{let t={name:e.name};return e.parent!==null&&(t.parent=e.parent),t.length=e.length,Object.assign(t,St(e.setup)),e.inherit&&e.inherit!==`normal`&&(t.inherit=e.inherit),e.skinRequired&&(t.skinRequired=!0),e.color&&(t.color=e.color),bt(t,e),t}),slots:e.slots.map(e=>{let t={name:e.name,bone:e.bone,attachments:e.attachments.map(Ot)};return e.attachment!==null&&(t.attachment=e.attachment),t.color=e.color.slice(),e.dark&&(t.dark=e.dark.slice()),e.blend&&e.blend!==`normal`&&(t.blend=e.blend),bt(t,e),t})};return e.skins.length&&(t.skins=e.skins.map(e=>{let t={name:e.name,slots:e.slots.map(e=>({slot:e.slot,attachments:e.attachments.map(Ot)}))};return e.bones.length&&(t.bones=e.bones.slice()),e.ik.length&&(t.ik=e.ik.slice()),e.color&&(t.color=e.color),Object.keys(e.extra??{}).length&&(t.extra=K(e.extra)),t})),e.skin&&(t.skin=e.skin),e.ik.length&&(t.ik=e.ik.map(e=>({...e,bones:e.bones.slice()}))),e.events.length&&(t.events=e.events.map(e=>({...e}))),t.animations=e.animations.map(e=>{let t={name:e.name,duration:e.duration};return e.bones.length&&(t.bones=e.bones.map(e=>{let t={bone:e.bone};for(let n of T)e[n].length&&(t[n]=Y(e[n],wt));return t})),e.slots.length&&(t.slots=e.slots.map(e=>{let t={slot:e.slot};for(let n of E)e[n].length&&(t[n]=Y(e[n],wt));return t})),e.deform.length&&(t.deform=e.deform.map(e=>({skin:e.skin,slot:e.slot,attachment:e.attachment,keys:Y(e.keys,e=>({offset:e.offset,vertices:e.vertices.slice()}))}))),e.drawOrder.length&&(t.drawOrder=Y(e.drawOrder,e=>e?e.map(e=>({...e})):null)),e.events.length&&(t.events=e.events.map(e=>({...e}))),e.ik.length&&(t.ik=e.ik.map(e=>({constraint:e.constraint,keys:Y(e.keys,e=>({...e}))}))),Object.keys(e.extra).length&&(t.extra=K(e.extra)),t}),e.images.length&&(t.images=e.images.map(e=>{let t={name:e.name};return e.path!==null&&(t.path=e.path),t.width=e.width,t.height=e.height,t})),e.header&&(t.header=K(e.header)),Object.keys(e.extra).length&&(t.extra=K(e.extra)),(e.settingsInFile||JSON.stringify(e.settings)!==JSON.stringify(mt()))&&(t.settings=K(e.settings)),e.textureFilter!==`linear`&&(t.textureFilter=e.textureFilter),e.pixelGrid>0&&(t.pixelGrid=e.pixelGrid),e.poses.length&&(t.poses=K(e.poses)),e.controllers.length&&(t.controllers=K(e.controllers)),e.workspace&&(t.workspace=e.workspace),e.audio.length&&(t.audio=K(e.audio)),e.scene&&(t.scene=K(e.scene)),t}(()=>{let e=/* @__PURE__ */ new Uint32Array(256);for(let t=0;t<256;t++){let n=t;for(let e=0;e<8;e++)n=n&1?3988292384^n>>>1:n>>>1;e[t]=n>>>0}return e})();const X={linear:c,stepped:l,ease_in:d,ease_out:f,ease_in_out:u},Mt=[`x`,`y`,`rotation`,`scale_x`,`scale_y`,`shear_x`,`shear_y`];var Nt=class extends Error{constructor(e){super(e),this.name=`RigbyError`}};const Z=e=>{throw new Nt(e)};function Q(e,t){let n=e.bones.findIndex(e=>e.name===t);return n<0&&Z(`No bone '${t}'`),n}function Pt(e,t){let n=e.slots.findIndex(e=>e.name===t);return n<0&&Z(`No slot '${t}'`),n}function Ft(e,t){if(t==null){let t=e.currentAnimation();return t||Z(`No current animation: pass an animation name or open one`),t}return e.doc.animations.find(e=>e.name===t)??Z(`No animation '${t}'`)}function $(e,t){return(typeof e!=`number`||!Number.isFinite(e))&&Z(`${t} must be a number`),e}function It(e,t){(typeof e!=`string`||!e.trim())&&Z(`The ${t} name must be a non-empty string`)}const Lt=e=>e===`stepped`?`stepped`:h(e)?Object.entries(X).find(([,t])=>t===e)?.[0]??`bezier`:`linear`,Rt=(e,t)=>({name:t.name,parent:t.parent===null?null:e.bones[t.parent].name,length:t.length,...Object.fromEntries(Mt.map(e=>[e,t.setup[e]]))}),zt=(e,t)=>({name:t.name,bone:e.bones[t.bone].name,attachment:t.attachment,attachments:t.attachments.map(e=>e.name),color:[...t.color]});function Bt(e,t){return w.includes(e)||Z(`Unknown channel '${e}'; use one of ${w.join(`, `)}`),e===`rotate`?$(t,`A rotate key value`):((!Array.isArray(t)||t.length!==2)&&Z(`A ${e} key value must be [x, y]`),[$(t[0],`${e} x`),$(t[1],`${e} y`)])}const Vt={info(e){let t=e.currentAnimation();return{path:e.path,workspace:e.workspace,fps:e.doc.settings?.fps??30,mode:e.mode,time:e.time,animation:t?.name??null,skin:e.doc.skin??null}},bones:e=>e.doc.bones.map(t=>Rt(e.doc,t)),bone:(e,{name:t})=>Rt(e.doc,e.doc.bones[Q(e.doc,t)]),add_bone(e,{name:t,parent:n=`root`,x:r=0,y:i=0,rotation:a=0,length:o=0}){let s=e.doc;It(t,`bone`),s.bones.some(e=>e.name===t)&&Z(`A bone named '${t}' already exists`);let c=Q(s,n);return s.bones.push(ht(t,c,re($(r,`x`),$(i,`y`),$(a,`rotation`)),Math.max(0,$(o,`length`)))),Rt(s,s.bones[s.bones.length-1])},set_bone(e,{name:t,fields:n}){let r=e.doc.bones[Q(e.doc,t)];for(let[t,i]of Object.entries(n??{}))t===`length`?r.length=Math.max(0,$(i,`length`)):Mt.includes(t)?r.setup[t]=$(i,t):t===`name`?(It(i,`bone`),i!==r.name&&e.doc.bones.some(e=>e.name===i)&&Z(`A bone named '${i}' already exists`),r.name=i):Z(`Bones have no field '${t}'`);return Rt(e.doc,r)},world(e,{name:t}){let n=Q(e.doc,t),r=e.pose().world[n];return{x:r.tx,y:r.ty,rotation:Math.atan2(r.b,r.a)*180/Math.PI,scale_x:Math.hypot(r.a,r.b),scale_y:Math.hypot(r.c,r.d)}},slots:e=>e.doc.slots.map(t=>zt(e.doc,t)),set_slot(e,{name:t,fields:n}){let r=e.doc.slots[Pt(e.doc,t)];for(let[e,t]of Object.entries(n??{}))e===`attachment`?(t!==null&&!r.attachments.some(e=>e.name===t)&&Z(`Slot '${r.name}' has no attachment '${t}'`),r.attachment=t):e===`color`?((!Array.isArray(t)||t.length!==4)&&Z(`color must be [r, g, b, a] with values 0..1`),r.color=t.map((e,t)=>Math.max(0,Math.min(1,$(e,`color[${t}]`))))):Z(`Slots have no field '${e}'`);return zt(e.doc,r)},animations:e=>e.doc.animations.map(e=>({name:e.name,duration:e.duration})),add_animation(e,{name:t,duration:n=0}){return It(t,`animation`),e.doc.animations.some(e=>e.name===t)&&Z(`An animation named '${t}' already exists`),e.doc.animations.push(new ve(t,Math.max(0,$(n,`duration`)))),{name:t,duration:n}},set_duration(e,{animation:t,duration:n}){let r=Ft(e,t);return r.duration=Math.max(0,$(n,`duration`)),{name:r.name,duration:r.duration}},set_key(e,{animation:t=null,bone:n,channel:r,time:i=null,value:a,curve:o=`linear`}){let s=Ft(e,t),c=Q(e.doc,n),l=Bt(r,a);o in X||Z(`Unknown curve '${o}'; use one of ${Object.keys(X).join(`, `)}`);let u=Math.round(Math.max(0,$(i??e.time,`time`))*1e6)/1e6,d=s.boneTimelineMut(c)[r],f=he(d,u,l);return d[f].curve=X[o],u>s.duration&&(s.duration=u),{animation:s.name,bone:n,channel:r,time:u,keys:d.length}},delete_key(e,{animation:t=null,bone:n,channel:r,time:i=null}){let a=Ft(e,t),o=Q(e.doc,n);w.includes(r)||Z(`Unknown channel '${r}'`);let s=i??e.time,c=a.boneTimeline(o)?.[r]??[],l=c.findIndex(e=>Math.abs(e.time-s)<5e-4);return l<0?!1:(c.splice(l,1),a.prune(),!0)},keys(e,{animation:t=null,bone:n,channel:r}){let i=Ft(e,t);return w.includes(r)||Z(`Unknown channel '${r}'`),(i.boneTimeline(Q(e.doc,n))?.[r]??[]).map(e=>({time:e.time,value:Array.isArray(e.value)?[...e.value]:e.value,curve:Lt(e.curve)}))},selection:e=>e.selectedBones().map(t=>e.doc.bones[t].name),select(e,{names:t}){let n=(t??[]).map(t=>Q(e.doc,t));return e.sel=n.length?{bone:n[0]}:null,e.multi=new Set(n),n.length},set_time(e,{time:t}){return e.playing=!1,e.time=Math.max(0,$(t,`time`)),e.time},set_animation(e,{name:t}){let n=e.doc.animations.findIndex(e=>e.name===t);return n<0&&Z(`No animation '${t}'`),e.anim=n,t},set_mode(e,{mode:t}){return t!==`setup`&&t!==`animate`&&Z(`mode must be 'setup' or 'animate'`),t===`animate`&&e.anim===null&&Z(`Open or add an animation before switching to animate mode`),e.playing=!1,e.mode=t,t}};function Ht(e,t,n,r){let i=r?JSON.parse(r):{};if(n===`log`)return JSON.stringify(t.log(i.level,i.text)??null);if(n===`status`)return JSON.stringify(t.status(i.text)??null);let a=Object.hasOwn(Vt,n)?Vt[n]:null;if(!a)throw new Nt(`Unknown function '${n}'`);return JSON.stringify(a(e,i)??null)}var Ut=class{load(e){this.doc=_t.fromObject(JSON.parse(e.snapshot)),this.anim=e.anim??null,this.mode=e.mode??`setup`,this.time=e.time??0,this.sel=e.sel??null,this.multi=new Set(e.multi??[]),this.path=e.path??null,this.workspace=e.workspace??`game`,this.playing=!1}currentAnimation(){return this.anim===null||this.anim===void 0?void 0:this.doc.animations[this.anim]}selectedBones(){let e=[...this.multi].filter(e=>e<this.doc.bones.length),t=this.sel&&this.sel.bone!==void 0?this.sel.bone:null;return t!==null&&!e.includes(t)&&e.unshift(t),e}pose(){let e=new $e(this.doc),t=this.currentAnimation();return this.mode===`animate`&&t&&e.apply(this.doc,t,this.time,1),e.updateWorld(this.doc),e}view(){return{anim:this.anim,mode:this.mode,time:this.time,sel:this.sel,multi:[...this.multi]}}};function Wt(e,t){let n;try{n=e.stat(t)}catch{return}if(!e.isDir(n.mode))return e.unlink(t);for(let n of e.readdir(t))n!==`.`&&n!==`..`&&Wt(e,`${t}/${n}`);e.rmdir(t)}var Gt=class{constructor(e,t){this.py=e,this.app=new Ut,this.logs=[],this.status=null,e.setStdout({batched:e=>this.logs.push({level:`info`,text:e})}),e.setStderr({batched:e=>this.logs.push({level:`warn`,text:e})}),e.registerJsModule(`_rigby_bridge`,{call:(e,t)=>Ht(this.app,{log:(e,t)=>this.logs.push({level:e===`warn`||e===`error`?e:`info`,text:String(t)}),status:e=>this.status=String(e)},e,t)}),e.FS.mkdirTree(`/rigby`),e.FS.writeFile(`/rigby/rigby.py`,t),e.runPython(`import sys
if '/rigby' not in sys.path: sys.path.insert(0, '/rigby')
sys.modules.pop('rigby', None)
sys.modules.pop('_rigby_bridge', None)
import rigby`),this.rigby=e.pyimport(`rigby`)}handle(e){let t=this.py;switch(e.type){case`init`:return{ok:!0,python:t.runPython(`import sys; sys.version.split()[0]`)};case`run`:return this.transaction(e.state,e.name,()=>{this.rigby._begin(e.name);let n=t.globals.get(`dict`)();try{n.set(`__name__`,`__main__`),t.runPython(e.source,{globals:n,filename:e.name})}finally{n.destroy()}return{tools:JSON.parse(this.rigby._collect(e.name))}});case`tool`:return this.transaction(e.state,e.script,()=>(this.rigby._run(e.script,e.label),{}));case`forget`:return this.rigby._forget(e.name),{ok:!0};case`files`:Wt(t.FS,e.root);for(let n of e.files){let r=`${e.root}/${n.path}`;t.FS.mkdirTree(r.slice(0,r.lastIndexOf(`/`))),t.FS.writeFile(r,n.bytes)}return{ok:!0};case`removeFiles`:return Wt(t.FS,e.root),{ok:!0};case`readInfo`:t.globals.set(`_addon_source`,e.source);try{return{ok:!0,info:JSON.parse(t.runPython(`
import ast, json
def _read_addon_info(source):
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "addon_info" for t in node.targets):
            return json.dumps(ast.literal_eval(node.value))
    return "null"
_read_addon_info(_addon_source)
`))}}catch(e){return{ok:!1,error:Kt(e,`addon_info`).message}}finally{t.globals.delete(`_addon_source`)}default:return{ok:!1,error:`unknown request '${e.type}'`}}}transaction(e,t,n){this.app.load(e);let r=this.app.doc.toSnapshot();this.logs=[],this.status=null;try{let e=n(),t=this.app.doc.toSnapshot();return{ok:!0,...e,snapshot:t===r?null:t,view:this.app.view(),status:this.status,logs:this.logs}}catch(e){let{message:n,trace:r}=Kt(e,t);return{ok:!1,error:n,trace:r,logs:this.logs}}}};function Kt(e,t){let n=String(e?.message??e);if(e?.type===void 0&&!/Traceback \(most recent call last\)/.test(n))return{message:e?.message||String(e??`Unknown error`),trace:e?.stack??null};let r=n.replace(/\s+$/,``).split(`
`),i=r[r.length-1],a=[],o=null,s=[],c=[];for(let e of r){let t=/^ {2}File "([^"]*)", line \d+/.exec(e);t?(o={file:t[1],lines:[e]},a.push(o)):o&&/^ {4}/.test(e)?o.lines.push(e):a.length?(o=null,c.push(e)):s.push(e)}let l=e=>e.file.startsWith(`/lib/`)||e.file.includes(`_pyodide`)||e.file===`/rigby/rigby.py`||e.file===`<exec>`,u=a.filter(e=>!l(e)),d=u.length?u:a,f=[...s,...d.flatMap(e=>e.lines),...c].join(`
`);return{message:i.replace(/^rigby\.RigbyError: /,``).replace(/^RigbyError: /,``)||`${t} failed`,trace:f}}const qt=[`fetch`,`XMLHttpRequest`,`WebSocket`,`WebSocketStream`,`EventSource`,`WebTransport`,`importScripts`,`indexedDB`,`caches`,`Worker`,`SharedWorker`,`BroadcastChannel`,`cookieStore`];function Jt(){for(let e of qt){for(let t=self;t;t=Object.getPrototypeOf(t))Object.getOwnPropertyDescriptor(t,e)?.configurable&&delete t[e];try{Object.defineProperty(self,e,{value:void 0,writable:!1,configurable:!1})}catch{}}if(self.navigator&&`storage`in self.navigator)try{Object.defineProperty(self.navigator,"storage",{value:void 0})}catch{}}const Yt=(async()=>{let e=new URL(`./pyodide/`,self.location.href).href,{loadPyodide:t}=await import(
/* @vite-ignore */
`${e}pyodide.mjs`),n=new Gt(await t({indexURL:e}),`# SPDX-License-Identifier: MIT OR Apache-2.0
"""Rigby2D scripting API.

Scripts edit the open project and add custom tools to the Scripts menu::

    import rigby

    @rigby.tool("Mirror selected bones", description="Flip the selected bones across X = 0")
    def mirror():
        for bone in rigby.selected_bones():
            bone.x = -bone.x
            bone.rotation = 180 - bone.rotation

A whole script run, or one run of a tool, is a single undo step. When it raises an exception the
project is left exactly as it was, and the traceback appears in the log (View > Log).
"""

import json as _json

import _rigby_bridge as _bridge

__all__ = [
    "RigbyError", "Bone", "Slot", "Animation",
    "info", "bones", "bone", "add_bone", "slots", "slot",
    "animations", "animation", "add_animation", "current_animation",
    "selected_bones", "select", "time", "set_time", "mode", "set_mode", "fps",
    "log", "warn", "error", "status", "tool", "tools",
]

CHANNELS = ("rotate", "translate", "scale", "shear")
CURVES = ("linear", "stepped", "ease_in", "ease_out", "ease_in_out")


class RigbyError(Exception):
    """A request the editor cannot do: an unknown name, a bad value."""


def _call(function, /, **args):
    try:
        result = _bridge.call(function, _json.dumps(args))
    except Exception as e:  # JsException: the editor refused the call
        message = str(e)
        for prefix in ("RigbyError: ", "Error: "):
            if prefix in message:
                message = message.split(prefix, 1)[1]
        raise RigbyError(message.strip()) from None
    return _json.loads(result)


# ---- objects ------------------------------------------------------------------------------------


class Bone:
    """A bone. Setup-pose fields are relative to the parent bone; setting one changes the setup pose."""

    __slots__ = ("_name",)
    _FIELDS = ("x", "y", "rotation", "scale_x", "scale_y", "shear_x", "shear_y", "length")

    def __init__(self, name):
        object.__setattr__(self, "_name", name)

    @property
    def name(self):
        return self._name

    @name.setter
    def name(self, value):
        _call("set_bone", name=self._name, fields={"name": value})
        object.__setattr__(self, "_name", value)

    def _data(self):
        return _call("bone", name=self._name)

    def __getattr__(self, field):
        if field in Bone._FIELDS:
            return self._data()[field]
        raise AttributeError(f"Bone has no attribute '{field}'")

    def __setattr__(self, field, value):
        if field in Bone._FIELDS:
            _call("set_bone", name=self._name, fields={field: value})
        elif field == "name":
            Bone.name.fset(self, value)
        else:
            raise AttributeError(f"Bone has no attribute '{field}'")

    def set(self, **fields):
        """Sets several setup fields at once: bone.set(x=10, rotation=45)."""
        _call("set_bone", name=self._name, fields=fields)
        return self

    @property
    def parent(self):
        p = self._data()["parent"]
        return Bone(p) if p is not None else None

    @property
    def children(self):
        return [Bone(b["name"]) for b in _call("bones") if b["parent"] == self._name]

    @property
    def world(self):
        """World transform in the pose shown: dict with x, y, rotation, scale_x, scale_y."""
        return _call("world", name=self._name)

    def key(self, channel, value, time=None, animation=None, curve="linear"):
        """Keys a channel ('rotate', 'translate', 'scale', 'shear') at \`time\` (default: current time).

        Values are relative to the setup pose: rotate adds degrees; translate and shear add (x, y);
        scale multiplies by (x, y).
        """
        if channel != "rotate":
            value = [float(value[0]), float(value[1])]
        return _call("set_key", animation=animation, bone=self._name, channel=channel, time=time, value=value, curve=curve)

    def delete_key(self, channel, time=None, animation=None):
        return _call("delete_key", animation=animation, bone=self._name, channel=channel, time=time)

    def keys(self, channel, animation=None):
        """Keys of a channel: list of dicts with time, value and curve."""
        return _call("keys", animation=animation, bone=self._name, channel=channel)

    def __eq__(self, other):
        return isinstance(other, Bone) and other._name == self._name

    def __hash__(self):
        return hash(("bone", self._name))

    def __repr__(self):
        return f"Bone({self._name!r})"


class Slot:
    """A slot: what is drawn for a bone, and in which color."""

    def __init__(self, name):
        self._name = name

    @property
    def name(self):
        return self._name

    def _data(self):
        for s in _call("slots"):
            if s["name"] == self._name:
                return s
        raise RigbyError(f"No slot '{self._name}'")

    @property
    def bone(self):
        return Bone(self._data()["bone"])

    @property
    def attachments(self):
        return list(self._data()["attachments"])

    @property
    def attachment(self):
        return self._data()["attachment"]

    @attachment.setter
    def attachment(self, name):
        _call("set_slot", name=self._name, fields={"attachment": name})

    @property
    def color(self):
        return tuple(self._data()["color"])

    @color.setter
    def color(self, rgba):
        _call("set_slot", name=self._name, fields={"color": [float(c) for c in rgba]})

    def __repr__(self):
        return f"Slot({self._name!r})"


class Animation:
    def __init__(self, name):
        self._name = name

    @property
    def name(self):
        return self._name

    @property
    def duration(self):
        for a in _call("animations"):
            if a["name"] == self._name:
                return a["duration"]
        raise RigbyError(f"No animation '{self._name}'")

    @duration.setter
    def duration(self, seconds):
        _call("set_duration", animation=self._name, duration=seconds)

    def key(self, bone, channel, time, value, curve="linear"):
        b = bone.name if isinstance(bone, Bone) else bone
        return Bone(b).key(channel, value, time=time, animation=self._name, curve=curve)

    def open(self):
        """Shows this animation in the editor."""
        _call("set_animation", name=self._name)
        return self

    def __repr__(self):
        return f"Animation({self._name!r})"


# ---- project ------------------------------------------------------------------------------------


def info():
    """The open project: path, workspace, fps, mode, time, animation, skin."""
    return _call("info")


def bones():
    return [Bone(b["name"]) for b in _call("bones")]


def bone(name):
    _call("bone", name=name)
    return Bone(name)


def add_bone(name, parent="root", x=0.0, y=0.0, rotation=0.0, length=0.0):
    p = parent.name if isinstance(parent, Bone) else parent
    _call("add_bone", name=name, parent=p, x=x, y=y, rotation=rotation, length=length)
    return Bone(name)


def slots():
    return [Slot(s["name"]) for s in _call("slots")]


def slot(name):
    s = Slot(name)
    s._data()
    return s


def animations():
    return [Animation(a["name"]) for a in _call("animations")]


def animation(name):
    a = Animation(name)
    a.duration  # raises if missing
    return a


def add_animation(name, duration=0.0):
    _call("add_animation", name=name, duration=duration)
    return Animation(name)


def current_animation():
    name = info()["animation"]
    return Animation(name) if name is not None else None


def selected_bones():
    return [Bone(n) for n in _call("selection")]


def select(*bones_or_names):
    names = [b.name if isinstance(b, Bone) else b for b in bones_or_names]
    return _call("select", names=names)


def time():
    return info()["time"]


def set_time(seconds):
    return _call("set_time", time=seconds)


def mode():
    return info()["mode"]


def set_mode(value):
    return _call("set_mode", mode=value)


def fps():
    return info()["fps"]


# ---- output -------------------------------------------------------------------------------------


def _text(args):
    return " ".join(str(a) for a in args)


def log(*args):
    _call("log", level="info", text=_text(args))


def warn(*args):
    _call("log", level="warn", text=_text(args))


def error(*args):
    _call("log", level="error", text=_text(args))


def status(text):
    """Shows a message in the status bar."""
    _call("status", text=str(text))


# ---- tools --------------------------------------------------------------------------------------

_tools = {}


def tool(label, description=""):
    """Decorator: adds a function (no arguments) to the Scripts menu as a tool."""

    def register(fn):
        if not callable(fn):
            raise TypeError("@rigby.tool decorates a function")
        _tools[label] = {"label": label, "description": description, "fn": fn}
        return fn

    return register


def tools():
    return list(_tools)


# Called by the editor. Tools are kept per script, so reloading a script replaces only its tools.
_registry = {}


def _begin(script):
    _tools.clear()


def _collect(script):
    _registry[script] = dict(_tools)
    _tools.clear()
    return _json.dumps([{"label": t["label"], "description": t["description"]} for t in _registry[script].values()])


def _forget(script):
    _registry.pop(script, None)
    _tools.clear()


def _run(script, label):
    _registry[script][label]["fn"]()
`);return Jt(),n})();self.onmessage=async e=>{let{id:t,...n}=e.data??{};try{let e=(await Yt).handle(n);self.postMessage({id:t,...e})}catch(e){self.postMessage({id:t,ok:!1,error:String(e?.message??e)})}};