{
const CFG = window.PANTRY_CONFIG, LOCS = CFG.locations;
const $ = s => document.querySelector(s);
const st = { mode: 'add', loc: 'Pantry', filter: 'all', items: new Map(), products: {}, loaded: false };
const ls = { get(k, d) { try { const v = localStorage.getItem('pc_' + k); return v == null ? d : JSON.parse(v) } catch (e) { return d } }, set(k, v) { try { localStorage.setItem('pc_' + k, JSON.stringify(v)) } catch (e) {} } };
st.loc = LOCS.includes(ls.get('loc')) ? ls.get('loc') : LOCS[0];
$('#askExp').checked = ls.get('ask', true);

/* ---------- household key ---------- */
const keyFrom = s => { const m = String(s || '').match(/(?:k=)?([a-f0-9]{32,128})/i); return m ? m[1].toLowerCase() : null };
let HK = keyFrom(location.hash) || ls.get('key', null);
const shareUrl = () => location.origin + location.pathname + '#k=' + HK;
function keepKey() { ls.set('key', HK); if (keyFrom(location.hash) !== HK) history.replaceState(null, '', '#k=' + HK) }

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = s => s.toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 120);
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d };
const days = exp => exp ? Math.round((new Date(exp + 'T00:00:00') - today()) / 864e5) : null;
const fmt = exp => new Date(exp + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const plus = n => { const d = today(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA') };
const isBarcode = c => /^\d{6,14}$/.test(c);
let undoFn = null, tTimer = 0;
function toast(msg, undo) { $('#tMsg').textContent = msg; undoFn = undo || null; $('#tUndo').hidden = !undo; $('#toast').classList.add('on'); clearTimeout(tTimer); tTimer = setTimeout(() => $('#toast').classList.remove('on'), undo ? 6000 : 3500) }
function said(html) { $('#last').innerHTML = html }
let actx = null;
function beep(f) { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = f; g.gain.value = .08; o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + .12) } catch (e) {} try { navigator.vibrate && navigator.vibrate(40) } catch (e) {} }

/* ---------- database ---------- */
async function rpc(fn, args) {
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: CFG.publishableKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ hk: HK, ...args }) });
  const t = await r.text();
  if (!r.ok) { let m = ''; try { m = JSON.parse(t).message } catch (e) {} const err = new Error(m || 'HTTP ' + r.status); err.unknown = /unknown household/.test(m); throw err }
  return t ? JSON.parse(t) : null;
}
function fail(e) { if (e.unknown) return showGate('That household link is not valid.'); toast(navigator.onLine ? "Couldn't save. Try again." : "You're offline. Changes weren't saved.") }
function apply(row) { if (!row) return; if (row.qty > 0) st.items.set(row.id, row); else st.items.delete(row.id); render() }
const findItem = (code, loc, exp) => [...st.items.values()].find(i => i.code === code && i.loc === loc && i.exp === (exp || ''));
const put = (i, qty) => rpc('pantry_put', { p_code: i.code, p_name: i.name, p_loc: i.loc, p_exp: i.exp || '', p_qty: qty });
const undoThen = f => async () => { try { await f(); await load() } catch (e) { fail(e) } };

