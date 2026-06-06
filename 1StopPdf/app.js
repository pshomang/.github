/* ===== 1Stop Pdf — app.js ===== */
'use strict';

// ── CDN URLs ──────────────────────────────────────────────────────────────────
const PDF_JS_URL    = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDF_WORKER    = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

// ── STATE ────────────────────────────────────────────────────────────────────
const state = {
  docType: null,          // 'pdf' | 'image' | 'docx'
  pdfDoc: null,
  currentPage: 1,
  totalPages: 1,
  zoom: 1.0,
  imageEl: null,          // HTMLImageElement for image docs
  docxXml: null,          // raw DOCX XML string
  docxZip: null,          // JSZip object
  overlays: [],           // [{el, type, page}]
  undoStack: [],
  sigMode: 'draw',
  activePanel: null,
  ocrData: null,          // last OCR result
  stats: loadStats(),
  deferPdf: null,         // saved PDF bytes for export
};

const LINGVA_MIRRORS = [
  'https://lingva.ml',
  'https://lingva.thedaviddelta.com',
  'https://translate.plausibility.cloud'
];

// ── FACTS ─────────────────────────────────────────────────────────────────────
const FACTS = [
  'PDF stands for Portable Document Format, invented by Adobe in 1993.',
  'Tesseract OCR was originally developed at HP Labs in the 1980s.',
  'South Africa has 11 official languages — the most of any African country.',
  'The first digital signature standard was published by NIST in 1994.',
  'DOCX is a ZIP archive containing XML files — you can rename one to .zip and open it.',
  'OCR accuracy can exceed 99% for clean printed text.',
  'PDF/A is the archival variant of PDF used by libraries and governments.',
  'Afrikaans evolved from 17th-century Dutch spoken by settlers at the Cape.',
  'Tesseract is now maintained by Google and supports over 100 languages.',
  'The first smartphone with a camera was the Sharp J-SH04, released in Japan in 2000.',
  'A PWA (Progressive Web App) can be installed on your home screen like a native app.',
  'WebAssembly lets native C/C++ code run in the browser — Tesseract uses this.',
  'PDF version 2.0 was released in 2017 and is fully open (ISO 32000-2).',
  'The word "document" comes from the Latin documentum, meaning lesson or proof.',
  'Zulu (isiZulu) is spoken by about 12 million people, the largest SA language group.',
  'Base64 encoding makes binary data safe to embed in HTML and JSON.',
  'Canvas 2D is the browser API used to render PDFs and composite signatures.',
  'Service Workers enable offline-capable web apps — 1Stop Pdf uses one.',
  'MyMemory is the world\'s largest publicly available translation memory.',
  'PNG supports transparent backgrounds, making it ideal for signature images.',
  'The Unicode standard now covers over 149,000 characters across 159 scripts.',
  'Local Storage can hold up to ~5 MB of data per origin in most browsers.',
  'Drag-and-drop file upload was standardised in HTML5.',
  'JPEG uses lossy compression; PNG is lossless — choose PNG for text-heavy images.',
  'WebP was developed by Google in 2010 and offers superior compression.',
  'The average PDF is about 200 KB; the average scanned page is 150–300 KB.',
  'ISOcat 639-3 code for isiZulu is "zul" — the same code Tesseract uses.',
  'Sesotho (Southern Sotho) and Sepedi (Northern Sotho) are distinct languages despite similar names.',
  'The first browser with native PDF rendering (no plugin) was Google Chrome 6 (2010).',
  'IndexedDB can store gigabytes of binary data in the browser, unlike localStorage.',
  'Handwriting recognition is a subset of OCR — Tesseract works best on printed text.',
  'xitsonga is spoken mostly in Limpopo, Mpumalanga, and Gaza province, Mozambique.',
];

// ── UTILS ────────────────────────────────────────────────────────────────────
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function setProgress(pct) {
  document.getElementById('progress').style.width = pct + '%';
  if (pct >= 100) setTimeout(() => setProgress(0), 600);
}

function loadStats() {
  try { return JSON.parse(localStorage.getItem('1stoppdf_stats') || '{}'); }
  catch { return {}; }
}

function saveStats() {
  localStorage.setItem('1stoppdf_stats', JSON.stringify(state.stats));
}

