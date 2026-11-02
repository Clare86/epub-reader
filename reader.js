// Reader UI: library screen, TOC sidebar, chapter / whole-story views,
// automatic position saving and named bookmarks.
'use strict';

const $ = (id) => document.getElementById(id);
const LS_SETTINGS = 'epubReader.settings';
const LS_BOOK = 'epubReader.book.';
const THEMES = ['light', 'sepia', 'dark'];
const MAX_RECENT = 40;

// ---------- persistence ----------

function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('localStorage write failed', e); }
}

const settings = Object.assign({ mode: 'chapter', fontSize: 19, theme: 'light', sidebar: true, lastKey: null },
  lsGet(LS_SETTINGS, {}));
const saveSettings = () => lsSet(LS_SETTINGS, settings);

// Recently opened files are kept in IndexedDB so a book can be reopened
// without picking it again. They never leave the browser.
const idb = {
  _db: null,
  open() {
    if (this._db) return this._db;
    this._db = new Promise((resolve, reject) => {
      const req = indexedDB.open('epub-reader', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'key' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this._db;
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('files', mode);
      const req = fn(t.objectStore('files'));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
    });
  },
  put(rec) { return this.tx('readwrite', s => s.put(rec)); },
  get(key) { return this.tx('readonly', s => s.get(key)); },
  del(key) { return this.tx('readwrite', s => s.delete(key)); },
  all() { return this.tx('readonly', s => s.getAll()); },
  keys() { return this.tx('readonly', s => s.getAllKeys()); },
};

// ---------- state ----------

const state = {
  book: null,
  data: null,        // {title, author, pos, bookmarks}
  chapter: 0,        // chapter shown in chapter mode
  rendered: null,    // 'chapter' | 'whole'
  pos: null,         // last computed {ch, p}
  tocLinks: [],      // [{a, spineIndex, depth}] in document order
  words: null,       // word count per spine item, once counted
};

const scroller = $('scroller');
const content = $('content');

// ---------- library ----------

function showError(msg) {
  const el = $('open-error');
  el.textContent = msg;
  el.hidden = !msg;
}

// ---------- history ----------

// Every book ever opened has an entry in localStorage (position, bookmarks,
// when it was last opened), so the history is built from those. Only the
// most recent MAX_RECENT files are kept in IndexedDB; older entries need
// the file picking again to reopen.
function historyEntries() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(LS_BOOK)) continue;
    const data = lsGet(k, null);
    if (!data || data.hidden || !data.title) continue;
    out.push({ key: k.slice(LS_BOOK.length), data, opened: data.opened || (data.pos && data.pos.at) || 0 });
  }
  return out.sort((a, b) => b.opened - a.opened);
}