let loading = false;
async function load() {
  if (!HK || loading) return; loading = true;
  try { const d = await rpc('pantry_list', {}); st.items = new Map(d.items.map(i => [i.id, i])); st.products = d.products || {}; st.loaded = true; $('#sync').textContent = 'Synced ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); render() }
  catch (e) { if (e.unknown) showGate('That household link is not valid.'); else $('#sync').textContent = 'Offline. Retrying…' }
  loading = false;
}

async function addStock(code, name, loc, exp, n) {
  const prev = findItem(code, loc, exp), prevQty = prev ? prev.qty : 0;
  try {
    const row = await rpc('pantry_add', { p_code: code, p_name: name, p_loc: loc, p_exp: exp || '', p_n: n }); apply(row);
    said(`Added <b>${esc(name)}</b> · ${row.qty} in ${esc(loc)}${exp ? ', ' + fmt(exp) : ''}`);
    toast(`+${n} ${name}`, undoThen(() => put(row, prevQty)));
  } catch (e) { fail(e) }
}
async function useOne(code) {
  try {
    const row = await rpc('pantry_use_one', { p_code: code, p_loc: st.loc });
    if (!row) { beep(220); const n = st.products[code]?.name; said(`<b>${esc(n || code)}</b> isn't in stock`); return }
    apply({ ...row, qty: row.left });
    said(`Used <b>${esc(row.name)}</b>${row.exp ? ' (dated ' + fmt(row.exp) + ')' : ''} · ${row.left} left in ${esc(row.loc)}`);
    toast(`−1 ${row.name}`, undoThen(() => put(row, row.qty)));
  } catch (e) { fail(e) }
}
function saveProduct(code, name, brand, image) {
  if (st.products[code]?.name === name && !brand && !image) return;
  st.products[code] = { ...(st.products[code] || {}), name, ...(brand ? { brand } : {}), ...(image ? { image } : {}) };
  rpc('pantry_set_product', { p_code: code, p_name: name, p_brand: brand || '', p_image: image || '' }).catch(() => {});
}

/* ---------- Open Food Facts lookup ---------- */
const OFF = ['https://world.openfoodfacts.org', 'https://world.openproductsfacts.org', 'https://world.openbeautyfacts.org'];
const missed = new Set();
async function lookup(code) {
  if (st.products[code]) return st.products[code];
  if (!isBarcode(code) || missed.has(code)) return null;
  said('Looking up ' + esc(code) + '…');
  for (const host of OFF) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 6000);
    try {
      const r = await fetch(`${host}/api/v2/product/${code}?fields=product_name,product_name_en,generic_name,brands,quantity,image_front_small_url`, { signal: ac.signal });
      clearTimeout(t);
      if (!r.ok) continue;
      const d = await r.json(), p = d.product;
      if (d.status !== 1 || !p) continue;
      const base = (p.product_name || p.product_name_en || p.generic_name || '').trim();
      if (!base) continue;
      const brand = (p.brands || '').split(',')[0].trim();
      let name = brand && !base.toLowerCase().includes(brand.toLowerCase()) ? brand + ' ' + base : base;
      if (p.quantity && !name.includes(p.quantity)) name += ' ' + p.quantity.trim();
      name = name.replace(/\s+/g, ' ').slice(0, 120);
      const img = /^https:\/\//.test(p.image_front_small_url || '') ? p.image_front_small_url : '';
      saveProduct(code, name, brand, img);
      return st.products[code];
    } catch (e) { clearTimeout(t) }
  }
  missed.add(code); return null;
}

/* ---------- item sheet ---------- */
let sh = null;
function openSheet(o) {
  return new Promise(res => {
    sh = { ...o, res };
    $('#shT').textContent = o.edit ? 'Edit item' : (o.name || 'New item');
    $('#shCode').textContent = o.code && !o.code.startsWith('n:') ? (o.name || o.edit ? 'Code ' + o.code : 'Code ' + o.code + ' isn\'t in Open Food Facts. Name it once and it\'s remembered.') : '';
    $('#shName').value = o.name || ''; $('#shLoc').value = o.loc; $('#shQty').textContent = o.qty; $('#shExp').value = o.exp || ''; $('#shDel').hidden = !o.edit;
    const img = $('#shImg'); if (o.image) { img.src = o.image; img.hidden = false } else img.hidden = true;
    $('#sheet').classList.add('on');
    setTimeout(() => (o.name ? $('#shSave') : $('#shName')).focus(), 60);
  });
}
function closeSheet(v) { $('#sheet').classList.remove('on'); const s = sh; sh = null; s && s.res(v) }
$('#shMinus').onclick = () => { $('#shQty').textContent = Math.max(1, +$('#shQty').textContent - 1) };
$('#shPlus').onclick = () => { $('#shQty').textContent = +$('#shQty').textContent + 1 };
$('#expChips').onclick = e => { const b = e.target.closest('button'); if (!b) return; $('#shExp').value = b.dataset.d ? plus(+b.dataset.d) : '' };
$('#shSkip').onclick = () => closeSheet(null);
$('#sheet').onclick = e => { if (e.target.id === 'sheet') closeSheet(null) };
document.addEventListener('keydown', e => { if (!sh) return; if (e.key === 'Escape') closeSheet(null); if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); $('#shSave').click() } });
$('#shDel').onclick = () => closeSheet({ del: true });
$('#shSave').onclick = () => {
  const name = $('#shName').value.trim();
  if (!name) { $('#shName').focus(); $('#shName').placeholder = 'Give it a name first'; return }
  closeSheet({ name, loc: $('#shLoc').value, qty: +$('#shQty').textContent, exp: $('#shExp').value });
};