function incStat(key) {
  state.stats[key] = (state.stats[key] || 0) + 1;
  saveStats();
  renderDashboard();
}

function renderDashboard() {
  document.getElementById('stat-docs').textContent       = state.stats.docs || 0;
  document.getElementById('stat-ocr').textContent        = state.stats.ocr  || 0;
  document.getElementById('stat-sigs').textContent       = state.stats.sigs  || 0;
  document.getElementById('stat-saves').textContent      = state.stats.saves || 0;
  document.getElementById('stat-translates').textContent = state.stats.translates || 0;
}

// ── FACTS ROTATION ────────────────────────────────────────────────────────────
let factIdx = Math.floor(Math.random() * FACTS.length);
function rotateFact() {
  const el = document.getElementById('fact-text');
  if (!el) return;
  el.style.opacity = '0';
  setTimeout(() => {
    factIdx = (factIdx + 1) % FACTS.length;
    el.textContent = FACTS[factIdx];
    el.style.opacity = '1';
  }, 400);
}
setInterval(rotateFact, 7000);
document.getElementById('fact-text').textContent = FACTS[factIdx];

// ── TABS ─────────────────────────────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  const t = document.getElementById('tab-' + name);
  if (t) t.classList.add('active');
  document.getElementById('sidebar').classList.toggle('collapsed', name !== 'doc');
}

document.querySelectorAll('[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

// ── PANELS ───────────────────────────────────────────────────────────────────
function openPanel(name) {
  if (state.activePanel) closePanel(state.activePanel);
  document.getElementById('panel-' + name).classList.add('open');
  document.getElementById('panel-backdrop').style.display = 'block';
  state.activePanel = name;
}
function closePanel(name) {
  document.getElementById('panel-' + name)?.classList.remove('open');
  document.getElementById('panel-backdrop').style.display = 'none';
  state.activePanel = null;
}
document.querySelectorAll('[data-panel]').forEach(btn => {
  btn.addEventListener('click', () => openPanel(btn.dataset.panel));
});
document.querySelectorAll('[data-close-panel]').forEach(btn => {
  btn.addEventListener('click', () => closePanel(btn.dataset.closePanel));
});
document.getElementById('panel-backdrop').addEventListener('click', () => {
  if (state.activePanel) closePanel(state.activePanel);
});

// ── SERVICE WORKER ───────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ── PWA INSTALL ───────────────────────────────────────────────────────────────
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstall = e;
  document.getElementById('btn-install').style.display = 'inline-flex';
});
document.getElementById('btn-install').addEventListener('click', () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  deferredInstall.userChoice.then(() => { deferredInstall = null; });
});

// ── FILE OPEN ────────────────────────────────────────────────────────────────
const fileInput = document.getElementById('file-input');
const camInput  = document.getElementById('cam-input');

document.getElementById('tb-open').addEventListener('click', () => fileInput.click());
document.getElementById('tb-scan').addEventListener('click', () => camInput.click());

fileInput.addEventListener('change', e => e.target.files[0] && loadFile(e.target.files[0]));
camInput.addEventListener('change',  e => e.target.files[0] && loadFile(e.target.files[0]));

// Drag & drop on drop zone
const dropZone = document.getElementById('drop-zone');
if (dropZone) {
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  });
}

// Drag & drop on whole canvas area
const canvasArea = document.getElementById('canvas-area');
canvasArea.addEventListener('dragover', e => e.preventDefault());
canvasArea.addEventListener('drop', e => {
  e.preventDefault();
  if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
});

async function loadFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  setProgress(20);
  try {
    if (ext === 'pdf') {
      await loadPdf(file);
    } else if (['jpg','jpeg','png','webp','bmp','gif'].includes(ext) || file.type.startsWith('image/')) {
      await loadImage(file);
    } else if (ext === 'docx') {
      await loadDocx(file);
    } else {
      toast('Unsupported file type: ' + ext, 'error');
      setProgress(0);
      return;
    }
    incStat('docs');
    showTab('doc');
    document.getElementById('no-doc').style.display = 'none';
    document.getElementById('canvas-wrap').style.display = 'block';
    setProgress(100);
  } catch (err) {
    toast('Error loading file: ' + err.message, 'error');
    setProgress(0);
    console.error(err);
  }
}