function formatWhen(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

async function renderHistory(ul, filter = '') {
  let stored = new Set();
  try { stored = new Set(await idb.keys()); } catch (e) { console.warn(e); }
  const q = filter.trim().toLowerCase();
  const all = historyEntries();
  const items = q ? all.filter(h => `${h.data.title} ${h.data.author}`.toLowerCase().includes(q)) : all;
  ul.textContent = '';
  for (const h of items) {
    const { data } = h;
    const li = document.createElement('li');
    if (state.book && state.book.key === h.key) li.classList.add('current');
    const main = document.createElement('div');
    main.className = 'r-main';
    const bits = [data.author || 'Unknown author', formatWhen(h.opened)];
    if (data.pos && data.pos.pct != null) bits.push(`${Math.round(data.pos.pct * 100)}% read`);
    const n = data.bookmarks ? data.bookmarks.length : 0;
    if (n) bits.push(`${n} bookmark${n > 1 ? 's' : ''}`);
    if (!stored.has(h.key)) bits.push('pick file to reopen');
    main.innerHTML = '<div class="r-title"></div><div class="r-sub"></div>';
    main.firstChild.textContent = data.title;
    main.lastChild.textContent = bits.filter(Boolean).join(' · ');
    main.title = data.fileName ? `File: ${data.fileName}` : '';
    main.addEventListener('click', () => openRecord(h.key));
    const rm = document.createElement('button');
    rm.textContent = 'Forget';
    rm.title = 'Remove from history. Your position and bookmarks come back if you open the book again.';
    rm.addEventListener('click', async () => {
      lsSet(LS_BOOK + h.key, Object.assign(data, { hidden: true }));
      await idb.del(h.key).catch(() => {});
      renderHistory(ul, filter);
    });
    li.append(main);
    if (!li.classList.contains('current')) li.append(rm);
    ul.append(li);
  }
  return all.length;
}

async function refreshRecent() {
  const total = await renderHistory($('recent'), $('recent-filter').value);
  $('recent-wrap').hidden = total === 0;
  $('recent-filter').hidden = total < 8;
}

async function openRecord(key) {
  if (state.book && state.book.key === key) return;
  const rec = await idb.get(key).catch(() => null);
  if (rec) { await openFile(rec.file, rec.name); return; }
  const data = lsGet(LS_BOOK + key, {});
  const msg = `“${data.title || 'That book'}” isn't stored in the browser any more. Choose ${data.fileName ? `“${data.fileName}”` : 'its file'} to reopen it; your place is kept.`;
  showError(msg);
  if (state.book) toast(msg);
  $('file-input').click();
}

async function openFile(file, name) {
  showError('');
  let book;
  try {
    book = await EpubBook.open(file);
  } catch (e) {
    console.error(e);
    const msg = `Could not open ${name || file.name || 'that file'}: ${e.message}`;
    showError(msg);
    if (state.book) toast(msg);
    return;
  }
  if (state.book) closeBook({ keepLast: true });
  state.book = book;
  state.file = file;
  window.currentBook = book; // handy for debugging in the console

  const author = book.meta.authors.join(', ');
  state.data = Object.assign({ bookmarks: [], pos: null }, lsGet(LS_BOOK + book.key, {}),
    { title: book.meta.title, author, opened: Date.now(), fileName: name || file.name || '' });
  delete state.data.hidden;
  persistBook();

  settings.lastKey = book.key;
  saveSettings();
  try {
    await idb.put({ key: book.key, title: book.meta.title, author, file, name: name || file.name || '', size: file.size, opened: Date.now() });
    // Keep only the most recent files; older books stay in the history.
    const recs = await idb.all();
    recs.sort((a, b) => b.opened - a.opened).slice(MAX_RECENT).forEach(r => idb.del(r.key));
  } catch (e) { console.warn('Could not store file in IndexedDB', e); }

  document.title = `${book.meta.title} – EPUB Reader`;
  $('book-title').textContent = book.meta.title;
  $('book-author').textContent = author;
  $('library').hidden = true;
  $('reader').hidden = false;
  state.words = null;
  buildToc();
  renderBookmarks();
  if (!$('hist-panel').hidden) renderHistory($('hist-list'), $('hist-filter').value);

  const pos = state.data.pos;
  await show(settings.mode, pos ? { ch: pos.ch, p: pos.p } : { ch: 0, p: 0 });
  if (pos && (pos.ch || pos.p)) toast(`Resumed at ${book.spine[pos.ch] ? book.spine[pos.ch].title : 'saved position'}`);
  countChapterWords();
}

function closeBook({ keepLast = false } = {}) {
  if (!state.book) return;
  savePosition();
  for (const p of state.book._imageUrls.values()) p.then(u => u && URL.revokeObjectURL(u));
  state.book = null;
  state.data = null;
  state.rendered = null;
  content.textContent = '';
  if (!keepLast) {
    settings.lastKey = null;
    saveSettings();
    document.title = 'EPUB Reader';
    $('reader').hidden = true;
    $('library').hidden = false;
    refreshRecent();
  }
}

function persistBook() {
  if (state.book) lsSet(LS_BOOK + state.book.key, state.data);
}

// ---------- backup ----------

// Reading data (settings, positions, bookmarks, history) can be saved to a
// JSON file and restored, e.g. after clearing site data. The stored EPUB
// files themselves aren't included; after a restore they're picked again.
const BACKUP_APP = 'epub-reader';

function exportData() {
  savePosition();
  const books = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(LS_BOOK)) { const d = lsGet(k, null); if (d) books[k.slice(LS_BOOK.length)] = d; }
  }
  const { lastKey, ...prefs } = settings;
  const json = JSON.stringify({ app: BACKUP_APP, version: 1, exported: new Date().toISOString(), settings: prefs, books }, null, 1);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = `epub-reader-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  const n = Object.keys(books).length;
  backupMessage(`Exported ${n} book${n === 1 ? '' : 's'}.`);
}

// Combine a book's saved data with the same book's data from a backup:
// the newer position wins, and bookmarks from both are kept.
function mergeBook(local, incoming) {
  if (!local) return incoming;
  const newer = (incoming.opened || 0) > (local.opened || 0) ? incoming : local;
  const out = Object.assign({}, newer === local ? incoming : local, newer);
  const at = (d) => (d.pos && d.pos.at) || 0;
  out.pos = at(incoming) > at(local) ? incoming.pos : local.pos;
  const marks = new Map();
  for (const b of [...(incoming.bookmarks || []), ...(local.bookmarks || [])]) if (b && b.id && !marks.has(b.id)) marks.set(b.id, b);
  for (const b of newer.bookmarks || []) if (b && b.id) marks.set(b.id, b); // keep the newer rename
  out.bookmarks = [...marks.values()].sort((a, b) => a.ch - b.ch || a.p - b.p);
  return out;
}

async function importData(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (_) { data = null; }
  if (!data || data.app !== BACKUP_APP || !data.books || typeof data.books !== 'object') {
    backupMessage(`${file.name} isn't an EPUB Reader backup.`, true);
    return;
  }
  let books = 0, marks = 0;
  for (const [key, incoming] of Object.entries(data.books)) {
    if (!incoming || typeof incoming !== 'object') continue;
    const current = state.book && state.book.key === key;
    const merged = mergeBook(current ? state.data : lsGet(LS_BOOK + key, null), incoming);
    lsSet(LS_BOOK + key, merged);
    if (current) { state.data = merged; renderBookmarks(); }
    books++;
    marks += (incoming.bookmarks || []).length;
  }
  if (data.settings && typeof data.settings === 'object') {
    const { lastKey, ...prefs } = data.settings;
    Object.assign(settings, prefs);
    saveSettings();
    applyAppearance();
    setSidebar(settings.sidebar);
  }
  refreshRecent();
  if (!$('hist-panel').hidden) renderHistory($('hist-list'), $('hist-filter').value);
  let stored = new Set();
  try { stored = new Set(await idb.keys()); } catch (_) {}
  const missing = Object.keys(data.books).some(k => !stored.has(k));
  backupMessage(`Restored ${books} book${books === 1 ? '' : 's'} and ${marks} bookmark${marks === 1 ? '' : 's'}.` +
    (missing ? ' Books marked “pick file to reopen” need their file choosing once.' : ''));
}

