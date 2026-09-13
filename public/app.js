// REPLIX istemcisi
const socket = io();
const $ = id => document.getElementById(id);
let ME = null, ROOM = null, STATE = null, MYCHARS = [], myLines = [], curIdx = 0, curBlob = null;
let mediaStream = null, analyser = null, uploaded = new Set();
const CATFILTERS = ['Tümü','Komedi','Dram','Korku','Aksiyon','Animasyon','Fantastik','Bilim kurgu','Genel'];
let curFilter = 'Tümü', scenesCache = [];

function toast(m){ const t=$('toast'); t.textContent=m; t.classList.add('on'); clearTimeout(t._x); t._x=setTimeout(()=>t.classList.remove('on'),2400); }
function go(v){ document.querySelectorAll('.view').forEach(x=>x.classList.remove('on')); $('view-'+v).classList.add('on'); if(v==='scenes')loadScenes(); if(v==='community')loadDubs(); window.scrollTo(0,0); }

// ---------- İSİM ----------
fetch('/api/me').then(r=>r.json()).then(d=>{ if(d.name){ ME=d.name; $('name-modal').classList.add('off'); } });
function setName(){
  const n = $('name-input').value.trim(); if(!n) return toast('Bir isim yaz');
  fetch('/api/guest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n})})
    .then(r=>r.json()).then(()=>{ ME=n; $('name-modal').classList.add('off'); toast('Hoş geldin, '+n); });
}
$('name-input') && $('name-input').addEventListener('keydown',e=>{ if(e.key==='Enter') setName(); });

// ---------- SAHNELER ----------
function loadScenes(){
  fetch('/api/scenes').then(r=>r.json()).then(list=>{ scenesCache=list; renderFilters(); renderScenes(); });
}
function renderFilters(){
  $('filters').innerHTML = CATFILTERS.map(c=>`<button class="f ${c===curFilter?'act':''}" onclick="setFilter('${c}')">${c}</button>`).join('');
}
function setFilter(c){ curFilter=c; renderFilters(); renderScenes(); }
function renderScenes(){
  const q = ($('q').value||'').toLowerCase();
  const list = scenesCache.filter(s=>(curFilter==='Tümü'||s.category===curFilter)&&(s.name.toLowerCase().includes(q)||s.category.toLowerCase().includes(q)));
  $('scene-grid').innerHTML = list.length ? list.map(s=>`
    <div class="card hov" onclick="createRoom(${s.id})">
      <div class="thumb" style="background-image:url('/uploads/${s.thumb||''}')">▶</div>
      <div class="cat">${s.category} · ${s.duration}s · ${s.difficulty}</div>
      <div class="name">${esc(s.name)}</div>
      <div class="meta"><span class="chip">${s.chars.length} karakter</span><span class="chip">${s.views} görüntülenme</span><span class="chip">ücretsiz</span></div>
    </div>`).join('') : '<p class="note">Şu an sistemde oynanabilir bir sahne bulunmuyor.</p>';
}
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// ---------- ODA ----------
function createRoom(sceneId){
  if(!ME) return toast('Önce ismini gir');
  socket.emit('room:create',{sceneId},(res)=>{
    if(res.error) return toast(res.error);
    ROOM = res.code; go('room');
  });
}
function joinRoom(){
  const code = $('join-code').value.trim().toUpperCase();
  const name = $('join-name').value.trim() || ME;
  if(!code) return;
  socket.emit('room:join',{code,name},(res)=>{
    if(res.error){ $('join-err').textContent=res.error; return; }
    ROOM = res.code; go('room');
  });
}
function copyCode(){ navigator.clipboard.writeText(ROOM).then(()=>toast('Kod kopyalandı: '+ROOM)); }
function copyLink(){ navigator.clipboard.writeText(location.origin+'/#/katil?kod='+ROOM).then(()=>toast('Davet linki kopyalandı')); }
function toggleReady(){ socket.emit('room:ready',{ready:!(STATE && meReady())}); }
function meReady(){ return STATE.players.find(p=>p.id===socket.id)?.ready; }
function startGame(){ socket.emit('room:start',{},(res)=>{ if(res&&res.error) $('room-err').textContent=res.error; }); }

socket.on('room:state',(st)=>{
  STATE = st;
  if(!st.scene) return;
  $('room-title').textContent = 'Oda · '+st.scene.name;
  $('room-code').textContent = st.code;
  $('p-count').textContent = `· ${st.players.length}/${st.scene.chars.length}`;
  const plist = st.players.map(p=>`<div class="player"><div class="av" style="background:${p.id===socket.id?'linear-gradient(135deg,#a78bfa,#60a5fa)':'#2dd4bf'}">${esc(p.name[0].toUpperCase())}</div>
    <div><div style="font-size:14px;font-weight:600">${esc(p.name)} ${p.id===socket.id?'<span class="note">· sen</span>':''} ${st.players[0].id===p.id?'<span class="note">· host</span>':''}</div>
    <div class="note">${p.ready?'hazır':'bekleniyor…'}</div></div><div class="dot ${p.ready?'ok':'wa'}"></div></div>`).join('');
  $('player-list').innerHTML = plist;
  const me = st.players.find(p=>p.id===socket.id);
  if(me) $('ready-btn').textContent = me.ready?'Hazır değilim':'Hazırım';
  const isHost = st.players[0] && st.players[0].id===socket.id;
  $('start-btn').disabled = !(isHost && st.players.every(p=>p.ready) && st.phase==='lobby' && st.players.length>0);
  $('g-players').innerHTML = plist;
  if(st.phase==='rendering' && uploaded.size===myLines.length) { go('wait'); }
});
socket.on('assigned:you',({chars})=>{
  MYCHARS = chars;
  $('my-char').textContent = chars.join(' + ');
  const sc = STATE.scene;
  myLines = sc.lines.map((l,i)=>({...l,i})).filter(l=>chars.includes(sc.chars[l.c]));
  curIdx = 0;
  go('game');
  $('g-title').textContent = sc.name; $('g-code').textContent = ROOM;
  const v = $('g-video'); v.src = '/uploads/'+sc.video; v.load();
  toast('Karakterin: '+chars.join(' + '));
  nextLine();
});
socket.on('room:lines',({done,total})=>{
  if($('view-wait').classList.contains('on')){
    $('wait-bar').style.width = (done/total*100)+'%';
    $('wait-count').textContent = done+'/'+total+' replik tamamlandı';
  }
});
socket.on('dub:ready',({id})=>{ showDub(id); });
socket.on('room:error',({message})=>toast(message));

// ---------- MİKROFON ----------
async function getMic(){
  if(mediaStream) return mediaStream;
  mediaStream = await navigator.mediaDevices.getUserMedia({audio:true});
  const ac = new (window.AudioContext||window.webkitAudioContext)();
  analyser = ac.createAnalyser(); analyser.fftSize = 256;
  ac.createMediaStreamSource(mediaStream).connect(analyser);
  return mediaStream;
}
function micTest(){
  getMic().then(()=>{
    $('mic-wave').style.display='block';
    $('mic-note').textContent='Konuş — seviye çubuğu oynamalı. Her şey yolundaysa "Hazırım" de.';
    drawWave($('mic-wave'), true);
  }).catch(()=>{ $('mic-note').textContent='Mikrofon erişimi reddedildi. Tarayıcıda siteye izin verip yenile.'; });
}
function drawWave(cv, real){
  const ctx = cv.getContext('2d'), data = new Uint8Array(128);
  (function loop(){
    if(!document.body.contains(cv)) return;
    ctx.clearRect(0,0,cv.width,cv.height);
    if(real && analyser) analyser.getByteTimeDomainData(data);
    else for(let i=0;i<128;i++) data[i]=128;
    const n=48,w=cv.width/n; ctx.fillStyle='#a78bfa';
    for(let i=0;i<n;i++){ const v=Math.abs(data[Math.floor(i*128/n)]-128)/128, h=Math.max(3,v*cv.height*1.5);
      ctx.globalAlpha=.35+v*.65; ctx.fillRect(i*w+w*.2,(cv.height-h)/2,w*.6,h); }
    ctx.globalAlpha=1; requestAnimationFrame(loop);
  })();
}

// ---------- KAYIT ----------
function nextLine(){
  if(curIdx>=myLines.length) return allDone();
  const l = myLines[curIdx];
  $('g-bar').style.width = (curIdx/myLines.length*100)+'%';
  $('g-prog')&&0;
  const sc = STATE.scene;
  $('l-who').textContent = sc.chars[l.c]+' · '+(l.e-l.s).toFixed(1)+' sn · '+(curIdx+1)+'/'+myLines.length;
  $('l-txt').textContent = '"'+(l.text||l.t||'(Metin yok)')+'"';
  $('l-time').textContent = 'Sahne zamanı: '+l.s.toFixed(1)+'s – '+l.e.toFixed(1)+'s';
  ['listen-btn','redo-btn','accept-btn'].forEach(x=>$(x).style.display='none');
  $('rec-btn').disabled = false;
  drawWave($('g-wave'), !!analyser);
}
function startRec(){
  const l = myLines[curIdx];
  $('rec-btn').disabled = true;
  getMic().then(async (stream)=>{
    const v = $('g-video');
    const mr = new MediaRecorder(stream, {mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':undefined});
    const chunks=[]; mr.ondataavailable=e=>chunks.push(e.data);
    curBlob = null;
    mr.onstop = ()=>{ curBlob = new Blob(chunks,{type:'audio/webm'}); afterRec(l); };
    // geri sayım
    $('count').textContent='3'; let c=3;
    await new Promise(res=>{ const iv=setInterval(()=>{ c--; if(c<=0){clearInterval(iv);res();} else $('count').textContent=c; },650); });
    $('rec-dot').classList.add('on');
    try{ v.currentTime = Math.max(0,l.s-0.4); await v.play(); }catch(e){}
    const begin = ()=>{
      if(v.currentTime >= l.s || v.paused){ beginRec(); v.removeEventListener('timeupdate',begin); }
    };
    function beginRec(){
      mr.start(); $('count').textContent='●';
      const stopAt = ()=>{ if(v.currentTime>=l.e||v.paused){ cleanup(); v.removeEventListener('timeupdate',stopAt); } };
      v.addEventListener('timeupdate',stopAt);
      setTimeout(()=>{ try{mr.state!=='inactive'&&mr.stop();}catch(e){} cleanup(); }, (l.e-l.s+1.2)*1000);
    }
    function cleanup(){ $('rec-dot').classList.remove('on'); try{v.pause();}catch(e){} }
    v.addEventListener('timeupdate',begin);
    beginRec();
  }).catch(()=>toast('Mikrofon yok — izin verip yenile'));
}
function afterRec(l){
  $('count').textContent = '✓ '+(l.e-l.s).toFixed(1)+' sn';
  $('listen-btn').style.display=''; $('redo-btn').style.display=''; $('accept-btn').style.display='';
}
function listenRec(){ if(!curBlob) return; new Audio(URL.createObjectURL(curBlob)).play(); toast('Kaydın oynatılıyor'); }
function redoLine(){ nextLine(); }
async function acceptLine(){
  const l = myLines[curIdx];
  const fd = new FormData();
  fd.append('index', l.i);
  fd.append('audio', curBlob, 'line.webm');
  $('accept-btn').disabled = true;
  const r = await fetch('/api/rooms/'+ROOM+'/record',{method:'POST',body:fd}).then(r=>r.json());
  $('accept-btn').disabled = false;
  if(r.error) return toast(r.error);
  uploaded.add(l.i);
  toast('Replik yüklendi ✓ ('+r.done+'/'+r.total+')');
  curIdx++; nextLine();
}
function allDone(){
  $('g-bar').style.width='100%';
  go('wait');
  $('wait-bar').style.width = (STATE.doneLines/STATE.totalLines*100)+'%';
  $('wait-count').textContent = STATE.doneLines+'/'+STATE.totalLines+' replik tamamlandı';
  toast('Senin kayıtların tamam — diğerleri bekleniyor');
}

// ---------- FİNAL ----------
function showDub(id){
  fetch('/api/dubs/'+id).then(r=>r.json()).then(d=>{
    go('dub');
    const url = '/uploads/'+d.file;
    const v = $('f-video'); v.src = url; v.poster='';
    $('f-dl').href = url;
    $('f-cast').innerHTML = d.cast.map(c=>`<div class="player"><div class="av" style="background:#2dd4bf">${esc(c.player[0].toUpperCase())}</div>
      <div><div style="font-weight:600;font-size:14px">${esc(c.player)}</div><div class="note">${c.chars.map(x=>'<b style="color:#a78bfa">'+esc(x)+'</b>').join(' + ')}</div></div></div>`).join('');
    $('f-meta').innerHTML = `<b>${esc(d.scene_name)}</b> · ${new Date(d.created_at).toLocaleString('tr-TR')} · oda ${d.code} · REPLIX Free`;
    fetch('/api/dubs/'+id+'/view',{method:'POST'});
  });
}
function shareLink(){ navigator.clipboard.writeText(location.href).then(()=>toast('Link kopyalandı')); }

// ---------- TOPLULUK ----------
function loadDubs(){
  fetch('/api/dubs').then(r=>r.json()).then(list=>{
    $('dub-grid').innerHTML = list.length ? list.map(d=>`
      <div class="card hov" onclick="showDub(${d.id})">
        <div class="thumb" style="background-image:url('/uploads/${d.thumb||''}')">▶</div>
        <div class="cat">${esc(d.scene_name)}</div>
        <div class="name" style="font-size:15px">${d.players.map(esc).join(', ')}</div>
        <div class="meta"><span class="chip">${d.views} izlenme</span><span class="chip" onclick="event.stopPropagation();likeDub(this,${d.id})">♥ ${d.likes}</span></div>
      </div>`).join('') : '<p class="note">Henüz dublaj yok — ilk sahneyi oyna ve ilk finali sen üret.</p>';
  });
}
function likeDub(el,id){
  fetch('/api/dubs/'+id+'/like',{method:'POST'}).then(r=>r.json()).then(d=>{ el.textContent='♥ '+d.likes; el.style.color='#f87171'; });
}

// ---------- ADMİN ----------
async function adminLoad(){
  const t = $('a-token').value.trim();
  if(!t) return;
  const list = await fetch('/api/admin/scenes?token='+encodeURIComponent(t)).then(r=>r.json());
  if(list.error) { $('a-list').innerHTML='<p class="note">Yetkisiz.</p>'; return; }
  $('a-list').innerHTML = list.map(s=>`
    <div class="player"><div class="av" style="background:${s.status==='approved'?'#34d399':'#f59e0b'}">${esc(s.name[0])}</div>
    <div style="flex:1"><div style="font-weight:600;font-size:14px">${esc(s.name)}</div>
    <div class="note">${s.category} · ${JSON.parse(s.chars).length} karakter · ${s.status==='approved'?'yayında':'onay bekliyor'}</div></div>
    ${s.status!=='approved'?`<button class="btn" style="padding:6px 12px" onclick="adminApprove(${s.id},'${t}')">Onayla</button>`:''}
    <button class="btn" style="padding:6px 12px" onclick="adminDelete(${s.id},'${t}')">Sil</button></div>`).join('');
}
async function adminApprove(id,t){ await fetch(`/api/admin/scenes/${id}/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:t})}); adminLoad(); }
async function adminDelete(id,t){ if(!confirm('Sahne silinsin mi?')) return; await fetch(`/api/admin/scenes/${id}/delete`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:t})}); adminLoad(); }

// ---------- ROUTING ----------
const routes = {'':'home','sahneler':'scenes','katil':'join','topluluk':'community','admin':'admin'};
function route(){
  const h = location.hash.replace(/^#\/?/,'').split('?')[0];
  go(routes[h] || 'home');
  const m = location.hash.match(/kod=([A-Z0-9]+)/i);
  if(m) $('join-code').value = m[1].toUpperCase();
}
window.addEventListener('hashchange', route);
route();
