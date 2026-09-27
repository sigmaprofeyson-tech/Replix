// DubbyDub - cok oyunculu dublaj platformu (tamamen ucretsiz MVP)
// Express + Socket.io + SQLite + FFmpeg (ffmpeg-static)
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const Database = require('better-sqlite3');
const { spawn } = require('child_process');
const https = require('https');

const FFMPEG = require('ffmpeg-static'); // Render'da sistem ffmpeg'i yoksa bile calisir
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'dubbydub-admin-123';
const AUTO_APPROVE = process.env.AUTO_APPROVE === '1';

const UP = path.join(__dirname, 'uploads');
const DATA = path.join(__dirname, 'data');
fs.mkdirSync(UP, { recursive: true });
fs.mkdirSync(path.join(UP, 'dubs'), { recursive: true });
fs.mkdirSync(path.join(UP, 'recs'), { recursive: true });
fs.mkdirSync(DATA, { recursive: true });

// ---------- VERITABANI ----------
const db = new Database(path.join(DATA, 'dubbydub.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS scenes(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Genel',
  language TEXT NOT NULL DEFAULT 'tr',
  duration REAL NOT NULL DEFAULT 30,
  video TEXT NOT NULL,
  thumb TEXT,
  chars TEXT NOT NULL,          -- JSON array
  lines TEXT NOT NULL,          -- JSON array [{c,text,s,e}]
  difficulty TEXT DEFAULT 'Orta',
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved
  submitted_by TEXT,            -- gonderen kullanicinin ismi (varsa)
  views INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dubs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  scene_id INTEGER NOT NULL,
  cast TEXT NOT NULL,           -- JSON: [{player, chars:[..]}]
  players TEXT NOT NULL,        -- JSON: [isimler]
  file TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS likes(
  dub_id INTEGER NOT NULL,
  token TEXT NOT NULL,
  PRIMARY KEY(dub_id, token)
);
`);

// ---------- MIGRASYON ----------
try {
  const cols = db.prepare("PRAGMA table_info(scenes)").all().map(c => c.name);
  if (!cols.includes('video_mute')) db.exec("ALTER TABLE scenes ADD COLUMN video_mute TEXT");
  if (!cols.includes('submitted_by')) db.exec("ALTER TABLE scenes ADD COLUMN submitted_by TEXT");
} catch (e) {}

// sahnenin SESsiz kopyasini uretir (kayit sirasinda mikrofona orijinal ses karismasin diye)
async function ensureMuteVideo(videoFile) {
  if (!videoFile) return null;
  const muteName = 'mute-' + videoFile;
  const mutePath = path.join(UP, muteName);
  if (!fs.existsSync(mutePath)) {
    try { await ffmpeg(['-y', '-i', path.join(UP, videoFile), '-an', '-c:v', 'copy', mutePath]); }
    catch (e) { console.error('[Sistem] sessiz video uretilemedi:', videoFile, e.message); return null; }
  }
  return muteName;
}

// videodan otomatik kucuk resim (thumbnail) uretir
async function ensureThumb(videoFile) {
  if (!videoFile) return null;
  const base = videoFile.replace(/\.[^.]+$/, '');
  const thumbName = 'thumb-' + base + '.jpg';
  const thumbPath = path.join(UP, thumbName);
  if (!fs.existsSync(thumbPath)) {
    try { await ffmpeg(['-y', '-ss', '0.6', '-i', path.join(UP, videoFile), '-vframes', '1', '-vf', 'scale=480:-1', thumbPath]); }
    catch (e) { console.error('[Sistem] thumb uretilemedi:', videoFile, e.message); return null; }
  }
  return thumbName;
}

// uzaktan video indirir (yönlendirmeleri takip eder)
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location)
        return downloadFile(res.headers.location, dest).then(resolve, reject);
      if (res.statusCode !== 200) return reject(new Error('indirme hatasi HTTP ' + res.statusCode));
      const f = fs.createWriteStream(dest);
      res.pipe(f);
      f.on('finish', () => f.close(resolve));
      f.on('error', reject);
    }).on('error', reject);
  });
}

// ---------- SAHNELERI JSON'DAN OTOMATIK YUKLEME ----------
(async () => {
try {
  const scenesDataPath = path.join(__dirname, 'scenes_data.json');
  if (!fs.existsSync(scenesDataPath)) {
    console.log('[Sistem] scenes_data.json bulunamadi, atlaniyor.');
    return;
  }
  const scenesData = JSON.parse(fs.readFileSync(scenesDataPath, 'utf8'));
  const insertStmt = db.prepare(`INSERT INTO scenes(name, category, language, duration, video, thumb, chars, lines, difficulty, status, created_at, video_mute, submitted_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const checkStmt = db.prepare(`SELECT id, video_mute, thumb FROM scenes WHERE name=?`);
  for (const s of scenesData) {
    fs.mkdirSync(path.join(__dirname, 'scenes'), { recursive: true });
    const videoPath = path.join(__dirname, 'scenes', s.video);
    const targetPath = path.join(UP, s.video);
    if (!fs.existsSync(videoPath)) {
      if (s.url) {
        console.log('[Sistem] video indiriliyor:', s.url);
        try { await downloadFile(s.url, videoPath); } catch (e) { console.error('[Sistem] indirilemedi:', s.video, e.message); continue; }
      } else { console.error('[Sistem] UYARI: video bulunamadi ->', videoPath); continue; }
    }
    if (!fs.existsSync(targetPath)) fs.copyFileSync(videoPath, targetPath);
    let thumbName = s.thumb || '';
    if (s.thumb) {
      const thumbPath = path.join(__dirname, 'scenes', s.thumb);
      if (fs.existsSync(thumbPath) && !fs.existsSync(path.join(UP, s.thumb))) fs.copyFileSync(thumbPath, path.join(UP, s.thumb));
    } else {
      thumbName = await ensureThumb(s.video) || '';
    }
    const videoMute = await ensureMuteVideo(s.video);
    const existing = checkStmt.get(s.name);
    if (!existing) {
      insertStmt.run(
        s.name, s.category || 'Genel', s.language || 'tr', s.duration,
        s.video, thumbName,
        JSON.stringify(s.chars),
        JSON.stringify(s.lines.map(l => ({ ...l, text: l.text || l.t || l.replik || '(Metin yok)' }))),
        s.difficulty || 'Orta', 'approved', Date.now(), videoMute, 'DubbyDub'
      );
      console.log('[Sistem] Yeni sahne yuklendi:', s.name);
    } else {
      if (!existing.video_mute && videoMute) db.prepare('UPDATE scenes SET video_mute=? WHERE id=?').run(videoMute, existing.id);
      if (!existing.thumb && thumbName) db.prepare('UPDATE scenes SET thumb=? WHERE id=?').run(thumbName, existing.id);
    }
  }
} catch (err) {
  console.error('[Sistem] scenes_data.json yuklenirken hata:', err.message);
}
})();
// ---------------------------------------------------------

