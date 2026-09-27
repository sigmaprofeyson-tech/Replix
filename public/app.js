// DubbyDub istemcisi
const $ = id => document.getElementById(id);

// ---------- TOKEN (cookie calismazsa localStorage fallback) ----------
let DD_TOKEN = localStorage.getItem('dd_token') || '';
function apiFetch(url, opts) {
  opts = opts || {};
  opts.headers = Object.assign({}, opts.headers || {});
  if (DD_TOKEN) opts.headers['x-guest-token'] = DD_TOKEN;
  opts.credentials = 'include';
  return fetch(url, opts);
}
function saveToken(t) { if (t) { DD_TOKEN = t; localStorage.setItem('dd_token', t); } }

const socket = io({ auth: { token: DD_TOKEN } });

let ME = null, ROOM = null, STATE = null, MYCHARS = [], myLines = [], curIdx = 0, curBlob = null;
let mediaStream = null, analyser = null, uploaded = new Set();
const CATFILTERS = ['Tümü','Komedi','Dram','Korku','Aksiyon','Animasyon','Fantastik','Bilim kurgu','Genel'];
let curFilter = 'Tümü', scenesCache = [];

function toast(m){ const t=$('toast'); t.textContent=m; t.classList.add('on'); clearTimeout(t._x); t._x=setTimeout(()=>t.classList.remove('on'),2400); }
function go(v){ document.querySelectorAll('.view').forEach(x=>x.classList.remove('on')); $('view-'+v).classList.add('on'); if(v==='scenes')loadScenes(); if(v==='community')loadDubs(); if(v==='submit')initSubmitForm(); window.scrollTo(0,0); }