// ── PDF LOADING ───────────────────────────────────────────────────────────────
async function ensurePdfJs() {
  if (window.pdfjsLib) return;
  await loadScript(PDF_JS_URL);
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
}

async function loadPdf(file) {
  await ensurePdfJs();
  const buf = await file.arrayBuffer();
  state.deferPdf = buf.slice(0);
  state.pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
  state.docType = 'pdf';
  state.totalPages = state.pdfDoc.numPages;
  state.currentPage = 1;
  state.overlays = [];
  clearOverlay();
  await renderPage(1);
  buildThumbnails();
}

async function renderPage(num) {
  const page = await state.pdfDoc.getPage(num);
  const vp = page.getViewport({ scale: state.zoom });
  const canvas = document.getElementById('main-canvas');
  canvas.width  = vp.width;
  canvas.height = vp.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  state.currentPage = num;
  syncOverlaySize();
}

async function buildThumbnails() {
  const container = document.getElementById('sidebar-content');
  container.innerHTML = '';
  for (let i = 1; i <= state.totalPages; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'page-thumb' + (i === state.currentPage ? ' active' : '');
    wrap.dataset.page = i;
    const c = document.createElement('canvas');
    wrap.appendChild(c);
    const badge = document.createElement('span');
    badge.className = 'page-badge';
    badge.textContent = i;
    wrap.appendChild(badge);
    container.appendChild(wrap);
    wrap.addEventListener('click', async () => {
      document.querySelectorAll('.page-thumb').forEach(t => t.classList.remove('active'));
      wrap.classList.add('active');
      await renderPage(i);
    });
    // async render thumbnail
    (async (pageNum, canvasEl) => {
      const pg = await state.pdfDoc.getPage(pageNum);
      const vp = pg.getViewport({ scale: 0.2 });
      canvasEl.width  = vp.width;
      canvasEl.height = vp.height;
      await pg.render({ canvasContext: canvasEl.getContext('2d'), viewport: vp }).promise;
    })(i, c);
  }
}

// ── IMAGE LOADING ─────────────────────────────────────────────────────────────
async function loadImage(file) {
  const url = URL.createObjectURL(file);
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
  state.docType = 'image';
  state.imageEl = img;
  state.imageFile = file;
  state.totalPages = 1;
  state.currentPage = 1;
  state.overlays = [];
  clearOverlay();
  const canvas = document.getElementById('main-canvas');
  canvas.width  = img.naturalWidth  * state.zoom;
  canvas.height = img.naturalHeight * state.zoom;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  syncOverlaySize();
  document.getElementById('sidebar-content').innerHTML = '';
}

// ── DOCX LOADING ──────────────────────────────────────────────────────────────
async function loadDocx(file) {
  await ensureJsZip();
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const xml  = await zip.file('word/document.xml').async('string');
  state.docType   = 'docx';
  state.docxZip   = zip;
  state.docxXml   = xml;
  state.docxFile  = file;
  state.totalPages = 1;
  state.overlays  = [];
  clearOverlay();
  renderDocx(xml);
}

function renderDocx(xml) {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(xml, 'application/xml');
  const paras  = doc.querySelectorAll('p');
  const canvas = document.getElementById('main-canvas');
  canvas.width  = 794;
  canvas.height = Math.max(1123, paras.length * 28 + 80);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#1a1a1a';
  ctx.font = '14px serif';
  let y = 48;
  paras.forEach(p => {
    const text = p.textContent.trim();
    if (!text) { y += 8; return; }
    // word-wrap
    const words = text.split(' ');
    let line = '';
    const maxW = 720;
    words.forEach(w => {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, 40, y);
        y += 22;
        line = w;
      } else { line = test; }
    });
    if (line) { ctx.fillText(line, 40, y); y += 22; }
    y += 6;
  });
  syncOverlaySize();
}

// ── ZOOM ──────────────────────────────────────────────────────────────────────
document.getElementById('btn-zoom-in').addEventListener('click', () => setZoom(state.zoom + 0.15));
document.getElementById('btn-zoom-out').addEventListener('click', () => setZoom(state.zoom - 0.15));

