/*
  3D model of the MycoAI mascot for the home page hero: a mushroom robot on a floating island,
  in toon shading with ink outlines; in dark mode it stands in the rain (the cap shelters it).
  The scene code matches _private/mockup/mycoai-3d-hero_new.html.

  Loading: this file is the only 3D script on the page (home page only, defer). three.js r128
  and OrbitControls (assets/js/vendor/) are loaded only when #stage comes near the viewport and
  the browser is idle. The logo image stays visible in the stage until the scene is running, so
  without WebGL or when anything here fails, visitors see the logo instead of an empty box, and
  the reason is logged with console.warn.

  The vendored files get the same ?v=<build time> as this file (_layouts/default.html), so
  returning visitors do not get stale copies from the browser cache.
*/
(function(){
  const stage=document.getElementById('stage'), script=document.currentScript;
  if(!stage||!script)return;
  /* the logo stays (it is shown until the scene runs); say why */
  const warn=reason=>console.warn('MycoAI 3D model not shown, showing the logo instead: '+reason);
  function fallBack(reason){
    stage.classList.remove('is-3d');
    const canvas=stage.querySelector('canvas'); if(canvas)canvas.remove();
    warn(reason);
  }
  if(!window.IntersectionObserver){warn('this browser has no IntersectionObserver'); return;}
  const base=script.src.replace(/hero3d\.js(\?.*)?$/,''), version=(script.src.match(/\?v=[^&#]*/)||[''])[0];
  const root=document.documentElement, system=matchMedia('(prefers-color-scheme: dark)');
  /* same rule as the theme toggle in _includes/header.html, including the system setting */
  const isDark=()=>root.getAttribute('data-theme')==='dark'||(!root.getAttribute('data-theme')&&system.matches);

  /* checked before three.js is downloaded; the test context is released right away */
  function hasWebGL(){
    try{
      const c=document.createElement('canvas'), gl=c.getContext('webgl2')||c.getContext('webgl');
      if(!gl)return false;
      const lose=gl.getExtension('WEBGL_lose_context'); if(lose)lose.loseContext();
      return true;
    }catch(e){return false;}
  }

  /* page text renders first; three.js is fetched only when the hero is near the viewport and the browser is idle */
  const load=src=>new Promise((ok,no)=>{const el=document.createElement('script'); el.src=src; el.onload=ok;
    el.onerror=()=>no(new Error('could not load script '+src)); document.head.appendChild(el);});
  const idle=window.requestIdleCallback||(f=>setTimeout(f,200));
  new IntersectionObserver((es,ob)=>{ if(!es[es.length-1].isIntersecting)return; ob.disconnect();
    idle(()=>{
      if(!hasWebGL()){fallBack('WebGL is not available in this browser'); return;}
      load(base+'vendor/three.min.js'+version)
        .then(()=>load(base+'vendor/OrbitControls.js'+version))
        .then(start3D)
        .catch(e=>fallBack(e&&e.message&&/^could not load script /.test(e.message)?e.message:'error while starting the 3D scene: '+(e&&e.message||e)));
    });
  },{rootMargin:'200px'}).observe(stage);

  function start3D(){
  /* render loop state, see frame() below */
  let visible=true, running=false, dirty=true, last=0, acc=0, t=0, slow=0, frames=0, lowFx=false, nextBlink=2;
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer=new THREE.WebGLRenderer({antialias:devicePixelRatio<1.5,alpha:true,powerPreference:'low-power'});
  let pr=Math.min(devicePixelRatio,1.5); renderer.setPixelRatio(pr);
  stage.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden','true');
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(34,1,0.1,100);
  const HOME=new THREE.Vector3(4.2,3.0,9.6), TARGET=new THREE.Vector3(0,1.25,0);
  camera.position.copy(HOME);
  scene.add(new THREE.AmbientLight(0xffffff,0.62));
  const key=new THREE.DirectionalLight(0xffffff,0.7); key.position.set(3,6,5); scene.add(key);

  /* logo palette */
  const C={orange:0xf39a2b, orangeDeep:0xe5801c, orangeLight:0xf9c784, rim:0xee8a22, gillBg:0xf6b45a,
           cream:0xf4ecd8, creamShade:0xe6dac0, ink:0x3a2a25, moss:0x9d9a45, mossDark:0x7e7d34,
           soil:0x4a3229, soilDark:0x3a2620, mini:0xef6f2e, white:0xffffff};

  /* toon shading with 3 tones, like a flat illustration */
  const gc=document.createElement('canvas'); gc.width=3; gc.height=1;
  const gx=gc.getContext('2d'); [150,210,255].forEach((v,i)=>{gx.fillStyle=`rgb(${v},${v},${v})`;gx.fillRect(i,0,1,1)});
  const grad=new THREE.CanvasTexture(gc); grad.minFilter=grad.magFilter=THREE.NearestFilter; grad.generateMipmaps=false;
  const toon=(c,extra)=>new THREE.MeshToonMaterial(Object.assign({color:c,gradientMap:grad},extra||{}));
  const flat=c=>new THREE.MeshBasicMaterial({color:c});
  const OUT=new THREE.MeshBasicMaterial({color:C.ink,side:THREE.BackSide});

  const SPH=new THREE.SphereGeometry(1,28,20), CYL=new THREE.CylinderGeometry(1,1,2,20);
  /* part: unit geometry scaled; outline = inverted hull W units thicker */
  function part(geo,mat,parent,pos,scl,rot,W){
    const m=new THREE.Mesh(geo,mat); m.position.set(...pos); m.scale.set(...scl); if(rot)m.rotation.set(...rot); parent.add(m);
    if(W!==0){const w=W||0.028; const o=new THREE.Mesh(geo,OUT); o.position.copy(m.position); o.rotation.copy(m.rotation);
      o.scale.set(scl[0]+w,scl[1]+w,scl[2]+w); parent.add(o);}
    return m;
  }
  const Y=new THREE.Vector3(0,1,0);
  function limb(parent,a,b,r,mat){
    const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),d=B.clone().sub(A),L=d.length();
    const q=new THREE.Quaternion().setFromUnitVectors(Y,d.normalize()), mid=A.clone().add(B).multiplyScalar(.5);
    [[mat,0],[OUT,0.028]].forEach(([mm,w])=>{const c=new THREE.Mesh(CYL,mm); if(mm===OUT)c.material=OUT; c.position.copy(mid); c.quaternion.copy(q); c.scale.set(r+w,L/2,r+w); parent.add(c);});
    part(SPH,mat,parent,b,[r,r,r]);
  }
  function roundBox(r){
    const g=new THREE.BoxGeometry(2,2,2,12,12,12), p=g.attributes.position, v=new THREE.Vector3(), c=new THREE.Vector3(), k=1-r;
    for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i); c.set(Math.max(-k,Math.min(k,v.x)),Math.max(-k,Math.min(k,v.y)),Math.max(-k,Math.min(k,v.z)));
      v.sub(c); if(v.lengthSq()>0)v.normalize().multiplyScalar(r); v.add(c); p.setXYZ(i,v.x,v.y,v.z);}
    g.computeVertexNormals(); return g;
  }

  const world=new THREE.Group(); scene.add(world);

  /* ---------- floating island ---------- */
  const island=new THREE.Group(); world.add(island);
  const mossGeo=new THREE.CylinderGeometry(2.05,2.15,0.2,14,1);
  { const p=mossGeo.attributes.position; for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i),a=Math.atan2(z,x),f=1+0.05*Math.sin(a*5)+0.03*Math.sin(a*11); p.setX(i,x*f); p.setZ(i,z*f);} mossGeo.computeVertexNormals(); }
  part(mossGeo,toon(C.moss),island,[0,-0.1,0],[1,1,1],null,0.03);
  part(new THREE.CylinderGeometry(2.1,1.55,0.6,14),toon(C.soil),island,[0,-0.5,0],[1,1,1],null,0.03);
  part(new THREE.BoxGeometry(1,1,1),toon(C.soilDark),island,[0,-0.92,0],[2.6,0.22,1.3],null,0.03);
  part(new THREE.BoxGeometry(1,1,1),toon(C.soilDark),island,[0,-1.16,0.05],[1.3,0.3,0.9],null,0.03);
  [[-0.35,-1.4],[0.4,-1.4]].forEach(([x,y])=>part(new THREE.BoxGeometry(1,1,1),toon(C.soilDark),island,[x,y,0.1],[0.12,0.22,0.12],null,0.025));
  [[0.3,C.orangeDeep],[0.9,C.moss],[-0.5,C.orangeDeep],[1.6,C.moss],[-1.1,C.orange],[2.4,C.moss]].forEach(([a,c],i)=>{
    const r=1.86-0.1*(i%2); part(SPH,flat(c),island,[Math.sin(a)*r,-0.48-0.12*(i%3),Math.cos(a)*r],[0.06,0.06,0.06],null,0);});
  /* moss tufts */
  for(let i=0;i<16;i++){const a=i/16*Math.PI*2+0.2,r=1.75+Math.random()*0.3;
    part(new THREE.ConeGeometry(1,1,5),toon(i%2?C.mossDark:C.moss),island,[Math.cos(a)*r,0.08,Math.sin(a)*r],[0.06,0.22+Math.random()*0.18,0.06],[(Math.random()-.5)*0.6,0,(Math.random()-.5)*0.6],0.02);}

  /* small orange mushrooms */
  [[2.1,1.25,0.95],[2.75,1.55,0.7],[0.6,1.5,1.05],[-0.7,1.35,0.8],[-1.9,1.55,1.0],[3.6,1.3,0.6],[4.4,1.6,0.85]].forEach(([a,r,h])=>{
    const g=new THREE.Group(); g.position.set(Math.cos(a)*r,0,Math.sin(a)*r); island.add(g);
    part(CYL,toon(C.cream),g,[0,h/2,0],[0.035,h/2,0.035],null,0.02);
    part(SPH,toon(C.mini),g,[0,h+0.03,0],[0.17,0.11,0.17],null,0.022);
    part(SPH,flat(C.orangeLight),g,[0.05,h+0.1,0.06],[0.035,0.02,0.035],null,0);
  });

  /* ---------- chibi robot (toon style, same treatment as the cap) ---------- */
  const W={suit:0xe8691c, suitDark:0xc9551a, pack:0xf07a2a, boot:0x8a6553, cuff:0xf3efe8, glove:0xe9e3d8,
           metal:0xd8d4cc, ring:0xb98245, wood:0xe2b783, eyeBlack:0x101315, iris:0x1f4c4e};
  const bot=new THREE.Group(); world.add(bot);
  const suit=toon(W.suit), suitDark=toon(W.suitDark), glove=toon(W.glove), cuff=toon(W.cuff), ink=flat(C.ink);
  /* chunky boots + short legs */
  [-1,1].forEach(s=>{
    part(SPH,toon(W.boot),bot,[s*0.19,0.1,0.06],[0.19,0.13,0.25]);
    part(new THREE.TorusGeometry(1,0.35,14,40),cuff,bot,[s*0.19,0.24,0],[0.15,0.15,0.15],[Math.PI/2,0,0],0);
    part(CYL,suit,bot,[s*0.19,0.34,0],[0.15,0.11,0.15]);
  });
  /* round belly torso + ribbed collar */
  function rbox(r){const g=new THREE.BoxGeometry(2,2,2,16,16,16),p=g.attributes.position,v=new THREE.Vector3(),c=new THREE.Vector3(),k=1-r;
    for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i);c.set(Math.max(-k,Math.min(k,v.x)),Math.max(-k,Math.min(k,v.y)),Math.max(-k,Math.min(k,v.z)));v.sub(c);if(v.lengthSq()>0)v.normalize().multiplyScalar(r);v.add(c);p.setXYZ(i,v.x,v.y,v.z);}
    g.computeVertexNormals();return g;}
  part(rbox(0.6),suit,bot,[0,0.7,0],[0.42,0.33,0.34]);
  part(new THREE.CylinderGeometry(0.3,0.37,0.2,40),suitDark,bot,[0,1.08,0],[1,1,1],null,0.025);
  for(let i=0;i<18;i++){const a=i/18*Math.PI*2; const m=new THREE.Mesh(new THREE.BoxGeometry(0.012,0.17,0.012),ink); m.position.set(Math.cos(a)*0.335,1.08,Math.sin(a)*0.335); m.rotation.set(0,-a,Math.cos(a)*0.0); m.lookAt(0,1.08,0); bot.add(m);}
  /* chest pack with 4 cross-screws */
  part(rbox(0.3),toon(W.pack),bot,[0,0.7,0.31],[0.3,0.26,0.07]);
  [[-0.16,0.85],[0.16,0.85],[-0.16,0.55],[0.16,0.55]].forEach(([x,y],i)=>{
    const r=i%3===0?0.06:0.078; part(CYL,toon(W.metal),bot,[x,y,0.39],[r,0.012,r],[Math.PI/2,0,0],0.018);
    const h=new THREE.Mesh(new THREE.BoxGeometry(r*1.4,0.01,0.006),ink); h.position.set(x,y,0.404); bot.add(h);
    const v=new THREE.Mesh(new THREE.BoxGeometry(0.01,r*1.4,0.006),ink); v.position.set(x,y,0.404); bot.add(v);
  });
  /* chubby arms with round gloves */
  const arms=[];
  [-1,1].forEach(s=>{
    const arm=new THREE.Group(); arm.position.set(s*0.42,0.92,0); bot.add(arm); arms.push([arm,s]);
    part(SPH,suit,arm,[0,0,0],[0.16,0.16,0.16]);
    limb(arm,[0,0,0],[s*0.12,-0.26,0.08],0.135,suit);
    part(new THREE.TorusGeometry(1,0.35,14,40),cuff,arm,[s*0.12,-0.31,0.08],[0.12,0.12,0.12],[Math.PI/2,0,0],0);
    part(SPH,glove,arm,[s*0.13,-0.43,0.1],[0.14,0.14,0.13]);
    [-0.06,0,0.06].forEach(o=>part(SPH,glove,arm,[s*0.13+o,-0.54,0.15],[0.042,0.06,0.042],null,0.02));
    part(SPH,glove,arm,[s*0.03,-0.45,0.19],[0.045,0.065,0.045],null,0.02);
  });
  /* big round wooden head */
  const woodCv=document.createElement('canvas'); woodCv.width=woodCv.height=256; const wx=woodCv.getContext('2d');
  wx.fillStyle='#ffffff'; wx.fillRect(0,0,256,256);
  for(let i=0;i<34;i++){const y=(i+Math.random()*.6)*7.5; wx.strokeStyle=`rgba(150,95,45,${0.10+Math.random()*0.12})`; wx.lineWidth=1+Math.random()*2; wx.beginPath(); wx.moveTo(0,y); for(let k=0;k<=256;k+=16)wx.lineTo(k,y+Math.sin(k*0.03+i)*3); wx.stroke();}
  const head=new THREE.Group(); head.position.set(0,1.72,0); bot.add(head);
  const headGeo=new THREE.SphereGeometry(1,64,48); { const p=headGeo.attributes.position; for(let i=0;i<p.count;i++){const y=p.getY(i);const f=1+0.08*Math.exp(-((y+0.6)*(y+0.6))/0.32);p.setX(i,p.getX(i)*f);p.setZ(i,p.getZ(i)*f);} headGeo.computeVertexNormals(); }
  part(headGeo,toon(W.wood,{map:new THREE.CanvasTexture(woodCv)}),head,[0,0,0],[0.66,0.6,0.6],null,0.03);
  part(CYL,toon(W.wood),head,[0,-0.58,0],[0.14,0.05,0.14],null,0.02);
  const eyes=[];
  [-1,1].forEach(s=>{
    const e=new THREE.Group(); e.position.set(s*0.24,0,0.56); e.rotation.y=s*0.33; head.add(e); eyes.push(e);
    part(new THREE.TorusGeometry(0.165,0.03,14,48),toon(W.ring),e,[0,0,0.012],[1,1,1],null,0);
    part(SPH,flat(W.eyeBlack),e,[0,0,0],[0.155,0.155,0.095],null,0);
    part(new THREE.CircleGeometry(0.1,40),flat(W.iris),e,[0.005,-0.008,0.094],[1,1,1],null,0);
    part(new THREE.CircleGeometry(0.062,40),flat(0x020303),e,[0.005,-0.008,0.0955],[1,1,1],null,0);
    part(SPH,flat(0xffffff),e,[-0.05,0.055,0.093],[0.04,0.048,0.009],null,0);
    part(SPH,flat(0xffffff),e,[0.055,-0.06,0.09],[0.018,0.018,0.007],null,0);
  });
  part(new THREE.TorusGeometry(0.05,0.011,8,24,Math.PI*0.8),ink,head,[0.01,-0.26,0.582],[1,1,1],[0.45,0,Math.PI*0.1],0);

  /* mushroom cap — the toon cap from the first version, sized for the bigger head */
  const CR=1.45;
  const cap=new THREE.Group(); cap.position.set(0,2.06,0); bot.add(cap);
  const dome=new THREE.SphereGeometry(1,64,32,0,Math.PI*2,0,Math.PI/2);
  part(dome,toon(C.orange),cap,[0,0,0],[CR,1.08,CR],null,0.035);
  const shine=new THREE.Mesh(new THREE.SphereGeometry(1.004,40,12,0,Math.PI*2,0,0.36),flat(0xfff6e6)); shine.scale.set(CR,1.08,CR); shine.rotation.set(-0.12,0,0.05); cap.add(shine);
  const blush=new THREE.Mesh(new THREE.SphereGeometry(1.003,40,16,0.9,1.4,0.55,0.55),toon(C.orangeLight)); blush.scale.set(CR,1.08,CR); cap.add(blush);
  [[0.9,0.7,0.08],[1.25,0.95,0.05],[2.6,0.6,0.07],[3.3,0.85,0.05],[4.2,0.55,0.08],[5.1,0.9,0.06],[5.8,0.65,0.05],[0.3,1.05,0.04]].forEach(([th,ph,r])=>{
    const n=new THREE.Vector3(Math.sin(ph)*Math.cos(th),Math.cos(ph),Math.sin(ph)*Math.sin(th));
    const p=new THREE.Vector3(n.x*CR,n.y*1.08,n.z*CR);
    const sp=new THREE.Mesh(SPH,toon(C.orangeDeep)); sp.position.copy(p); sp.lookAt(p.clone().add(n)); sp.scale.set(r,r,0.012); cap.add(sp);});
  const rim=new THREE.Mesh(new THREE.TorusGeometry(1,0.1,14,80),toon(C.rim)); rim.rotation.x=Math.PI/2; rim.scale.set(CR+0.02,CR+0.02,1.15); cap.add(rim);
  const rimO=new THREE.Mesh(new THREE.TorusGeometry(1,0.128,14,80),OUT); rimO.rotation.x=Math.PI/2; rimO.scale.set(CR+0.02,CR+0.02,1.25); cap.add(rimO);
  const gcv=document.createElement('canvas'); gcv.width=gcv.height=512; const g2=gcv.getContext('2d');
  const hex=n=>'#'+n.toString(16).padStart(6,'0');
  g2.fillStyle=hex(C.gillBg); g2.fillRect(0,0,512,512);
  const rg=g2.createRadialGradient(256,256,40,256,256,256); rg.addColorStop(0,'rgba(120,60,20,.35)'); rg.addColorStop(1,'rgba(120,60,20,0)'); g2.fillStyle=rg; g2.fillRect(0,0,512,512);
  g2.strokeStyle=hex(C.ink); g2.lineCap='round';
  for(let i=0;i<64;i++){const a=i/64*Math.PI*2, r0=i%2?120:80; g2.lineWidth=i%2?2:3.2; g2.beginPath(); g2.moveTo(256+Math.cos(a)*r0,256+Math.sin(a)*r0); g2.lineTo(256+Math.cos(a)*236,256+Math.sin(a)*236); g2.stroke();}
  const under=new THREE.Mesh(new THREE.CircleGeometry(CR-0.02,72),toon(0xffffff,{map:new THREE.CanvasTexture(gcv),side:THREE.DoubleSide}));
  under.rotation.x=Math.PI/2; under.position.y=-0.02; cap.add(under);

  /* ---------- rain: streaks fall around the scene, the cap shelters the robot ---------- */
  const RN=320, rainPos=new Float32Array(RN*6), rainV=new Float32Array(RN), RL=0.15, TOP=6.2;
  const capTop=(x,z)=>{const r2=(x*x+z*z)/(CR*CR); return r2<1?2.06+1.08*Math.sqrt(1-r2):-99;};
  function spawn(i,anyY){const x=(Math.random()-.5)*8, z=(Math.random()-.5)*6.5, y=anyY?Math.random()*TOP:TOP+Math.random()*1.5;
    rainPos.set([x+0.02,y+RL,z, x,y,z],i*6); rainV[i]=3.6+Math.random()*1.6;}
  for(let i=0;i<RN;i++)spawn(i,true);
  const rainGeo=new THREE.BufferGeometry(); rainGeo.setAttribute('position',new THREE.BufferAttribute(rainPos,3));
  const rain=new THREE.LineSegments(rainGeo,new THREE.LineBasicMaterial({color:0xc4dcef,transparent:true,opacity:.5,depthWrite:false}));
  rain.frustumCulled=false; rain.visible=false; world.add(rain);  /* drizzle only in dark mode */
  /* ripples where drops land on the moss */
  const ripples=[], ripMat=()=>new THREE.MeshBasicMaterial({color:0xcfe3f0,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide});
  for(let i=0;i<28;i++){const m=new THREE.Mesh(new THREE.RingGeometry(0.8,1,24),ripMat()); m.rotation.x=-Math.PI/2; m.visible=false; world.add(m); ripples.push({m,t:1});}
  let ripI=0;
  function ripple(x,z){const r=ripples[ripI++%ripples.length]; r.m.position.set(x,0.012,z); r.t=0; r.m.visible=true;}
  function updateRain(dt){
    for(let i=0;i<RN;i++){const o=i*6, d=rainV[i]*dt; rainPos[o+1]-=d; rainPos[o+4]-=d; const sway=d*(0.12+0.05*Math.sin(i+rainPos[o+4]*2)); rainPos[o]-=sway; rainPos[o+3]-=sway;
      const x=rainPos[o+3], y=rainPos[o+4], z=rainPos[o+5];
      if(y<capTop(x,z)&&y>1.9){spawn(i);continue;}                                  /* hits the cap: vanish, nothing drawn on it */
      const onIsland=(x*x+z*z)<2.0*2.0;
      if(onIsland&&y<0.02){ if(Math.random()<0.35) ripple(x,z); spawn(i); continue; }
      if(y<-2.2) spawn(i);}
    rainGeo.attributes.position.needsUpdate=true;
    ripples.forEach(r=>{if(!r.m.visible)return; r.t+=dt*2.2; const s=0.02+r.t*0.12; r.m.scale.set(s,s,s); r.m.material.opacity=0.7*(1-r.t); if(r.t>=1)r.m.visible=false;});
  }

  /* controls: rotate by drag; zoom only via buttons, Ctrl+wheel or pinch so the page still scrolls */
  const controls=new THREE.OrbitControls(camera,renderer.domElement);
  controls.target.copy(TARGET); controls.enablePan=false; controls.enableZoom=false;
  controls.enableDamping=true; controls.dampingFactor=.08;
  controls.minPolarAngle=.2; controls.maxPolarAngle=2.0;
  controls.autoRotate=!reduce; controls.autoRotateSpeed=1.1;
  controls.update();
  controls.addEventListener('change',wake);
  function zoom(f){const v=camera.position.clone().sub(controls.target); camera.position.copy(controls.target).add(v.setLength(THREE.MathUtils.clamp(v.length()*f,3.6,15))); wake();}
  renderer.domElement.addEventListener('wheel',e=>{if(!e.ctrlKey)return; e.preventDefault(); zoom(e.deltaY>0?1.08:0.92);},{passive:false});
  let pinch=0; const dist=t=>Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);
  renderer.domElement.addEventListener('touchstart',e=>{if(e.touches.length===2)pinch=dist(e.touches);},{passive:true});
  renderer.domElement.addEventListener('touchmove',e=>{if(e.touches.length!==2||!pinch)return; const d=dist(e.touches); zoom(pinch/d); pinch=d;},{passive:true});
  document.getElementById('zin').onclick=()=>zoom(.85);
  document.getElementById('zout').onclick=()=>zoom(1.18);
  document.getElementById('reset').onclick=()=>{camera.position.copy(HOME);controls.target.copy(TARGET);controls.update();wake();};
  const spinBtn=document.getElementById('spin'), spinIco=document.getElementById('spinIco');
  const PAUSE='<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>', PLAY='<path d="M7 5l12 7-12 7z"/>';
  const setSpin=on=>{controls.autoRotate=on; spinIco.innerHTML=on?PAUSE:PLAY; spinBtn.setAttribute('aria-label',on?'Pause rotation':'Start rotation'); wake();};
  setSpin(!reduce);
  spinBtn.onclick=()=>setSpin(!controls.autoRotate);
  controls.addEventListener('start',()=>setSpin(false));

  function size(){const w=stage.clientWidth,h=stage.clientHeight; if(!w||!h)return; renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix(); wake();}
  new ResizeObserver(size).observe(stage); size();

  /* rendering stops while the stage is off-screen or the tab is hidden */
  new IntersectionObserver(es=>{visible=es[es.length-1].isIntersecting; if(visible)wake();}).observe(stage);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)wake();});

  /* 30 fps cap; if the device still struggles, drop resolution, then the rain.
     Rain only in dark mode, checked every frame so it follows the theme toggle at once.
     With reduced motion nothing moves and there is no rain; a frame is drawn only when
     something changes (drag, zoom, resize). */
  function frame(now){
    if(!visible||document.hidden){running=false;return;}
    acc+=Math.max(0,(now-last)/1000); last=now;
    if(acc<1/30){requestAnimationFrame(frame);return;}
    const dt=Math.min(acc,.05); t+=dt;
    frames++; if(acc>0.05)slow++; acc=0;
    if(frames===60){ if(slow>20){ if(pr>1){pr=1; renderer.setPixelRatio(1); size();} else lowFx=true; } frames=0; slow=0; }
    dirty=false;
    if(!reduce){
      const raining=isDark()&&!lowFx; rain.visible=raining;
      if(raining) updateRain(dt); else ripples.forEach(r=>{r.m.visible=false});
      world.position.y=Math.sin(t*1.1)*0.05;
      head.rotation.z=Math.sin(t*0.8)*0.04; head.rotation.y=Math.sin(t*0.5)*0.07; cap.rotation.z=Math.sin(t*0.8)*0.03;
      arms.forEach(([a,s])=>{a.rotation.z=s*(0.06+Math.sin(t*1.6+s)*0.06)});
      const b=t-nextBlink; const sy=b>0&&b<0.14?0.1:1; eyes.forEach(e=>e.scale.y=sy); if(b>=0.14)nextBlink=t+2.5+Math.random()*3;
    }
    controls.update(); renderer.render(scene,camera);
    if(!reduce||dirty)requestAnimationFrame(frame); else running=false;
  }
  function wake(){
    dirty=true;
    if(running||!visible||document.hidden)return;
    running=true; last=performance.now(); acc=0.04;
    requestAnimationFrame(frame);
  }

  /* first frame is drawn before the logo is swapped for the canvas */
  if(!reduce)rain.visible=isDark();
  renderer.render(scene,camera);
  stage.classList.add('is-3d');
  if(stage.dataset.label){stage.setAttribute('role','img'); stage.setAttribute('aria-label',stage.dataset.label);}
  ['hero-tools','hero-caption'].forEach(id=>{const el=document.getElementById(id); if(el)el.hidden=false;});
  }
})();