function backupMessage(msg, isError = false) {
  if (state.book) { toast(msg); return; }
  const el = $('backup-msg');
  el.textContent = msg;
  el.className = isError ? 'error' : '';
  el.hidden = false;
}

// ---------- TOC ----------

function buildToc() {
  const nav = $('toc');
  nav.textContent = '';
  state.tocLinks = [];
  const build = (items, depth) => {
    const ol = document.createElement('ol');
    for (const t of items) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      const label = document.createElement('span');
      label.className = 'toc-label';
      label.textContent = t.label;
      a.append(label);
      a.href = '#';
      if (t.spineIndex < 0) a.classList.add('dead');
      a.addEventListener('click', (e) => {
        e.preventDefault();
        if (t.spineIndex < 0) return;
        goTo({ ch: t.spineIndex, id: t.frag ? `c${t.spineIndex}-${t.frag}` : null });
        if (window.matchMedia('(max-width: 760px)').matches) setSidebar(false);
      });
      li.append(a);
      state.tocLinks.push({ a, spineIndex: t.spineIndex, depth });
      if (t.children.length) li.append(build(t.children, depth + 1));
      ol.append(li);
    }
    return ol;
  };
  nav.append(build(state.book.toc, 0));
}

// Counts the words in every spine item, then labels each contents entry
// with the words from its file up to the next entry at the same or a
// higher level (so a part's count includes its chapters). Entries that
// share a file with a sibling (anchors within one file) get no count,
// since the file can't be split between them.
async function countChapterWords() {
  const book = state.book;
  const parts = await Promise.all(book.spine.map((_, i) => book.chapterHtml(i)));
  if (state.book !== book) return;
  state.words = parts.map(c => c.words);
  const links = state.tocLinks;
  links.forEach((l, i) => {
    const s = l.spineIndex;
    if (s < 0) return;
    let end = book.spine.length;
    for (let j = i + 1; j < links.length; j++) {
      const o = links[j];
      if (o.depth > l.depth || o.spineIndex < 0) continue;
      if (o.spineIndex === s) { if (o.depth === l.depth) return; continue; }
      if (o.spineIndex > s) { end = o.spineIndex; break; }
    }
    if (links.some((o, j) => j < i && o.depth === l.depth && o.spineIndex === s)) return;
    const words = state.words.slice(s, end).reduce((a, b) => a + b, 0);
    if (!words) return;
    const span = document.createElement('span');
    span.className = 'toc-words';
    span.textContent = words.toLocaleString();
    span.title = `${words.toLocaleString()} words`;
    l.a.append(span);
  });
  if (state.rendered === 'chapter') updateChapterNav();
}