/* ---------- scan handling ---------- */
let paused = false, lastCode = '', lastAt = 0;
async function handle(code, typedName) {
  paused = true;
  try {
    if (st.mode === 'use') return await useOne(code);
    let p = await lookup(code);
    if (!p && typedName) p = { name: typedName };
    if (p && !$('#askExp').checked) return await addStock(code, p.name, st.loc, '', 1);
    if (!p) said(`New barcode <b>${esc(code)}</b>`);
    const r = await openSheet({ code, name: p?.name, image: p?.image, loc: st.loc, qty: 1, exp: '' });
    if (!r) { said('Skipped'); return }
    if (!p || r.name !== p.name) saveProduct(code, r.name);
    await addStock(code, r.name, r.loc, r.exp, r.qty);
  } finally { paused = false; lastCode = code; lastAt = Date.now() }
}
$('#typed').onsubmit = e => {
  e.preventDefault(); const v = $('#typedIn').value.trim(); if (!v) return; $('#typedIn').value = '';
  if (isBarcode(v)) handle(v); else handle('n:' + slug(v), v);
};
$('#askExp').onchange = e => ls.set('ask', e.target.checked);

/* ---------- camera ---------- */
const WANT = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code', 'data_matrix'];
let stream = null, detector = null, zx = null, timer = 0, canvas = null, torchOn = false;
function zxReader() {
  const Z = window.ZXing; if (!Z) return null;
  const h = new Map(), F = Z.BarcodeFormat;
  h.set(Z.DecodeHintType.POSSIBLE_FORMATS, [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF, F.QR_CODE, F.DATA_MATRIX]);
  h.set(Z.DecodeHintType.TRY_HARDER, true);
  const r = new Z.MultiFormatReader(); r.setHints(h); return r;
}
async function startCam() {
  if (!navigator.mediaDevices?.getUserMedia) { toast('This browser cannot open the camera. Type barcodes instead.'); return }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  } catch (e) { toast(e.name === 'NotAllowedError' ? 'Camera blocked. Allow camera access for this site in your browser settings.' : "Couldn't open the camera."); return }
  const v = $('#vid'); v.srcObject = stream; await v.play().catch(() => {});
  detector = null;
  if ('BarcodeDetector' in window) { try { const sup = await BarcodeDetector.getSupportedFormats(); const f = WANT.filter(x => sup.includes(x)); if (f.length) detector = new BarcodeDetector({ formats: f }) } catch (e) {} }
  if (!detector) zx = zx || zxReader();
  if (!detector && !zx) { toast("Scanner didn't load. Check your connection and reload."); stopCam(); return }
  const track = stream.getVideoTracks()[0], caps = track.getCapabilities ? track.getCapabilities() : {};
  $('#torch').hidden = !caps.torch; torchOn = false; $('#torch').setAttribute('aria-pressed', 'false');
  $('#camBox').classList.add('on'); $('#camCtl').hidden = false; said('Scanning…');
  tick();
}
function stopCam() { clearTimeout(timer); if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; $('#vid').srcObject = null; $('#camBox').classList.remove('on'); $('#camCtl').hidden = true }
async function readFrame(v) {
  if (detector) { const r = await detector.detect(v); return r.length ? r[0].rawValue : null }
  const vw = v.videoWidth, vh = v.videoHeight; if (!vw) return null;
  const sx = vw * .08, sy = vh * .2, sw = vw * .84, sh2 = vh * .6, k = Math.min(1, 900 / sw);
  canvas = canvas || document.createElement('canvas'); canvas.width = Math.round(sw * k); canvas.height = Math.round(sh2 * k);
  const c = canvas.getContext('2d', { willReadFrequently: true }); c.drawImage(v, sx, sy, sw, sh2, 0, 0, canvas.width, canvas.height);
  const Z = window.ZXing;
  try { return zx.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)))).getText() } catch (e) { return null } finally { zx.reset() }
}
async function tick() {
  if (!stream) return;
  const v = $('#vid');
  if (!paused && v.readyState >= 2) {
    let code = null; try { code = await readFrame(v) } catch (e) {}
    if (code) {
      code = code.trim().slice(0, 200);
      if (code === lastCode && Date.now() - lastAt < 2500) lastAt = Date.now();
      else { lastCode = code; lastAt = Date.now(); beep(st.mode === 'add' ? 880 : 600); const f = $('#flash'); f.classList.add('hit'); setTimeout(() => f.classList.remove('hit'), 60); await handle(code) }
    }
  }
  timer = setTimeout(tick, detector ? 120 : 160);
}
$('#camBtn').onclick = startCam;
$('#camStop').onclick = () => { stopCam(); said('') };
$('#torch').onclick = async () => { try { torchOn = !torchOn; await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: torchOn }] }); $('#torch').setAttribute('aria-pressed', torchOn) } catch (e) { toast("The light isn't available") } };

