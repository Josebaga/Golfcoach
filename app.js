import { FilesetResolver, PoseLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const $ = id => document.getElementById(id);
const fileInput=$("videoFile"), video=$("video"), canvas=$("overlay"), ctx=canvas.getContext("2d");
const analyzeBtn=$("analyzeBtn"), clearBtn=$("clearBtn"), statusEl=$("status");
let selectedView="side", objectUrl=null, landmarker=null, busy=false;

document.querySelectorAll(".view-btn").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".view-btn").forEach(b=>b.classList.toggle("active",b===btn));
  selectedView=btn.dataset.view;
  $("viewHelp").textContent=selectedView==="side"
    ?"Coloca la cámara perpendicular a tu línea de juego, aproximadamente a la altura de las manos."
    :"Coloca la cámara frente a ti, alineada con la dirección de juego y mostrando el cuerpo entero.";
}));

fileInput.addEventListener("change",()=>{
  const file=fileInput.files?.[0]; if(!file)return;
  if(objectUrl)URL.revokeObjectURL(objectUrl);
  objectUrl=URL.createObjectURL(file); video.src=objectUrl; video.load();
  $("fileName").textContent=file.name; $("emptyState").style.display="none";
  analyzeBtn.disabled=false; clearBtn.disabled=false; $("results").className="results empty";
  $("results").innerHTML="<p>Vídeo cargado. Pulsa «Analizar vídeo».</p>";
  statusEl.textContent="Vídeo cargado"; clearOverlay();
});
video.addEventListener("loadedmetadata",resizeCanvas);
window.addEventListener("resize",resizeCanvas);
video.addEventListener("seeked",()=>{ if(!busy && landmarker) drawCurrentFrame(); });
video.addEventListener("timeupdate",()=>{ if(!busy && landmarker && !video.paused) drawCurrentFrame(); });