function highlightToc(ch) {
  let best = null;
  for (const l of state.tocLinks) {
    if (l.spineIndex === ch) { best = l; break; }
    if (l.spineIndex >= 0 && l.spineIndex < ch && (!best || l.spineIndex >= best.spineIndex)) best = l;
  }
  for (const l of state.tocLinks) l.a.classList.toggle('current', l === best);
  if (best && !$('toc').hidden) {
    const r = best.a.getBoundingClientRect(), pr = $('toc').getBoundingClientRect();
    if (r.top < pr.top || r.bottom > pr.bottom) best.a.scrollIntoView({ block: 'center' });
  }
}

// ---------- rendering ----------

function sectionHtml(i, html) {
  return `<section class="chapter" data-ch="${i}">${html}</section>`;
}

async function show(mode, target) {
  const book = state.book;
  settings.mode = mode;
  saveSettings();
  $('mode-chapter').classList.toggle('active', mode === 'chapter');
  $('mode-whole').classList.toggle('active', mode === 'whole');
  $('chapter-nav').hidden = mode !== 'chapter';

  if (mode === 'whole') {
    if (state.rendered !== 'whole') {
      setStatus('Loading whole story…');
      const parts = await Promise.all(book.spine.map((_, i) => book.chapterHtml(i)));
      if (state.book !== book) return;
      content.innerHTML = parts.map((c, i) => sectionHtml(i, c.html)).join('');
      state.rendered = 'whole';
    }
  } else {
    const ch = clamp(target.ch, 0, book.spine.length - 1);
    if (state.rendered !== 'chapter' || state.chapter !== ch) {
      const c = await book.chapterHtml(ch);
      if (state.book !== book) return;
      content.innerHTML = sectionHtml(ch, c.html);
      state.rendered = 'chapter';
      state.chapter = ch;
      updateChapterNav();
      // Warm the cache for the next chapter.
      if (ch + 1 < book.spine.length) book.chapterHtml(ch + 1);
    }
  }
  scrollToTarget(target);
  onScroll();
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v | 0)); }