/* ---------- mode + location ---------- */
function setMode(m) {
  st.mode = m; $('#mAdd').setAttribute('aria-pressed', m === 'add'); $('#mUse').setAttribute('aria-pressed', m === 'use');
  $('#camBox').classList.toggle('use', m === 'use');
  $('#camTxt').textContent = m === 'add' ? 'Start scanning' : 'Scan to use up';
  $('#camSub').textContent = m === 'add' ? "Point the camera at barcodes. Each one is counted as it's read." : 'Each scan takes one off, oldest date first.';
}
$('#mAdd').onclick = () => setMode('add'); $('#mUse').onclick = () => setMode('use');
function drawLocs() { $('#locs').innerHTML = LOCS.map(l => `<button aria-pressed="${l === st.loc}" data-l="${esc(l)}">${esc(l)}</button>`).join('') }
$('#locs').onclick = e => { const b = e.target.closest('button'); if (!b) return; st.loc = b.dataset.l; ls.set('loc', st.loc); drawLocs() };
const opts = LOCS.map(l => `<option>${esc(l)}</option>`).join('');
$('#shLoc').innerHTML = opts; $('#fLoc').innerHTML = '<option value="">All places</option>' + opts;

/* ---------- list ---------- */
const bucket = i => { const d = days(i.exp); return d == null ? 'none' : d < 0 ? 'gone' : d <= 7 ? 'soon' : 'ok' };
function setFilter(f) { st.filter = f; document.querySelectorAll('#fChips button').forEach(b => b.setAttribute('aria-pressed', b.dataset.f === f)); render() }
document.querySelectorAll('[data-f]').forEach(b => b.onclick = () => setFilter(b.dataset.f));
$('#q').oninput = render; $('#fLoc').onchange = render;
function render() {
  const all = [...st.items.values()];
  $('#sTot').textContent = all.reduce((s, i) => s + i.qty, 0);
  $('#sSoon').textContent = all.filter(i => bucket(i) === 'soon').length;
  $('#sGone').textContent = all.filter(i => bucket(i) === 'gone').length;
  if (!st.loaded) return;
  const q = $('#q').value.trim().toLowerCase(), fl = $('#fLoc').value;
  const rows = all.filter(i => (!q || i.name.toLowerCase().includes(q) || i.code.includes(q)) && (!fl || i.loc === fl) && (st.filter === 'all' || bucket(i) === st.filter))
    .sort((a, b) => (a.exp || '9999').localeCompare(b.exp || '9999') || a.name.localeCompare(b.name));
  $('#list').innerHTML = rows.length ? rows.map(i => {
    const d = days(i.exp), b = bucket(i), img = st.products[i.code]?.image;
    const tag = i.exp ? `<span class="tag ${b}">${b === 'gone' ? 'Past ' + fmt(i.exp) : fmt(i.exp) + (b === 'soon' ? (d === 0 ? ' · today' : ' · ' + d + 'd') : '')}</span>` : '<span>No date</span>';
    return `<li class="it" data-id="${i.id}">${img ? `<img class="thumb" src="${esc(img)}" alt="" loading="lazy">` : '<span class="thumb"></span>'}<div><button class="nm" data-a="edit">${esc(i.name)}</button><div class="meta"><span>${esc(i.loc)}</span>${tag}</div></div><div class="qty"><button data-a="dec" aria-label="One less ${esc(i.name)}">−</button><b class="num">${i.qty}</b><button data-a="inc" aria-label="One more ${esc(i.name)}">+</button></div></li>`;
  }).join('') : `<li class="empty">${all.length ? 'Nothing matches.' : 'Nothing here yet. Tap Start scanning.'}</li>`;
}
$('#list').onclick = async e => {
  const b = e.target.closest('button[data-a]'); if (!b) return;
  const id = +b.closest('li').dataset.id, it = st.items.get(id); if (!it) return;
  const prev = { ...it };
  try {
    if (b.dataset.a !== 'edit') {
      const delta = b.dataset.a === 'inc' ? 1 : -1;
      apply({ ...it, qty: it.qty + delta });
      const row = await rpc('pantry_adjust', { p_id: id, p_delta: delta }); if (row) apply(row);
      if (it.qty + delta <= 0) toast('Removed ' + it.name, undoThen(() => put(prev, prev.qty)));
      return;
    }
    paused = true;
    const r = await openSheet({ edit: true, code: it.code, name: it.name, image: st.products[it.code]?.image, loc: it.loc, qty: it.qty, exp: it.exp });
    paused = false;
    if (!r) return;
    if (r.del) { st.items.delete(id); render(); await rpc('pantry_delete', { p_id: id }); toast('Removed ' + it.name, undoThen(() => put(prev, prev.qty))); return }
    const other = findItem(it.code, r.loc, r.exp), otherPrev = other && other.id !== id ? { ...other } : null;
    if (r.name !== it.name) saveProduct(it.code, r.name);
    await rpc('pantry_edit', { p_id: id, p_name: r.name, p_loc: r.loc, p_exp: r.exp || '', p_qty: r.qty });
    await load();
    toast('Saved ' + r.name, undoThen(async () => {
      const moved = r.loc !== prev.loc || (r.exp || '') !== prev.exp;
      if (moved) await put({ ...prev, loc: r.loc, exp: r.exp || '' }, otherPrev ? otherPrev.qty : 0);
      await put(prev, prev.qty);
    }));
  } catch (err) { paused = false; fail(err); load() }
};