function resizeCanvas(){
  const rect=video.getBoundingClientRect();
  if(!rect.width || !rect.height)return;
  const dpr=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.round(rect.width*dpr); canvas.height=Math.round(rect.height*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
function clearOverlay(){ctx.clearRect(0,0,canvas.width,canvas.height)}
async function getLandmarker(){
  if(landmarker)return landmarker;
  statusEl.textContent="Cargando modelo…";
  const vision=await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
  landmarker=await PoseLandmarker.createFromOptions(vision,{
    baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",delegate:"GPU"},
    runningMode:"VIDEO",numPoses:1,minPoseDetectionConfidence:.45,minPosePresenceConfidence:.45,minTrackingConfidence:.45
  });
  return landmarker;
}
const connections=[
 [11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],
 [23,25],[25,27],[27,29],[27,31],[24,26],[26,28],[28,30],[28,32]
];
function drawPose(landmarks){
  clearOverlay(); const w=video.clientWidth,h=video.clientHeight;
  if(!w||!h)return;
  ctx.lineWidth=3;ctx.strokeStyle="#c8ed70";ctx.fillStyle="#ffffff";
  for(const [a,b] of connections){
    const p=landmarks[a],q=landmarks[b]; if(p.visibility<.35||q.visibility<.35)continue;
    ctx.beginPath();ctx.moveTo(p.x*w,p.y*h);ctx.lineTo(q.x*w,q.y*h);ctx.stroke();
  }
  for(const i of [11,12,13,14,15,16,23,24,25,26,27,28]){
    const p=landmarks[i];if(p.visibility<.35)continue;
    ctx.beginPath();ctx.arc(p.x*w,p.y*h,4,0,Math.PI*2);ctx.fill();
  }
}
function drawCurrentFrame(){
  if(video.readyState<2||!landmarker)return;
  try{const r=landmarker.detectForVideo(video,performance.now());if(r.landmarks?.[0])drawPose(r.landmarks[0]);else clearOverlay();}catch(e){console.warn(e)}
}
function angle(a,b,c){
  const ab=[a.x-b.x,a.y-b.y],cb=[c.x-b.x,c.y-b.y];
  const dot=ab[0]*cb[0]+ab[1]*cb[1], den=Math.hypot(...ab)*Math.hypot(...cb);
  return den?Math.acos(Math.max(-1,Math.min(1,dot/den)))*180/Math.PI:null;
}
function avg(a,b){return{x:(a.x+b.x)/2,y:(a.y+b.y)/2}}
function assess(samples){
  const valid=samples.filter(s=>s && s.length>28);
  if(valid.length<5)return {count:valid.length,items:[]};
  const first=valid[0],mid=valid[Math.floor(valid.length*.5)],last=valid[valid.length-1];
  const items=[];
  const shoulder0=avg(first[11],first[12]),hip0=avg(first[23],first[24]);
  const shoulderMid=avg(mid[11],mid[12]),hipMid=avg(mid[23],mid[24]);
  const shoulderShift=Math.abs(shoulderMid.x-shoulder0.x);
  const hipShift=Math.abs(hipMid.x-hip0.x);
  const headDrift=Math.max(...valid.map(s=>Math.hypot(s[0].x-first[0].x,s[0].y-first[0].y)));
  const kneeL=angle(first[23],first[25],first[27]), kneeR=angle(first[24],first[26],first[28]);
  const trunk=angle(first[11],first[23],first[25]);
  if(headDrift>.075)items.push(["Movimiento de cabeza","Se aprecia desplazamiento de la referencia de la nariz/cabeza durante el vídeo. Revisa si mantienes una referencia estable; cierta movilidad es normal y depende del jugador y del plano de cámara."]);
  else items.push(["Referencia de cabeza","La posición de la cabeza se mantiene relativamente estable en los fotogramas detectados."]);
  if(selectedView==="front"){
    if(shoulderShift>.055)items.push(["Desplazamiento del tronco","Los hombros se desplazan lateralmente entre el inicio y la mitad del vídeo. Comprueba que el movimiento procede de una rotación coordinada y no de un balanceo excesivo."]);
    else items.push(["Estabilidad lateral","No se detecta un desplazamiento lateral grande de los hombros en la muestra analizada."]);
  }else{
    items.push(["Rotación aparente","La vista lateral no permite medir bien la rotación tridimensional de hombros y cadera. Para valorarla, utiliza también una grabación frontal o una vista desde detrás de la línea de juego."]);
  }
  if(kneeL&&kneeR)items.push(["Flexión inicial de rodillas",`Ángulos estimados: pierna izquierda ${Math.round(kneeL)}° y derecha ${Math.round(kneeR)}°. Son referencias 2D aproximadas; no constituyen una puntuación técnica.`]);
  if(trunk)items.push(["Inclinación del tronco",`Ángulo 2D estimado en la postura inicial: ${Math.round(trunk)}°. La interpretación depende de la cámara y del encuadre.`]);
  items.push(["Limitación del análisis","Este prototipo detecta puntos corporales en una secuencia de fotogramas. No identifica de forma fiable el instante exacto del impacto, el plano del palo ni la trayectoria de la bola."]);
  return {count:valid.length,items};
}
analyzeBtn.addEventListener("click",async()=>{
  if(busy||!video.src)return;
  busy=true;analyzeBtn.disabled=true;statusEl.textContent="Analizando…";$("progressBar").style.width="0%";
  try{
    await getLandmarker();
    video.pause(); const duration=video.duration;
    if(!Number.isFinite(duration)||duration<=0)throw new Error("No se puede leer la duración del vídeo.");
    const samples=[],total=40;
    for(let i=0;i<total;i++){
      const t=Math.min(duration-.01,(duration*i)/(total-1));
      await seekTo(t);
      const result=landmarker.detectForVideo(video,performance.now());
      samples.push(result.landmarks?.[0]||null);
      $("progressBar").style.width=`${Math.round((i+1)/total*100)}%`;
      $("progressText").textContent=`Procesando fotograma ${i+1} de ${total}`;
    }
    const report=assess(samples);
    renderResults(report);
    video.currentTime=0;statusEl.textContent="Análisis terminado";
    $("progressText").textContent=`Se han revisado ${report.count} fotogramas con detección corporal.`;
  }catch(err){
    console.error(err);statusEl.textContent="Error de análisis";
    $("results").innerHTML=`<p>No se ha podido completar el análisis: ${escapeHtml(err.message||String(err))}. Comprueba tu conexión a Internet e inténtalo de nuevo.</p>`;
  }finally{busy=false;analyzeBtn.disabled=false;}
});
function seekTo(t){return new Promise((resolve,reject)=>{const done=()=>{cleanup();resolve()};const fail=()=>{cleanup();reject(new Error("Error al leer el vídeo"))};const cleanup=()=>{video.removeEventListener("seeked",done);video.removeEventListener("error",fail)};video.addEventListener("seeked",done,{once:true});video.addEventListener("error",fail,{once:true});video.currentTime=t;});}
function renderResults(report){
  const root=$("results");root.className="results";
  if(!report.items.length){root.innerHTML="<p>No se ha detectado el cuerpo de forma suficiente. Mejora el encuadre y la iluminación.</p>";return}
  root.innerHTML=`<div class="tag">${report.count} fotogramas válidos</div>`+report.items.map(([title,desc])=>`<div class="metric"><b>${escapeHtml(title)}</b><p>${escapeHtml(desc)}</p></div>`).join("");
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
clearBtn.addEventListener("click",()=>{
  video.pause();video.removeAttribute("src");video.load();fileInput.value="";
  if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;
  $("fileName").textContent="Todavía no has seleccionado ningún vídeo.";
  $("emptyState").style.display="block";$("results").className="results empty";
  $("results").innerHTML="<p>Cuando termines el análisis aparecerán aquí las observaciones del movimiento.</p>";
  analyzeBtn.disabled=true;clearBtn.disabled=true;statusEl.textContent="Esperando vídeo";
  $("progressBar").style.width="0%";$("progressText").textContent="El análisis procesa fotogramas del vídeo en tu dispositivo.";clearOverlay();
});