function scrollToTarget({ ch, p, id }) {
  const section = content.querySelector(`.chapter[data-ch="${ch}"]`);
  if (!section) return;
  let el = id ? document.getElementById(id) : null;
  if (!el && p) el = section.querySelector(`[data-p="${p}"]`);
  if (!el) el = section;
  const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  scroller.scrollTop = el === section && state.rendered === 'chapter' ? 0 : Math.max(0, top - 12);
  return el;
}

async function goTo(target, { flash = false } = {}) {
  await show(settings.mode, target);
  if (flash) {
    const section = content.querySelector(`.chapter[data-ch="${target.ch}"]`);
    const el = section && (target.id ? document.getElementById(target.id) : section.querySelector(`[data-p="${target.p}"]`));
    if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  }
}

function updateChapterNav() {
  const n = state.book.spine.length;
  $('btn-prev').disabled = state.chapter <= 0;
  $('btn-next').disabled = state.chapter >= n - 1;
  const words = state.words && state.words[state.chapter];
  $('chapter-label').textContent = `${state.chapter + 1} / ${n}` + (words ? ` · ${words.toLocaleString()} words` : '');
}

// ---------- position tracking ----------

// Finds the paragraph at the top of the reading area.
function currentPosition() {
  const r = scroller.getBoundingClientRect();
  const cr = content.getBoundingClientRect();
  const x = Math.max(cr.left, r.left) + Math.min(cr.width, r.width) / 2;
  let firstSection = null;
  for (let dy = 6; dy < r.height; dy += 10) {
    const hit = document.elementFromPoint(x, r.top + dy);
    if (!hit || !content.contains(hit)) continue;
    const section = hit.closest('.chapter');
    if (!section) continue;
    // Gaps between paragraphs hit the container; keep probing downwards,
    // but not past the start of the next chapter.
    if (firstSection && section !== firstSection) break;
    firstSection = section;
    const pEl = hit.closest('[data-p]');
    if (pEl) return { ch: +section.dataset.ch, p: +pEl.dataset.p, el: pEl };
  }
  if (firstSection) return { ch: +firstSection.dataset.ch, p: 0, el: null };
  // Fallback: first section whose bottom is below the top of the viewport.
  for (const s of content.querySelectorAll('.chapter')) {
    if (s.getBoundingClientRect().bottom > r.top) return { ch: +s.dataset.ch, p: 0, el: null };
  }
  return null;
}

function progressFraction(pos) {
  if (state.rendered === 'whole') {
    const max = scroller.scrollHeight - scroller.clientHeight;
    return max > 0 ? scroller.scrollTop / max : 1;
  }
  const max = scroller.scrollHeight - scroller.clientHeight;
  const within = max > 0 ? scroller.scrollTop / max : 1;
  return (pos.ch + within) / state.book.spine.length;
}

let scrollQueued = false, saveTimer = null;
function onScroll() {
  if (scrollQueued || !state.book) return;
  scrollQueued = true;
  setTimeout(() => {
    scrollQueued = false;
    if (!state.book) return;
    const pos = currentPosition();
    if (!pos) return;
    pos.pct = progressFraction(pos);
    state.pos = pos;
    $('progress-bar').style.width = `${(pos.pct * 100).toFixed(2)}%`;
    const title = state.book.spine[pos.ch].title;
    setStatus(`${title} · ${Math.round(pos.pct * 100)}%`);
    highlightToc(pos.ch);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(savePosition, 400);
  }, 60);
}

function savePosition() {
  clearTimeout(saveTimer);
  if (!state.book || !state.pos) return;
  const { ch, p, pct } = state.pos;
  state.data.pos = { ch, p, pct, at: Date.now() };
  persistBook();
}

function setStatus(t) { $('status').textContent = t ? `· ${t}` : ''; }

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

// ---------- bookmarks ----------