// ---------- YARDIMCILAR ----------
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function setCookie(res, name, val) {
  res.setHeader('Set-Cookie', name + '=' + encodeURIComponent(val) + '; Path=/; SameSite=Lax; Max-Age=31536000');
}
// Bazi tarayicilar / uygulama-ici (in-app) webview'lar cookie'yi engelleyebiliyor.
// Bu yuzden token'i hem cookie'de hem de istemcinin gonderdigi header/query'de kabul ediyoruz.
function getToken(req) {
  return (req.headers['x-guest-token'] || req.query.token || parseCookies(req).dd_token || '') + '';
}
function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const bin = FFMPEG || 'ffmpeg';
    const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => err += d);
    p.on('close', c => c === 0 ? resolve() : reject(new Error('ffmpeg exit ' + c + ': ' + err.slice(-600))));
  });
}
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UP),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + crypto.randomBytes(6).toString('hex') + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 500 * 1024 * 1024 }
});
const recUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(UP, 'recs')),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + crypto.randomBytes(6).toString('hex') + '.webm')
  }),
  limits: { fileSize: 30 * 1024 * 1024 }
});

// ---------- ODALAR (bellek ici) ----------
const rooms = new Map(); // code -> room
function makeCode() {
  const abc = 'ABCDEFGHJKLMNPRSTUVYZ23456789';
  let c;
  do { c = 'DD' + Array.from({length: 4}, () => abc[crypto.randomInt(abc.length)]).join('') + crypto.randomInt(10, 99); } while (rooms.has(c));
  return c;
}