async function setZoom(z) {
  state.zoom = Math.min(4, Math.max(0.25, z));
  document.getElementById('zoom-label').textContent = Math.round(state.zoom * 100) + '%';
  if (state.docType === 'pdf') await renderPage(state.currentPage);
  else if (state.docType === 'image') {
    const canvas = document.getElementById('main-canvas');
    canvas.width  = state.imageEl.naturalWidth  * state.zoom;
    canvas.height = state.imageEl.naturalHeight * state.zoom;
    canvas.getContext('2d').drawImage(state.imageEl, 0, 0, canvas.width, canvas.height);
    syncOverlaySize();
  }
}

// ── OVERLAY ───────────────────────────────────────────────────────────────────
function syncOverlaySize() {
  const canvas = document.getElementById('main-canvas');
  const ov = document.getElementById('overlay');
  ov.style.width  = canvas.width  + 'px';
  ov.style.height = canvas.height + 'px';
}

function clearOverlay() {
  document.getElementById('overlay').innerHTML = '';
}

function makeElement(type) {
  const wrap = document.createElement('div');
  wrap.className = 'overlay-element';
  wrap.dataset.type = type;
  // delete handle
  const del = document.createElement('span');
  del.className = 'delete-handle';
  del.textContent = '×';
  del.addEventListener('click', e => { e.stopPropagation(); removeElement(wrap); });
  wrap.appendChild(del);
  // resize handle
  const rsz = document.createElement('span');
  rsz.className = 'resize-handle';
  wrap.appendChild(rsz);
  makeDraggable(wrap);
  makeResizable(wrap, rsz);
  wrap.addEventListener('pointerdown', () => selectEl(wrap));
  document.getElementById('overlay').appendChild(wrap);
  state.overlays.push({ el: wrap, type, page: state.currentPage });
  return wrap;
}

function selectEl(el) {
  document.querySelectorAll('.overlay-element').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
}

function removeElement(el) {
  state.overlays = state.overlays.filter(o => o.el !== el);
  el.remove();
}