function addBookmark(name) {
  const pos = currentPosition();
  if (!pos) return;
  const chTitle = state.book.spine[pos.ch].title;
  const snippet = pos.el ? pos.el.textContent.replace(/\s+/g, ' ').trim().slice(0, 140) : '';
  state.data.bookmarks.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: (name || '').trim() || chTitle,
    ch: pos.ch, p: pos.p, snippet, created: Date.now(),
  });
  state.data.bookmarks.sort((a, b) => a.ch - b.ch || a.p - b.p);
  persistBook();
  renderBookmarks();
  toast('Bookmark added');
}

function renderBookmarks() {
  const list = $('bm-list');
  list.textContent = '';
  const bms = state.data.bookmarks;
  $('bm-count').textContent = bms.length ? `(${bms.length})` : '';
  $('bm-empty').hidden = bms.length > 0;
  for (const bm of bms) {
    const li = document.createElement('li');
    const main = document.createElement('div');
    main.className = 'bm-main';
    const nameEl = document.createElement('div');
    nameEl.className = 'bm-name';
    nameEl.textContent = bm.name;
    const where = document.createElement('div');
    where.className = 'bm-where';
    const ch = state.book.spine[bm.ch];
    where.textContent = ch ? ch.title : `Section ${bm.ch + 1}`;
    main.append(nameEl, where);
    if (bm.snippet) {
      const sn = document.createElement('div');
      sn.className = 'bm-snippet';
      sn.textContent = `“${bm.snippet}”`;
      main.append(sn);
    }
    main.addEventListener('click', () => {
      goTo({ ch: bm.ch, p: bm.p }, { flash: true });
      if (window.matchMedia('(max-width: 760px)').matches) setSidebar(false);
    });

    const rename = document.createElement('button');
    rename.textContent = 'Rename';
    rename.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = bm.name;
      nameEl.replaceWith(input);
      input.focus();
      input.select();
      const done = (commit) => {
        if (commit && input.value.trim()) { bm.name = input.value.trim(); persistBook(); }
        renderBookmarks();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') done(true);
        else if (e.key === 'Escape') done(false);
        e.stopPropagation();
      });
      input.addEventListener('blur', () => done(true));
      input.addEventListener('click', (e) => e.stopPropagation());
    });
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.addEventListener('click', () => {
      state.data.bookmarks = state.data.bookmarks.filter(b => b !== bm);
      persistBook();
      renderBookmarks();
    });
    li.append(main, rename, del);
    list.append(li);
  }
}

// ---------- about this book ----------

const ABOUT_ORDER = ['Summary', 'Series', 'Number in series', 'Author', 'Fandom', 'Relationships', 'Ship Type',
  'Characters', 'Additional Tags', 'Tags', 'Rating', 'My Rating', 'Status', 'Reading Status', 'Chapters', 'Words', 'Length',
  'Published', 'Date', 'Updated', 'Modified', 'Language', 'Source', 'Story URL'];