function publicState(r) {
  const scene = db.prepare('SELECT id,name,category,duration,video,video_mute,thumb,chars,lines FROM scenes WHERE id=?').get(r.sceneId);
  return {
    code: r.code,
    phase: r.phase,
    players: [...r.players.values()].map(p => ({ id: p.sid, name: p.name, ready: p.ready })),
    scene: scene ? {
        ...scene,
        chars: JSON.parse(scene.chars),
        lines: JSON.parse(scene.lines).map(l => ({
            ...l,
            text: l.text || l.t || l.replik || l.dialogue || l.content || '(Metin yok)'
        }))
    } : null,
    doneLines: r.recs.size,
    totalLines: r.totalLines
  };
}

function broadcast(r) { r.io.to(r.code).emit('room:state', publicState(r)); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ---------- RENDER KUYRUGU ----------
const queue = [];
let rendering = false;
function enqueueRender(r) {
  r.phase = 'rendering'; broadcast(r);
  queue.push(r); pump();
}
async function pump() {
  if (rendering || !queue.length) return;
  rendering = true;
  const r = queue.shift();
  try {
    const scene = db.prepare('SELECT * FROM scenes WHERE id=?').get(r.sceneId);
    const lines = JSON.parse(scene.lines);
    const dur = scene.duration;
    const outFile = 'dub-' + r.code + '-' + Date.now() + '.mp4';
    const outPath = path.join(UP, 'dubs', outFile);
    const args = ['-y', '-i', path.join(UP, scene.video)];
    const parts = [];
    let n = 0;
    lines.forEach((l, i) => {
      const f = r.recFiles.get(i);
      if (f) {
        args.push('-i', f);
        const idx = ++n;
        parts.push('[' + idx + ':a]aresample=48000,adelay=' + Math.round(l.s * 1000) + '|' + Math.round(l.s * 1000) + ',apad,atrim=0:' + dur + '[a' + i + ']');
      }
    });
    let mixIn = lines.map((l, i) => r.recFiles.has(i) ? '[a' + i + ']' : '').join('');
    let filterStr;
    if (n > 0) filterStr = parts.join(';') + ';' + mixIn + 'amix=inputs=' + n + ':normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000:first_pts=0[aout]';
    else filterStr = 'anullsrc=r=48000:d=' + dur + '[aout]';
    args.push('-filter_complex', filterStr, '-map', '0:v:0', '-map', '[aout]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', outPath);
    await ffmpeg(args);
    const cast = [...r.players.values()].map(p => ({ player: p.name, chars: p.chars }));
    const info = db.prepare('INSERT INTO dubs(code,scene_id,cast,players,file,created_at) VALUES(?,?,?,?,?,?)')
      .run(r.code, r.sceneId, JSON.stringify(cast), JSON.stringify(cast.map(c => c.player)), 'dubs/' + outFile, Date.now());
    r.phase = 'done';
    r.io.to(r.code).emit('dub:ready', { id: info.lastInsertRowid, url: '/uploads/dubs/' + outFile });
    broadcast(r);
    console.log('[render] bitti:', outFile);
  } catch (e) {
    console.error('[render] hata:', e.message);
    r.io.to(r.code).emit('room:error', { message: 'Render hatasi: ' + e.message });
    r.phase = 'recording'; broadcast(r);
  } finally { rendering = false; pump(); }
}

// ---------- EXPRESS ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UP));

app.get('/health', (req, res) => res.json({ ok: true, name: 'DubbyDub', free: true }));

function sessionName(req) {
  const t = getToken(req);
  if (!t) return null;
  const row = db.prepare('SELECT name FROM sessions WHERE token=?').get(t);
  return row ? row.name : null;
}
app.post('/api/guest', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 24) || 'Misafir';
  let token = getToken(req);
  if (!token || !db.prepare('SELECT 1 FROM sessions WHERE token=?').get(token)) {
    token = crypto.randomBytes(18).toString('hex');
    db.prepare('INSERT INTO sessions(token,name,created_at) VALUES(?,?,?)').run(token, name, Date.now());
  } else {
    db.prepare('UPDATE sessions SET name=? WHERE token=?').run(name, token);
  }
  setCookie(res, 'dd_token', token);
  // Token'i cevapta da veriyoruz ki istemci cookie calismasa bile localStorage'a yazip
  // sonraki isteklerde 'x-guest-token' header'i ile gonderebilsin (bazi webview/tarayicilarda
  // 3.parti/embedded baglamda cookie kaydedilmeyebiliyor - isim kaybolma sorununun sebebi budur).
  res.json({ ok: true, name, token });
});
app.get('/api/me', (req, res) => res.json({ name: sessionName(req), token: getToken(req) || undefined }));