/* ---------- export + share ---------- */
function csv() {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return ['Name,Location,Quantity,Expiry,Barcode', ...[...st.items.values()].sort((a, b) => a.name.localeCompare(b.name)).map(i => [i.name, i.loc, i.qty, i.exp, i.code.startsWith('n:') ? '' : i.code].map(q).join(','))].join('\n');
}
$('#copyCsv').onclick = async () => { try { await navigator.clipboard.writeText(csv()); toast('Copied. Paste into a spreadsheet.') } catch (e) { toast("Couldn't copy") } };
$('#dlCsv').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv()], { type: 'text/csv' })); a.download = 'pantry-' + new Date().toLocaleDateString('en-CA') + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000) };
$('#share').onclick = async () => {
  if (navigator.share) { try { await navigator.share({ title: 'Pantry Count', url: shareUrl() }); return } catch (e) { if (e.name === 'AbortError') return } }
  try { await navigator.clipboard.writeText(shareUrl()); toast('Link copied. Send it to your household.') } catch (e) { toast("Couldn't copy the link") }
};
$('#tUndo').onclick = () => { if (undoFn) { const f = undoFn; undoFn = null; $('#toast').classList.remove('on'); f() } };

/* ---------- gate + start ---------- */
function showGate(msg) { stopCam(); $('#gate').hidden = false; $('#gateErr').textContent = msg || ''; $('#sync').textContent = 'Not connected' }
$('#gateF').onsubmit = e => { e.preventDefault(); const k = keyFrom($('#gateIn').value); if (!k) { $('#gateErr').textContent = "That doesn't look like a household link."; return } HK = k; keepKey(); $('#gate').hidden = true; load() };
window.addEventListener('hashchange', () => { const k = keyFrom(location.hash); if (k && k !== HK) { HK = k; ls.set('key', HK); $('#gate').hidden = true; load() } });
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCam(); else load() });
setInterval(() => { if (!document.hidden && !sh && !paused) load() }, 20000);
drawLocs(); setMode('add'); render();
if (HK) { keepKey(); load() } else showGate();
}