function languageName(code) {
  try { return new Intl.DisplayNames(undefined, { type: 'language' }).of(code) || code; } catch (_) { return code; }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function aboutRow(dl, label, build) {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  build(dd);
  dl.append(dt, dd);
}

async function openAbout() {
  const book = state.book;
  if (!book) return;
  $('about-title').textContent = book.meta.title;
  $('about-author').textContent = book.meta.authors.join(', ');

  const cover = $('about-cover');
  cover.hidden = true;
  if (book.coverPath) book._imageUrl(book.coverPath).then(url => { if (url) { cover.src = url; cover.hidden = false; } });

  const dl = $('about-fields');
  dl.textContent = '';
  // Title and author are already in the heading; show the summary first.
  const fields = book.metadataFields().filter(f => f.label !== 'Title' && !(f.label === 'Author' && f.values.join(', ') === book.meta.authors.join(', ')));
  // Story details first, technical identifiers last; others keep their file order.
  const rank = (f) => {
    const i = ABOUT_ORDER.indexOf(f.label);
    if (i >= 0) return i;
    return /identifier|sort|made with|contributor|publisher|file created/i.test(f.label) ? 1000 : 500;
  };
  fields.sort((a, b) => rank(a) - rank(b));
  for (const f of fields) {
    if (f.label === 'Language') f.values = f.values.map(languageName);
    if (f.label === 'Number in series') f.values = f.values.map(v => String(parseFloat(v) || v));
  }
  for (const f of fields) {
    aboutRow(dl, f.label, (dd) => {
      if (f.kind === 'tags') {
        dd.className = 'tags';
        for (const v of f.values) {
          const span = document.createElement('span');
          span.className = 'tag';
          span.textContent = v;
          dd.append(span);
        }
      } else if (f.kind === 'html') {
        dd.className = 'html';
        dd.innerHTML = f.values.map(sanitizeFragment).join('');
      } else if (f.kind === 'link') {
        f.values.forEach((v, i) => {
          const a = document.createElement('a');
          a.href = v;
          a.textContent = v;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          if (i) dd.append(document.createElement('br'));
          dd.append(a);
        });
      } else {
        dd.textContent = f.values.join(', ');
      }
    });
  }

  // Facts about the file itself.
  const fileFacts = [
    ['File', [state.data.fileName, state.file ? formatSize(state.file.size) : ''].filter(Boolean).join(' · ')],
    ['EPUB version', book.version],
    ['Contents entries', String(book.toc.length)],
    ['Saved under', book.key],
  ];
  for (const [label, value] of fileFacts) if (value) aboutRow(dl, label, dd => { dd.textContent = value; dd.classList.add('muted'); });

  const stats = $('about-stats');
  const n = book.spine.length;
  stats.textContent = `${n} section${n > 1 ? 's' : ''} · counting words…`;
  $('about').showModal();
  $('about').scrollTop = 0;
  const parts = await Promise.all(book.spine.map((_, i) => book.chapterHtml(i)));
  if (state.book !== book) return;
  const words = parts.reduce((sum, c) => sum + c.words, 0);
  stats.textContent = `${n} section${n > 1 ? 's' : ''} · ${words.toLocaleString()} words (counted here)`;
}

// ---------- chrome ----------

function setSidebar(open) {
  settings.sidebar = open;
  saveSettings();
  $('reader').classList.toggle('no-sidebar', !open);
}

function setTab(which) {
  $('tab-toc').classList.toggle('active', which === 'toc');
  $('tab-bm').classList.toggle('active', which === 'bm');
  $('tab-hist').classList.toggle('active', which === 'hist');
  $('toc').hidden = which !== 'toc';
  $('bm-panel').hidden = which !== 'bm';
  $('hist-panel').hidden = which !== 'hist';
  if (which === 'hist') renderHistory($('hist-list'), $('hist-filter').value);
  if (which === 'toc' && state.pos) highlightToc(state.pos.ch);
}

function applyAppearance() {
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.style.setProperty('--font-size', settings.fontSize + 'px');
}

async function switchMode(mode) {
  if (!state.book || mode === state.rendered) return;
  const pos = currentPosition() || { ch: state.chapter, p: 0 };
  await show(mode, { ch: pos.ch, p: pos.p });
}

async function stepChapter(delta) {
  if (!state.book) return;
  const ch = (state.rendered === 'chapter' ? state.chapter : (state.pos ? state.pos.ch : 0)) + delta;
  if (ch < 0 || ch >= state.book.spine.length) return;
  await goTo({ ch, p: 0 });
}

// ---------- wiring ----------

$('file-input').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) openFile(f);
  e.target.value = '';
});
$('dropzone').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file-input').click(); }
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
  dragDepth++;
  $('drop-overlay').hidden = false;
});
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop-overlay').hidden = true; } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('drop-overlay').hidden = true;
  const f = Array.from(e.dataTransfer.files).find(f => /\.epub$/i.test(f.name)) || e.dataTransfer.files[0];
  if (f) openFile(f);
});