app.get('/api/scenes', (req, res) => {
  const rows = db.prepare("SELECT id,name,category,language,duration,video,video_mute,thumb,chars,lines,difficulty,views FROM scenes WHERE status='approved' ORDER BY id DESC").all();
  res.json(rows.map(r => ({
      ...r,
      chars: JSON.parse(r.chars),
      lines: JSON.parse(r.lines).map(l => ({ ...l, text: l.text || l.t || l.replik || '(Metin yok)' }))
  })));
});
app.get('/api/scenes/:id', (req, res) => {
  const r = db.prepare("SELECT * FROM scenes WHERE id=? AND status='approved'").get(req.params.id);
  if (!r) return res.status(404).json({ error: 'sahne yok' });
  db.prepare('UPDATE scenes SET views=views+1 WHERE id=?').run(r.id);
  res.json({
      ...r,
      chars: JSON.parse(r.chars),
      lines: JSON.parse(r.lines).map(l => ({ ...l, text: l.text || l.t || l.replik || '(Metin yok)' }))
  });
});

// ---------- KULLANICI SAHNE GONDERIMI ----------
// Kullanicilar kendi klip (mp4/webm/mov) + karakter + replik zaman kodlarini gonderir.
// Otomatik thumbnail uretilir. AUTO_APPROVE=1 degilse admin onayina dusar (status='pending').
app.post('/api/scenes/submit', upload.single('video'), async (req, res) => {
  try {
    const f = req.file;
    if (!f) return res.status(400).json({ error: 'video dosyasi gerekli' });
    if (!f.mimetype.startsWith('video/')) {
      try { fs.unlinkSync(f.path); } catch (e) {}
      return res.status(400).json({ error: 'sadece video dosyasi yukleyebilirsin' });
    }
    const name = String(req.body.name || '').trim().slice(0, 80);
    const category = String(req.body.category || 'Genel').trim().slice(0, 24);
    const language = String(req.body.language || 'tr').trim().slice(0, 8);
    const duration = Math.max(1, Math.min(600, parseFloat(req.body.duration) || 0));
    let chars, lines;
    try { chars = JSON.parse(req.body.chars || '[]'); } catch (e) { chars = []; }
    try { lines = JSON.parse(req.body.lines || '[]'); } catch (e) { lines = []; }
    if (!name) return res.status(400).json({ error: 'sahne adi gerekli' });
    if (!Array.isArray(chars) || chars.length < 1) return res.status(400).json({ error: 'en az 1 karakter gerekli' });
    if (!Array.isArray(lines) || lines.length < 1) return res.status(400).json({ error: 'en az 1 replik gerekli' });
    for (const l of lines) {
      if (typeof l.c !== 'number' || !chars[l.c]) return res.status(400).json({ error: 'replikte gecersiz karakter' });
      if (typeof l.s !== 'number' || typeof l.e !== 'number' || l.e <= l.s) return res.status(400).json({ error: 'replik zaman kodlari gecersiz' });
    }
    const thumbName = await ensureThumb(f.filename);
    await ensureMuteVideo(f.filename);
    const submittedBy = sessionName(req) || 'Misafir';
    const status = AUTO_APPROVE ? 'approved' : 'pending';
    const info = db.prepare(`INSERT INTO scenes(name,category,language,duration,video,thumb,chars,lines,difficulty,status,submitted_by,created_at,video_mute)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      name, category, language, duration, f.filename, thumbName || '',
      JSON.stringify(chars), JSON.stringify(lines), 'Orta', status, submittedBy, Date.now(), 'mute-' + f.filename
    );
    res.json({ ok: true, id: info.lastInsertRowid, status });
  } catch (e) {
    console.error('[submit] hata:', e.message);
    res.status(500).json({ error: 'sunucu hatasi: ' + e.message });
  }
});

app.get('/api/dubs', (req, res) => {
  const rows = db.prepare(`SELECT d.*, s.name AS scene_name, s.thumb FROM dubs d JOIN scenes s ON s.id=d.scene_id ORDER BY d.id DESC LIMIT 60`).all();
  res.json(rows.map(r => ({ ...r, cast: JSON.parse(r.cast), players: JSON.parse(r.players), likes: db.prepare('SELECT COUNT(*) c FROM likes WHERE dub_id=?').get(r.id).c })));
});
app.post('/api/dubs/:id/like', (req, res) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'giris yok' });
  try { db.prepare('INSERT INTO likes(dub_id,token) VALUES(?,?)').run(req.params.id, token); } catch (e) {}
  res.json({ likes: db.prepare('SELECT COUNT(*) c FROM likes WHERE dub_id=?').get(req.params.id).c });
});
app.post('/api/dubs/:id/view', (req, res) => {
  db.prepare('UPDATE dubs SET views=views+1 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
app.get('/api/dubs/:id', (req, res) => {
  const r = db.prepare('SELECT d.*, s.name AS scene_name FROM dubs d JOIN scenes s ON s.id=d.scene_id WHERE d.id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'yok' });
  res.json({ ...r, cast: JSON.parse(r.cast), players: JSON.parse(r.players) });
});

// kayit yukleme
app.post('/api/rooms/:code/record', recUpload.single('audio'), (req, res) => {
  const r = rooms.get(req.params.code);
  if (!r) return res.status(404).json({ error: 'oda yok' });
  const sid = r.sidByToken.get(getToken(req));
  if (!sid) return res.status(403).json({ error: 'odada degilsin' });
  const p = r.players.get(sid);
  if (!p) return res.status(403).json({ error: 'oyuncu yok' });
  const idx = parseInt(req.body.index, 10);
  const scene = r.sceneLines;
  if (!scene[idx]) return res.status(400).json({ error: 'replik yok' });
  if (p.chars.indexOf(scene[idx].cName) === -1) return res.status(403).json({ error: 'bu replik senin degil' });
  if (!req.file || !(req.file.mimetype.startsWith('audio/') || req.file.mimetype === 'video/webm')) return res.status(400).json({ error: 'ses dosyasi degil' });
  r.recs.add(sid + ':' + idx);
  r.recFiles.set(idx, req.file.path);

  r.io.to(r.code).emit('room:lines', { done: r.recs.size, total: r.totalLines });

  if (r.recs.size >= r.totalLines) {
    enqueueRender(r);
  }

  console.log('[rec]', r.code, p.name, 'replik', idx, r.recs.size + '/' + r.totalLines);
  res.json({ ok: true, done: r.recs.size, total: r.totalLines });
});

// ---------- ADMIN ----------
function adminOk(req) { return (req.query.token || (req.body && req.body.token) || req.headers['x-admin-token']) === ADMIN_TOKEN; }
app.get('/api/admin/scenes', (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: 'yetkisiz' });
  const rows = db.prepare('SELECT * FROM scenes ORDER BY id DESC').all();
  res.json(rows.map(r => ({ ...r, chars: JSON.parse(r.chars), lines: JSON.parse(r.lines) })));
});
app.post('/api/admin/scenes/:id/approve', (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: 'yetkisiz' });
  db.prepare("UPDATE scenes SET status='approved' WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});
app.post('/api/admin/scenes/:id/reject', (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: 'yetkisiz' });
  db.prepare("UPDATE scenes SET status='rejected' WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});
app.post('/api/admin/scenes/:id/update', express.json({ limit: '2mb' }), (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: 'yetkisiz' });
  const s = db.prepare('SELECT * FROM scenes WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'sahne yok' });
  const b = req.body || {};
  const name = b.name !== undefined ? String(b.name).trim().slice(0, 80) || s.name : s.name;
  const category = b.category !== undefined ? String(b.category).trim().slice(0, 24) || s.category : s.category;
  const language = b.language !== undefined ? String(b.language).trim().slice(0, 8) || s.language : s.language;
  const difficulty = b.difficulty !== undefined ? String(b.difficulty).trim().slice(0, 16) || s.difficulty : s.difficulty;
  const duration = b.duration !== undefined ? (Math.max(1, Math.min(600, parseFloat(b.duration) || s.duration))) : s.duration;
  let chars = s.chars, lines = s.lines;
  if (Array.isArray(b.chars) && b.chars.length) chars = JSON.stringify(b.chars.map(c => String(c).slice(0, 40)));
  if (Array.isArray(b.lines) && b.lines.length) {
    const parsedChars = JSON.parse(chars);
    for (const l of b.lines) {
      if (typeof l.c !== 'number' || !parsedChars[l.c]) return res.status(400).json({ error: 'replikte gecersiz karakter index' });
      if (typeof l.s !== 'number' || typeof l.e !== 'number' || l.e <= l.s) return res.status(400).json({ error: 'replik zaman kodlari gecersiz' });
    }
    lines = JSON.stringify(b.lines);
  }
  db.prepare('UPDATE scenes SET name=?,category=?,language=?,difficulty=?,duration=?,chars=?,lines=? WHERE id=?')
    .run(name, category, language, difficulty, duration, chars, lines, req.params.id);
  res.json({ ok: true });
});
app.post('/api/admin/scenes/:id/delete', (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: 'yetkisiz' });
  const r = db.prepare('SELECT video,thumb FROM scenes WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM scenes WHERE id=?').run(req.params.id);
  if (r) { try { fs.unlinkSync(path.join(UP, r.video)); } catch (e) {} if (r.thumb) try { fs.unlinkSync(path.join(UP, r.thumb)); } catch (e) {} }
  res.json({ ok: true });
});
app.get('/api/admin/dubs', (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: 'yetkisiz' });
  res.json(db.prepare('SELECT * FROM dubs ORDER BY id DESC LIMIT 100').all());
});

// ---------- SOCKET.IO (gercek zamanli oda) ----------
io.on('connection', (sock) => {
  // Token'i ya socket.io 'auth' payload'indan (localStorage fallback) ya da cookie'den al.
  const token = (sock.handshake.auth && sock.handshake.auth.token) || parseCookies(sock.handshake).dd_token || '';
  let myRoom = null;

  sock.on('room:create', ({ sceneId }, cb) => {
    const scene = db.prepare("SELECT * FROM scenes WHERE id=? AND status='approved'").get(sceneId);
    if (!scene) return cb && cb({ error: 'sahne yok' });
    const name = (db.prepare('SELECT name FROM sessions WHERE token=?').get(token) || {}).name || 'Misafir';
    const code = makeCode();
    const lines = JSON.parse(scene.lines);
    const room = {
      code, sceneId, io,
      phase: 'lobby',
      players: new Map(),
      recs: new Set(),
      recFiles: new Map(),
      sidByToken: new Map(),
      sceneLines: lines.map((l, i) => ({ ...l, cName: JSON.parse(scene.chars)[l.c] })),
      totalLines: lines.length
    };
    room.sidByToken.set(token, sock.id);
    room.players.set(sock.id, { sid: sock.id, token, name, ready: false, chars: [] });
    rooms.set(code, room);
    sock.join(code);
    myRoom = room;
    cb && cb({ code });
    broadcast(room);
  });

  sock.on('room:join', ({ code, name }, cb) => {
    const room = rooms.get(String(code || '').trim().toUpperCase());
    if (!room) return cb && cb({ error: 'oda bulunamadi' });
    if (room.phase !== 'lobby') return cb && cb({ error: 'oyun baslamis' });
    const chars = room.sceneLines.length && JSON.parse(db.prepare('SELECT chars FROM scenes WHERE id=?').get(room.sceneId).chars);
    if (room.players.size >= chars.length) return cb && cb({ error: 'oda dolu' });
    const n = String(name || '').trim().slice(0, 24) || (db.prepare('SELECT name FROM sessions WHERE token=?').get(token) || {}).name || 'Misafir';
    room.sidByToken.set(token, sock.id);
    room.players.set(sock.id, { sid: sock.id, token, name: n, ready: false, chars: [] });
    sock.join(room.code);
    myRoom = room;
    cb && cb({ code: room.code });
    broadcast(room);
  });

  sock.on('room:ready', ({ ready }) => {
    const p = myRoom && myRoom.players.get(sock.id);
    if (!p) return;
    p.ready = !!ready;
    broadcast(myRoom);
  });

  sock.on('room:start', (_, cb) => {
    const r = myRoom;
    if (!r) return;
    const first = r.players.values().next().value;
    if (!first || first.sid !== sock.id) return cb && cb({ error: 'sadece host baslatabilir' });
    if (r.players.size > 1 && ![...r.players.values()].every(p => p.ready)) return cb && cb({ error: 'herkes hazir olmali' });
    const chars = JSON.parse(db.prepare('SELECT chars FROM scenes WHERE id=?').get(r.sceneId).chars);
    const ps = shuffle([...r.players.keys()]);
    const pool = shuffle(chars.slice());
    r.players.forEach(p => p.chars = []);
    pool.forEach((c, i) => { r.players.get(ps[i % ps.length]).chars.push(c); });
    r.phase = 'recording';
    r.players.forEach(p => { r.io.to(p.sid).emit('assigned:you', { chars: p.chars }); });
    broadcast(r);
    cb && cb({ ok: true });
  });

  sock.on('room:leave', () => {
    if (!myRoom) return;
    myRoom.players.delete(sock.id);
    sock.leave(myRoom.code);
    if (myRoom.players.size === 0) rooms.delete(myRoom.code);
    else broadcast(myRoom);
    myRoom = null;
  });

  sock.on('disconnect', () => {
    if (!myRoom) return;
    myRoom.players.delete(sock.id);
    if (myRoom.players.size === 0 && myRoom.phase !== 'rendering') rooms.delete(myRoom.code);
    else broadcast(myRoom);
  });
});

server.listen(PORT, () => console.log('DubbyDub calisiyor: http://localhost:' + PORT + '  (admin token: ' + ADMIN_TOKEN + ')'));