// ---------- İSİM ----------
apiFetch('/api/me').then(r=>r.json()).then(d=>{
  if (d.token) saveToken(d.token);
  if(d.name){ ME=d.name; $('name-modal').classList.add('off'); }
});
function setName(){
  const n = $('name-input').value.trim(); if(!n) return toast('Bir isim yaz');
  apiFetch('/api/guest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n})})
    .then(r=>r.json()).then(d=>{ if(d.token){ saveToken(d.token); socket.auth.token = d.token; if(socket.connected){ socket.disconnect().connect(); } } ME=n; $('name-modal').classList.add('off'); toast('Hoş geldin, '+n); });
}
$('name-input') && $('name-input').addEventListener('keydown',e=>{ if(e.key==='Enter') setName(); });

// ---------- SAHNELER ----------
function loadScenes(){
  apiFetch('/api/scenes').then(r=>r.json()).then(list=>{ scenesCache=list; renderFilters(); renderScenes(); });
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
      <div class="thumb" style="background-image:url('/uploads/${s.thumb||''}')"></div>
      <div class="cat">${s.category} · ${s.duration}s · ${s.difficulty}</div>
      <div class="name">${esc(s.name)}</div>
      <div class="meta"><span class="chip">${s.chars.length} karakter</span><span class="chip">${s.views} görüntülenme</span><span class="chip gold">ücretsiz</span></div>
    </div>`).join('') : '<p class="note">Şu an sistemde oynanabilir bir sahne bulunmuyor. İlk sahneyi sen gönder!</p>';
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
  const plist = st.players.map(p=>`<div class="player"><div class="av" style="background:${p.id===socket.id?'linear-gradient(135deg,#b388ff,#4fd8ff)':'#2dd4bf'}">${esc(p.name[0].toUpperCase())}</div>
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
  const v = $('g-video'); v.src = '/uploads/'+(sc.video_mute||sc.video); v.muted = true; v.load();
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
    const n=48,w=cv.width/n; ctx.fillStyle='#b388ff';
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
  $('count').textContent='3';
  let c=3;
  const cd = setInterval(()=>{ c--; if(c<=0){ clearInterval(cd); armRec(l); } else $('count').textContent=c; },650);
}

function armRec(l){
  getMic().then(async (stream)=>{
    const v = $('g-video');
    const mr = new MediaRecorder(stream, {mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':undefined});
    const chunks=[]; mr.ondataavailable=e=>chunks.push(e.data);
    curBlob=null;
    mr.onstop = ()=>{ curBlob = new Blob(chunks,{type:'audio/webm'}); afterRec(l); };
    $('rec-dot').classList.add('on');
    try{ v.currentTime = Math.max(0,l.s-0.3); await v.play(); }catch(e){}
    let started=false;
    function go(){
      if(started) return; started=true;
      try{ mr.start(); }catch(e){ return; }
      $('count').textContent='\u25CF';
      const stopAt = ()=>{ if(v.currentTime>=l.e+0.3||v.paused){ end(); v.removeEventListener('timeupdate',stopAt); } };
      function end(){ if(mr.state!=='inactive'){ try{mr.stop();}catch(e){} } cleanup(); }
      v.addEventListener('timeupdate',stopAt);
      setTimeout(end, (l.e-l.s+2.5)*1000);
    }
    function cleanup(){ $('rec-dot').classList.remove('on'); try{v.pause();}catch(e){} }
    const begin = ()=>{ if(v.currentTime >= l.s || v.paused){ go(); v.removeEventListener('timeupdate',begin); } };
    v.addEventListener('timeupdate',begin);
    setTimeout(()=>{ if(!started) go(); }, 3000);
  }).catch(()=>{ $('rec-btn').disabled=false; toast('Mikrofon yok --- izin verip yenile'); });
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
  const r = await apiFetch('/api/rooms/'+ROOM+'/record',{method:'POST',body:fd}).then(r=>r.json());
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
  apiFetch('/api/dubs/'+id).then(r=>r.json()).then(d=>{
    go('dub');
    const url = '/uploads/'+d.file;
    const v = $('f-video'); v.src = url; v.poster='';
    $('f-dl').href = url;
    $('f-cast').innerHTML = d.cast.map(c=>`<div class="player"><div class="av" style="background:#2dd4bf">${esc(c.player[0].toUpperCase())}</div>
      <div><div style="font-weight:600;font-size:14px">${esc(c.player)}</div><div class="note">${c.chars.map(x=>'<b style="color:#b388ff">'+esc(x)+'</b>').join(' + ')}</div></div></div>`).join('');
    $('f-meta').innerHTML = `<b>${esc(d.scene_name)}</b> · ${new Date(d.created_at).toLocaleString('tr-TR')} · oda ${d.code} · DubbyDub Free`;
    apiFetch('/api/dubs/'+id+'/view',{method:'POST'});
  });
}
function shareLink(){ navigator.clipboard.writeText(location.href).then(()=>toast('Link kopyalandı')); }

// ---------- TOPLULUK ----------
function loadDubs(){
  apiFetch('/api/dubs').then(r=>r.json()).then(list=>{
    $('dub-grid').innerHTML = list.length ? list.map(d=>`
      <div class="card hov" onclick="showDub(${d.id})">
        <div class="thumb" style="background-image:url('/uploads/${d.thumb||''}')"></div>
        <div class="cat">${esc(d.scene_name)}</div>
        <div class="name" style="font-size:15px">${d.players.map(esc).join(', ')}</div>
        <div class="meta"><span class="chip">${d.views} izlenme</span><span class="chip" onclick="event.stopPropagation();likeDub(this,${d.id})">♥ ${d.likes}</span></div>
      </div>`).join('') : '<p class="note">Henüz dublaj yok — ilk sahneyi oyna ve ilk finali sen üret.</p>';
  });
}
function likeDub(el,id){
  apiFetch('/api/dubs/'+id+'/like',{method:'POST'}).then(r=>r.json()).then(d=>{ el.textContent='♥ '+d.likes; el.style.color='#ff5c72'; });
}

// =======================================================================
// ---------- SAHNE GÖNDER (kullanıcı klip yükleme) ----------
// =======================================================================
let SUB = { file:null, duration:0, chars:[], lines:[] };
function initSubmitForm(){
  if (SUB._inited) return;
  SUB._inited = true;
  SUB.chars = ['Karakter 1','Karakter 2'];
  SUB.lines = [];
  renderCharRows();
  renderLineRows();

  const dz = $('dropzone'), input = $('sub-file');
  ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{ e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{ e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e=>{ if(e.dataTransfer.files[0]) handleSubFile(e.dataTransfer.files[0]); });
  input.addEventListener('change', e=>{ if(e.target.files[0]) handleSubFile(e.target.files[0]); });
}
function handleSubFile(file){
  if(!file.type.startsWith('video/')) return toast('Sadece video dosyası yükleyebilirsin');
  SUB.file = file;
  const v = $('sub-video');
  v.src = URL.createObjectURL(file);
  v.style.display='block';
  v.onloadedmetadata = ()=>{ SUB.duration = v.duration; $('sub-video-info').textContent = `Süre: ${v.duration.toFixed(1)} sn · ${(file.size/1024/1024).toFixed(1)} MB · ${file.name}`; };
  toast('Video yüklendi — şimdi karakterleri ve replikleri gir');
}
function renderCharRows(){
  $('sub-chars').innerHTML = SUB.chars.map((c,i)=>`
    <div class="char-row">
      <input value="${esc(c)}" oninput="SUB.chars[${i}]=this.value; syncLineCharOptions();" placeholder="Karakter adı">
      <button class="iconbtn" onclick="removeCharRow(${i})" title="Karakteri sil">✕</button>
    </div>`).join('');
}
function addCharRow(){ SUB.chars.push('Karakter '+(SUB.chars.length+1)); renderCharRows(); syncLineCharOptions(); }
function removeCharRow(i){
  if(SUB.chars.length<=1) return toast('En az 1 karakter olmalı');
  SUB.chars.splice(i,1);
  SUB.lines.forEach(l=>{ if(l.c>=SUB.chars.length) l.c = SUB.chars.length-1; else if(l.c>i) l.c--; });
  renderCharRows(); renderLineRows();
}
function syncLineCharOptions(){ renderLineRows(); }
function renderLineRows(){
  $('sub-lines').innerHTML = SUB.lines.map((l,i)=>`
    <div class="subline-row">
      <select onchange="SUB.lines[${i}].c=parseInt(this.value)">
        ${SUB.chars.map((c,ci)=>`<option value="${ci}" ${l.c===ci?'selected':''}>${esc(c)}</option>`).join('')}
      </select>
      <input type="text" value="${esc(l.text||'')}" placeholder="Replik metni" oninput="SUB.lines[${i}].text=this.value">
      <div class="timegrab">
        <input type="number" step="0.1" min="0" value="${l.s}" oninput="SUB.lines[${i}].s=parseFloat(this.value)||0">
        <button class="iconbtn sm" title="Videodan şu anki saniyeyi yakala" onclick="grabTime(${i},'s')">▶</button>
      </div>
      <span class="note">–</span>
      <div class="timegrab">
        <input type="number" step="0.1" min="0" value="${l.e}" oninput="SUB.lines[${i}].e=parseFloat(this.value)||0">
        <button class="iconbtn sm" title="Videodan şu anki saniyeyi yakala" onclick="grabTime(${i},'e')">▶</button>
      </div>
      <button class="iconbtn" title="Repliği sil" onclick="removeLineRow(${i})">✕</button>
    </div>`).join('') || '<p class="note">Henüz replik yok — "+ Replik ekle" ile başla.</p>';
}
function addLineRow(){
  const v = $('sub-video');
  const t = v && !isNaN(v.currentTime) ? +v.currentTime.toFixed(1) : 0;
  SUB.lines.push({ c:0, text:'', s:t, e:+(t+2).toFixed(1) });
  renderLineRows();
}
function removeLineRow(i){ SUB.lines.splice(i,1); renderLineRows(); }
function grabTime(i, key){
  const v = $('sub-video');
  if(!v || !v.src) return toast('Önce video yükle');
  SUB.lines[i][key] = +v.currentTime.toFixed(1);
  renderLineRows();
}
async function submitScene(){
  const err = $('sub-err'); err.textContent='';
  if(!ME) return toast('Önce ismini gir');
  if(!SUB.file) { err.textContent='Önce bir video seç.'; return; }
  const name = $('sub-name').value.trim();
  if(!name) { err.textContent='Sahne adı gerekli.'; return; }
  if(SUB.lines.length<1) { err.textContent='En az 1 replik eklemelisin.'; return; }
  for(const l of SUB.lines){
    if(!l.text || !l.text.trim()) { err.textContent='Boş replik metni bırakma.'; return; }
    if(!(l.e>l.s)) { err.textContent='Bitiş zamanı başlangıçtan büyük olmalı.'; return; }
  }
  const fd = new FormData();
  fd.append('video', SUB.file);
  fd.append('name', name);
  fd.append('category', $('sub-category').value);
  fd.append('language', $('sub-language').value);
  fd.append('duration', SUB.duration || Math.max(...SUB.lines.map(l=>l.e)));
  fd.append('chars', JSON.stringify(SUB.chars));
  fd.append('lines', JSON.stringify(SUB.lines.map(l=>({c:l.c,text:l.text,s:l.s,e:l.e}))));
  $('sub-btn').disabled = true; $('sub-btn').textContent = 'Yükleniyor…';
  try{
    const r = await apiFetch('/api/scenes/submit',{method:'POST',body:fd}).then(r=>r.json());
    if(r.error){ err.textContent=r.error; return; }
    toast(r.status==='approved' ? 'Sahne yayına alındı 🎉' : 'Gönderildi ✓ — admin onayından sonra yayında olacak');
    SUB = { file:null, duration:0, chars:['Karakter 1','Karakter 2'], lines:[] };
    $('sub-video').style.display='none'; $('sub-video').src=''; $('sub-video-info').textContent='';
    $('sub-name').value=''; $('sub-file').value='';
    renderCharRows(); renderLineRows();
    go('scenes');
  }catch(e){ err.textContent = 'Yükleme hatası: '+e.message; }
  finally{ $('sub-btn').disabled=false; $('sub-btn').textContent='🚀 Sahneyi gönder'; }
}

// =======================================================================
// ---------- ADMİN ----------
// =======================================================================
let A_TOKEN = '', A_SCENES = [], A_TAB = 'pending';
function setAdminTab(t){
  A_TAB = t;
  ['pending','approved','all'].forEach(x=>$('a-tab-'+x).classList.toggle('act', x===t));
  renderAdminList();
}
async function adminLoad(){
  A_TOKEN = $('a-token').value.trim();
  if(!A_TOKEN) return;
  const list = await fetch('/api/admin/scenes?token='+encodeURIComponent(A_TOKEN)).then(r=>r.json());
  if(list.error) { $('a-list').innerHTML='<p class="note">Yetkisiz.</p>'; return; }
  A_SCENES = list;
  renderAdminList();
}
function renderAdminList(){
  let list = A_SCENES;
  if(A_TAB==='pending') list = A_SCENES.filter(s=>s.status==='pending');
  else if(A_TAB==='approved') list = A_SCENES.filter(s=>s.status==='approved');
  $('a-list').innerHTML = list.length ? list.map(s=>adminCard(s)).join('') : '<p class="note">Bu kategoride sahne yok.</p>';
}
function adminCard(s){
  const chars = s.chars, lines = s.lines;
  return `
  <div class="panel" style="margin-bottom:14px">
    <div class="spread">
      <div style="display:flex;align-items:center;gap:10px">
        <span class="${s.status==='approved'?'approved-tag':'pending-tag'}">${s.status==='approved'?'yayında':'onay bekliyor'}</span>
        <b>${esc(s.name)}</b>
        <span class="note">· ${esc(s.submitted_by||'DubbyDub')}</span>
      </div>
      <div class="row" style="margin-top:0">
        ${s.status!=='approved'?`<button class="btn sm gold" onclick="adminApprove(${s.id})">✓ Onayla</button>`:''}
        <button class="btn sm" onclick="adminSave(${s.id})">💾 Kaydet</button>
        <button class="btn sm" onclick="adminDelete(${s.id})" style="color:#ff5c72">🗑 Sil</button>
      </div>
    </div>
    <video src="/uploads/${s.video}" controls playsinline style="width:100%;max-height:260px;border-radius:12px;background:#000;margin-top:10px"></video>
    <div class="cols" style="grid-template-columns:1fr 1fr 1fr 1fr;margin-top:12px">
      <div><label class="lbl">Ad</label><input id="a-name-${s.id}" value="${esc(s.name)}"></div>
      <div><label class="lbl">Kategori</label><input id="a-cat-${s.id}" value="${esc(s.category)}"></div>
      <div><label class="lbl">Zorluk</label><input id="a-diff-${s.id}" value="${esc(s.difficulty||'Orta')}"></div>
      <div><label class="lbl">Dil</label><input id="a-lang-${s.id}" value="${esc(s.language)}"></div>
    </div>
    <label class="lbl">Karakterler (virgülle ayır)</label>
    <input id="a-chars-${s.id}" value="${chars.map(esc).join(', ')}">
    <label class="lbl">Replikler</label>
    <div id="a-lines-${s.id}">
      ${lines.map((l,i)=>`
        <div class="editrow">
          <input type="number" value="${l.c}" title="karakter index" id="a-l-${s.id}-${i}-c">
          <input type="text" value="${esc(l.text||'')}" id="a-l-${s.id}-${i}-t">
          <input type="number" step="0.1" value="${l.s}" id="a-l-${s.id}-${i}-s">
          <input type="number" step="0.1" value="${l.e}" id="a-l-${s.id}-${i}-e">
          <button class="iconbtn" onclick="this.closest('.editrow').remove()">✕</button>
        </div>`).join('')}
    </div>
    <button class="btn sm" onclick="adminAddLine(${s.id})">+ Replik satırı</button>
    <p class="note">Karakter sütunu 0'dan başlayan index'tir (0 = ilk karakter, 1 = ikinci karakter…).</p>
  </div>`;
}
function adminAddLine(id){
  const box = $('a-lines-'+id);
  const i = box.children.length;
  const row = document.createElement('div');
  row.className = 'editrow';
  row.innerHTML = `
    <input type="number" value="0" id="a-l-${id}-${i}-c">
    <input type="text" value="" id="a-l-${id}-${i}-t">
    <input type="number" step="0.1" value="0" id="a-l-${id}-${i}-s">
    <input type="number" step="0.1" value="2" id="a-l-${id}-${i}-e">
    <button class="iconbtn" onclick="this.closest('.editrow').remove()">✕</button>`;
  box.appendChild(row);
}
function collectAdminScene(id){
  const chars = $('a-chars-'+id).value.split(',').map(x=>x.trim()).filter(Boolean);
  const rows = [...$('a-lines-'+id).children];
  const lines = rows.map((row)=>({
    c: parseInt(row.children[0].value,10) || 0,
    text: (row.children[1].value||'').trim(),
    s: parseFloat(row.children[2].value)||0,
    e: parseFloat(row.children[3].value)||0
  })).filter(l=>l.text);
  return {
    name: $('a-name-'+id).value.trim(),
    category: $('a-cat-'+id).value.trim(),
    difficulty: $('a-diff-'+id).value.trim(),
    language: $('a-lang-'+id).value.trim(),
    chars, lines
  };
}
async function adminSave(id){
  const data = collectAdminScene(id);
  if(!data.chars.length) return toast('En az 1 karakter gerekli');
  if(!data.lines.length) return toast('En az 1 replik gerekli');
  const r = await fetch(`/api/admin/scenes/${id}/update?token=${encodeURIComponent(A_TOKEN)}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)
  }).then(r=>r.json());
  if(r.error) return toast(r.error);
  toast('Kaydedildi ✓'); adminLoad();
}
async function adminApprove(id){ await fetch(`/api/admin/scenes/${id}/approve?token=${encodeURIComponent(A_TOKEN)}`,{method:'POST'}); toast('Onaylandı ve yayınlandı ✓'); adminLoad(); }
async function adminDelete(id){ if(!confirm('Sahne silinsin mi?')) return; await fetch(`/api/admin/scenes/${id}/delete?token=${encodeURIComponent(A_TOKEN)}`,{method:'POST'}); adminLoad(); }

// ---------- ROUTING ----------
const routes = {'':'home','sahneler':'scenes','katil':'join','topluluk':'community','gonder':'submit','admin':'admin'};
function route(){
  const h = location.hash.replace(/^#\/?/,'').split('?')[0];
  go(routes[h] || 'home');
  const m = location.hash.match(/kod=([A-Z0-9]+)/i);
  if(m) $('join-code').value = m[1].toUpperCase();
}
window.addEventListener('hashchange', route);
route();