$('btn-sidebar').addEventListener('click', () => setSidebar(!settings.sidebar));
$('mode-chapter').addEventListener('click', () => switchMode('chapter'));
$('mode-whole').addEventListener('click', () => switchMode('whole'));
$('btn-prev').addEventListener('click', () => stepChapter(-1));
$('btn-next').addEventListener('click', () => stepChapter(1));
$('btn-close').addEventListener('click', () => closeBook());
$('btn-open').addEventListener('click', () => $('file-input').click());
$('btn-about').addEventListener('click', openAbout);
$('about-close').addEventListener('click', () => $('about').close());
// Clicking the dimmed backdrop (outside the dialog box) closes it.
$('about').addEventListener('click', (e) => { if (e.target === $('about')) $('about').close(); });
$('btn-bookmark').addEventListener('click', () => {
  addBookmark('');
  setSidebar(true);
  setTab('bm');
});
$('bm-form').addEventListener('submit', (e) => {
  e.preventDefault();
  addBookmark($('bm-name').value);
  $('bm-name').value = '';
});
$('tab-toc').addEventListener('click', () => setTab('toc'));
$('tab-bm').addEventListener('click', () => setTab('bm'));
$('tab-hist').addEventListener('click', () => setTab('hist'));
$('hist-filter').addEventListener('input', () => renderHistory($('hist-list'), $('hist-filter').value));
$('recent-filter').addEventListener('input', refreshRecent);
document.querySelectorAll('.btn-export').forEach(b => b.addEventListener('click', exportData));
document.querySelectorAll('.btn-import').forEach(b => b.addEventListener('click', () => $('import-input').click()));
$('import-input').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) importData(f);
  e.target.value = '';
});
$('btn-font-up').addEventListener('click', () => { settings.fontSize = Math.min(32, settings.fontSize + 1); keepPlace(); });
$('btn-font-down').addEventListener('click', () => { settings.fontSize = Math.max(12, settings.fontSize - 1); keepPlace(); });
$('btn-theme').addEventListener('click', () => {
  settings.theme = THEMES[(THEMES.indexOf(settings.theme) + 1) % THEMES.length];
  saveSettings();
  applyAppearance();
});

// Changing the font size reflows everything, so re-anchor on the same paragraph.
function keepPlace() {
  const pos = currentPosition();
  saveSettings();
  applyAppearance();
  if (pos) scrollToTarget(pos);
}

scroller.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', onScroll);

content.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-target]');
  if (!a) return;
  e.preventDefault();
  const [ch, frag] = a.dataset.target.split('#');
  goTo({ ch: +ch, id: frag ? `c${ch}-${frag}` : null }, { flash: true });
});

document.addEventListener('keydown', (e) => {
  if (!state.book || e.metaKey || e.ctrlKey || e.altKey || $('about').open) return;
  if (e.target.closest && e.target.closest('input, textarea')) return;
  if (e.key === 'ArrowRight' && state.rendered === 'chapter') stepChapter(1);
  else if (e.key === 'ArrowLeft' && state.rendered === 'chapter') stepChapter(-1);
  else if (e.key === 'b') $('btn-bookmark').click();
  else if (e.key === 't') setSidebar(!settings.sidebar);
  else if (e.key === 'o') $('file-input').click();
  else if (e.key === 'i' && !$('about').open) openAbout();
  else return;
  e.preventDefault();
});

window.addEventListener('pagehide', savePosition);
document.addEventListener('visibilitychange', () => { if (document.hidden) savePosition(); });

// ---------- start ----------

applyAppearance();
setSidebar(settings.sidebar);
refreshRecent();
if (settings.lastKey) {
  // Reopen the book that was open when the tab was closed.
  idb.get(settings.lastKey).then(rec => rec && openFile(rec.file, rec.name)).catch(() => {});
}