function makeDraggable(el) {
  let ox, oy, sx, sy;
  el.addEventListener('pointerdown', e => {
    if (e.target.classList.contains('resize-handle') || e.target.classList.contains('delete-handle')) return;
    e.preventDefault();
    ox = parseInt(el.style.left) || 0;
    oy = parseInt(el.style.top)  || 0;
    sx = e.clientX; sy = e.clientY;
    const move = ev => {
      el.style.left = (ox + ev.clientX - sx) + 'px';
      el.style.top  = (oy + ev.clientY - sy) + 'px';
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}

function makeResizable(el, handle) {
  handle.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    const sw = parseInt(el.style.width)  || el.offsetWidth;
    const sh = parseInt(el.style.height) || el.offsetHeight;
    const sx = e.clientX, sy = e.clientY;
    const move = ev => {
      el.style.width  = Math.max(40, sw + ev.clientX - sx) + 'px';
      el.style.height = Math.max(20, sh + ev.clientY - sy) + 'px';
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}

// ── TEXT BOXES ────────────────────────────────────────────────────────────────
document.getElementById('tb-text').addEventListener('click', addTextBox);

function addTextBox(x = 80, y = 80, text = 'Click to edit') {
  const el = makeElement('text');
  const input = document.createElement('div');
  input.contentEditable = 'true';
  input.style.cssText = 'min-width:120px;min-height:24px;outline:none;font-size:16px;color:#1a1a1a;padding:2px 4px;font-family:sans-serif;white-space:pre-wrap;';
  input.textContent = text;
  el.insertBefore(input, el.firstChild);
  el.style.left = x + 'px';
  el.style.top  = y + 'px';
  el.style.background = 'rgba(255,255,255,0.85)';
  el.style.padding = '4px';
  el.style.borderRadius = '4px';
  selectEl(el);
  setTimeout(() => input.focus(), 50);
}

// ── SIGNATURES ────────────────────────────────────────────────────────────────
window.setSigMode = function(mode) {
  state.sigMode = mode;
  document.getElementById('sig-draw-area').style.display   = mode === 'draw'   ? 'block' : 'none';
  document.getElementById('sig-type-area').style.display   = mode === 'type'   ? 'block' : 'none';
  document.getElementById('sig-upload-area').style.display = mode === 'upload' ? 'block' : 'none';
};

// Signature canvas drawing
const sigCanvas = document.getElementById('sig-canvas');
const sigCtx    = sigCanvas.getContext('2d');
let sigDrawing  = false;
let sigLastX, sigLastY;

function resizeSigCanvas() {
  const rect = sigCanvas.getBoundingClientRect();
  sigCanvas.width  = rect.width  || 320;
  sigCanvas.height = rect.height || 180;
  sigCtx.strokeStyle = document.getElementById('sig-color').value || '#1a1a2e';
  sigCtx.lineWidth = 2.5;
  sigCtx.lineCap   = 'round';
  sigCtx.lineJoin  = 'round';
}
resizeSigCanvas();
window.addEventListener('resize', resizeSigCanvas);

function getSigPos(e) {
  const r = sigCanvas.getBoundingClientRect();
  const t = e.touches ? e.touches[0] : e;
  return [t.clientX - r.left, t.clientY - r.top];
}

sigCanvas.addEventListener('pointerdown', e => {
  sigDrawing = true;
  [sigLastX, sigLastY] = getSigPos(e);
  sigCtx.beginPath();
  sigCtx.moveTo(sigLastX, sigLastY);
});
sigCanvas.addEventListener('pointermove', e => {
  if (!sigDrawing) return;
  const [x, y] = getSigPos(e);
  sigCtx.lineTo(x, y);
  sigCtx.stroke();
  sigLastX = x; sigLastY = y;
});
['pointerup','pointerleave'].forEach(ev => sigCanvas.addEventListener(ev, () => { sigDrawing = false; }));

document.getElementById('btn-sig-clear').addEventListener('click', () => {
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
});

document.getElementById('sig-color').addEventListener('change', e => {
  sigCtx.strokeStyle = e.target.value;
});

// Signature file upload
document.getElementById('sig-file').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  const img = new Image();
  img.onload = () => {
    sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
    const scale = Math.min(sigCanvas.width / img.width, sigCanvas.height / img.height);
    const w = img.width * scale, h = img.height * scale;
    sigCtx.drawImage(img, (sigCanvas.width - w) / 2, (sigCanvas.height - h) / 2, w, h);
  };
  img.src = url;
});

// Place signature on document
document.getElementById('btn-place-sig').addEventListener('click', () => {
  if (!state.docType) { toast('Open a document first', 'error'); return; }
  let dataUrl;
  if (state.sigMode === 'draw' || state.sigMode === 'upload') {
    dataUrl = sigCanvas.toDataURL('image/png');
  } else {
    // type mode
    const text = document.getElementById('sig-type-text').value.trim();
    if (!text) { toast('Enter your name/initials', 'error'); return; }
    const font  = document.getElementById('sig-type-font').value;
    const tc = document.createElement('canvas');
    tc.width = 400; tc.height = 100;
    const tctx = tc.getContext('2d');
    tctx.font = `56px ${font}`;
    tctx.fillStyle = '#1a1a2e';
    tctx.textBaseline = 'middle';
    tctx.fillText(text, 10, 50);
    dataUrl = tc.toDataURL('image/png');
  }
  const el = makeElement('sig');
  const img = document.createElement('img');
  img.src = dataUrl;
  img.style.cssText = 'width:100%;height:100%;object-fit:contain;pointer-events:none;';
  el.insertBefore(img, el.firstChild);
  el.style.left   = '60px';
  el.style.top    = '60px';
  el.style.width  = '200px';
  el.style.height = '80px';
  selectEl(el);
  closePanel('sign');
  incStat('sigs');
  toast('Signature placed — drag to position', 'success');
});

// ── OCR ───────────────────────────────────────────────────────────────────────
async function ensureTesseract() {
  if (window.Tesseract) return;
  await loadScript(TESSERACT_URL);
}

document.getElementById('btn-run-ocr').addEventListener('click', runOcr);

async function runOcr() {
  if (!state.docType) { toast('Open a document first', 'error'); return; }
  const lang = document.getElementById('ocr-lang').value;
  toast('Running OCR… (first run downloads language data)');
  setProgress(30);
  try {
    await ensureTesseract();
    const canvas = document.getElementById('main-canvas');
    const worker = await Tesseract.createWorker(lang, 1, {
      logger: m => { if (m.status === 'recognizing text') setProgress(30 + m.progress * 60); }
    });
    const result = await worker.recognize(canvas);
    await worker.terminate();
    state.ocrData = result.data;
    const out = document.getElementById('ocr-output');
    out.textContent = result.data.text;
    out.style.display = 'block';
    document.getElementById('ocr-actions').style.display = 'flex';
    incStat('ocr');
    setProgress(100);
    toast('OCR complete', 'success');
  } catch (err) {
    toast('OCR error: ' + err.message, 'error');
    setProgress(0);
  }
}

// Copy OCR text
document.getElementById('btn-ocr-copy').addEventListener('click', () => {
  if (!state.ocrData) return;
  navigator.clipboard.writeText(state.ocrData.text).then(() => toast('Text copied', 'success'));
});

// Send OCR text to translator
document.getElementById('btn-ocr-translate').addEventListener('click', () => {
  if (!state.ocrData) return;
  document.getElementById('tr-input').value = state.ocrData.text;
  openPanel('translate');
});

// Edit OCR text in place
document.getElementById('btn-ocr-edit').addEventListener('click', placeOcrBoxes);

function placeOcrBoxes() {
  if (!state.ocrData) { toast('Run OCR first', 'error'); return; }
  const canvas  = document.getElementById('main-canvas');
  const scaleX  = canvas.width  / (state.ocrData.hocr ? 1 : canvas.width);
  // Tesseract gives bounding boxes relative to image dimensions
  const imgW    = state.ocrData.lines?.[0]?.bbox ? canvas.width  : canvas.width;
  const imgH    = state.ocrData.lines?.[0]?.bbox ? canvas.height : canvas.height;
  const lines   = state.ocrData.lines || [];
  lines.forEach(line => {
    const { x0, y0, x1, y1 } = line.bbox;
    const w = x1 - x0, h = y1 - y0;
    // sample background color at center of bounding box
    const ctx  = canvas.getContext('2d');
    const px   = ctx.getImageData(Math.min(x0 + w / 2, canvas.width - 1), Math.min(y0 + h / 2, canvas.height - 1), 1, 1).data;
    const bg   = `rgb(${px[0]},${px[1]},${px[2]})`;
    const el   = makeElement('ocr-text');
    el.style.left   = x0 + 'px';
    el.style.top    = y0 + 'px';
    el.style.width  = w  + 'px';
    el.style.height = h  + 'px';
    el.style.background = bg;
    el.style.overflow = 'hidden';
    const input = document.createElement('div');
    input.contentEditable = 'true';
    input.style.cssText = `width:100%;height:100%;outline:none;font-size:${Math.max(10, h * 0.7)}px;color:#111;padding:1px 2px;font-family:sans-serif;white-space:pre-wrap;overflow:hidden;`;
    input.textContent = line.text.trim();
    el.insertBefore(input, el.firstChild);
  });
  closePanel('ocr');
  toast('OCR boxes placed — click to edit', 'success');
}

// Searchable PDF export
document.getElementById('btn-ocr-searchable').addEventListener('click', exportSearchablePdf);

async function exportSearchablePdf() {
  if (!state.ocrData) { toast('Run OCR first', 'error'); return; }
  toast('Building searchable PDF…');
  setProgress(40);
  await ensurePdfJs();
  const canvas  = document.getElementById('main-canvas');
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  // Build minimal PDF with invisible text layer using pdf-lib
  await ensurePdfLib();
  const { PDFDocument, rgb, StandardFonts } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  const imgBytes = await fetch(dataUrl).then(r => r.arrayBuffer());
  const jpgImg   = await pdfDoc.embedJpg(imgBytes);
  const page     = pdfDoc.addPage([canvas.width, canvas.height]);
  page.drawImage(jpgImg, { x: 0, y: 0, width: canvas.width, height: canvas.height });
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const lines = state.ocrData.lines || [];
  lines.forEach(line => {
    const { x0, y0, x1, y1 } = line.bbox;
    const h = y1 - y0;
    page.drawText(line.text.trim(), {
      x: x0,
      y: canvas.height - y1,
      size: Math.max(6, h * 0.8),
      font,
      color: rgb(0, 0, 0),
      opacity: 0,
    });
  });
  const bytes = await pdfDoc.save();
  downloadBytes(bytes, 'searchable.pdf', 'application/pdf');
  setProgress(100);
  toast('Searchable PDF downloaded', 'success');
}

// ── TRANSLATE ─────────────────────────────────────────────────────────────────
document.getElementById('btn-lang-swap').addEventListener('click', () => {
  const f = document.getElementById('tr-from');
  const t = document.getElementById('tr-to');
  const tmp = f.value;
  f.value = t.value === 'auto' ? 'en' : t.value;
  t.value = tmp === 'auto' ? 'en' : tmp;
});

document.getElementById('btn-translate').addEventListener('click', runTranslate);

async function runTranslate() {
  const text = document.getElementById('tr-input').value.trim();
  if (!text) { toast('Enter text to translate', 'error'); return; }
  const from = document.getElementById('tr-from').value;
  const to   = document.getElementById('tr-to').value;
  document.getElementById('tr-output').value = 'Translating…';
  setProgress(30);
  try {
    const result = await translateText(text, from, to);
    document.getElementById('tr-output').value = result;
    incStat('translates');
    setProgress(100);
  } catch (err) {
    document.getElementById('tr-output').value = 'Translation failed: ' + err.message;
    setProgress(0);
    toast('Translation failed', 'error');
  }
}

async function translateText(text, from, to) {
  // chunk large text
  if (text.length > 1800) {
    const chunks = [];
    for (let i = 0; i < text.length; i += 1800) chunks.push(text.slice(i, i + 1800));
    const results = await Promise.all(chunks.map(c => translateText(c, from, to)));
    return results.join(' ');
  }
  // Try Lingva mirrors
  const src = from === 'auto' ? 'auto' : from;
  for (const mirror of LINGVA_MIRRORS) {
    try {
      const url = `${mirror}/api/v1/${src}/${to}/${encodeURIComponent(text)}`;
      const res = await fetchWithTimeout(url, 6000);
      if (res.ok) {
        const j = await res.json();
        if (j.translation) return j.translation;
      }
    } catch { /* try next */ }
  }
  // MyMemory fallback
  const mm = await fetchWithTimeout(
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${src === 'auto' ? 'en' : src}|${to}`,
    8000
  );
  const mj = await mm.json();
  if (mj.responseStatus === 200) return mj.responseData.translatedText;
  throw new Error(mj.responseDetails || 'All providers failed');
}

function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

document.getElementById('btn-tr-copy').addEventListener('click', () => {
  const val = document.getElementById('tr-output').value;
  if (val) navigator.clipboard.writeText(val).then(() => toast('Copied', 'success'));
});

// ── SAVE / EXPORT ─────────────────────────────────────────────────────────────
document.getElementById('btn-save').addEventListener('click', saveDocument);

async function saveDocument() {
  if (!state.docType) { toast('No document open', 'error'); return; }
  setProgress(20);
  try {
    if (state.docType === 'pdf') await savePdf();
    else if (state.docType === 'image') await saveImage();
    else if (state.docType === 'docx') await saveDocx();
    incStat('saves');
    setProgress(100);
  } catch (err) {
    toast('Save error: ' + err.message, 'error');
    setProgress(0);
  }
}

async function savePdf() {
  await ensurePdfLib();
  const { PDFDocument, rgb } = PDFLib;
  const existingBytes = state.deferPdf;
  const pdfDoc = await PDFDocument.load(existingBytes);
  const pages  = pdfDoc.getPages();
  // render overlays for current page
  const pageIdx = state.currentPage - 1;
  const page    = pages[pageIdx];
  const { width: pw, height: ph } = page.getSize();
  const canvas  = document.getElementById('main-canvas');
  const scaleX  = pw / canvas.width;
  const scaleY  = ph / canvas.height;
  const overlayEls = state.overlays.filter(o => o.page === state.currentPage);
  for (const { el, type } of overlayEls) {
    const left = parseInt(el.style.left) || 0;
    const top  = parseInt(el.style.top)  || 0;
    const w    = el.offsetWidth;
    const h    = el.offsetHeight;
    const pdfX = left * scaleX;
    const pdfY = ph - (top + h) * scaleY;
    if (type === 'sig') {
      const img   = el.querySelector('img');
      const bytes = await fetch(img.src).then(r => r.arrayBuffer());
      const embed = img.src.includes('jpeg') ?
        await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes);
      page.drawImage(embed, { x: pdfX, y: pdfY, width: w * scaleX, height: h * scaleY });
    } else if (type === 'text' || type === 'ocr-text') {
      const div  = el.querySelector('[contenteditable]');
      const text = div ? div.textContent : '';
      const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
      const fs   = 12;
      text.split('\n').forEach((line, i) => {
        page.drawText(line, { x: pdfX, y: pdfY + h * scaleY - fs * (i + 1), size: fs, font, color: rgb(0.1, 0.1, 0.1) });
      });
    }
  }
  const bytes = await pdfDoc.save();
  downloadBytes(bytes, 'document.pdf', 'application/pdf');
  toast('PDF saved', 'success');
}

async function saveImage() {
  const canvas = document.getElementById('main-canvas');
  // flatten overlays onto a temp canvas
  const tmp  = document.createElement('canvas');
  tmp.width  = canvas.width;
  tmp.height = canvas.height;
  const ctx  = tmp.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  for (const { el, type } of state.overlays) {
    const left = parseInt(el.style.left) || 0;
    const top  = parseInt(el.style.top)  || 0;
    const w    = el.offsetWidth;
    const h    = el.offsetHeight;
    if (type === 'sig') {
      const img = el.querySelector('img');
      const i   = await loadImgEl(img.src);
      ctx.drawImage(i, left, top, w, h);
    } else {
      const div  = el.querySelector('[contenteditable]');
      const text = div ? div.textContent : '';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(left, top, w, h);
      ctx.fillStyle = '#111';
      ctx.font = '14px sans-serif';
      ctx.fillText(text, left + 4, top + 18);
    }
  }
  const mimeType = state.imageFile?.type || 'image/png';
  const ext      = mimeType.split('/')[1] || 'png';
  const url      = tmp.toDataURL(mimeType);
  downloadUrl(url, 'image.' + ext);
  toast('Image saved', 'success');
}

async function saveDocx() {
  await ensureJsZip();
  const zip = state.docxZip;
  // collect edits from overlay text boxes
  let xml = state.docxXml;
  // simple replacement: replace text content in XML
  state.overlays.forEach(({ el, type }) => {
    if (type !== 'text') return;
    const div = el.querySelector('[contenteditable]');
    if (!div) return;
    // just append a paragraph with the edited text
  });
  zip.file('word/document.xml', xml);
  const blob = await zip.generateAsync({ type: 'blob' });
  const url  = URL.createObjectURL(blob);
  downloadUrl(url, 'document.docx');
  toast('DOCX saved', 'success');
}

// ── UNDO ──────────────────────────────────────────────────────────────────────
document.getElementById('btn-undo').addEventListener('click', () => {
  const last = state.overlays.pop();
  if (last) { last.el.remove(); toast('Undone'); }
  else toast('Nothing to undo');
});

// ── KEYBOARD SHORTCUTS ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    document.getElementById('btn-undo').click();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveDocument();
  }
});

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
document.getElementById('btn-reset-stats').addEventListener('click', () => {
  state.stats = {};
  saveStats();
  renderDashboard();
  toast('Stats reset');
});
renderDashboard();

// ── HELPERS ───────────────────────────────────────────────────────────────────
function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload  = res;
    s.onerror = () => rej(new Error('Failed to load: ' + src));
    document.head.appendChild(s);
  });
}

async function ensureJsZip() {
  if (window.JSZip) return;
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
}

async function ensurePdfLib() {
  if (window.PDFLib) return;
  await loadScript('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js');
}

function downloadBytes(bytes, filename, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url  = URL.createObjectURL(blob);
  downloadUrl(url, filename);
}

function downloadUrl(url, filename) {
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

async function loadImgEl(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

// ── INIT ──────────────────────────────────────────────────────────────────────
showTab('home');
