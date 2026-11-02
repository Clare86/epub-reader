// EPUB 2/3 parsing: metadata, spine, table of contents (nav or NCX) and
// sanitised chapter HTML ready to drop into the page.
'use strict';

const NS = {
  dc: 'http://purl.org/dc/elements/1.1/',
  opf: 'http://www.idpf.org/2007/opf',
  epub: 'http://www.idpf.org/2007/ops',
  xlink: 'http://www.w3.org/1999/xlink',
};

const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp',
};

// Elements that are dropped from chapter content entirely.
const STRIP_TAGS = new Set(['script', 'style', 'link', 'meta', 'iframe', 'object', 'embed',
  'form', 'input', 'button', 'textarea', 'select', 'base', 'frame', 'frameset', 'noscript', 'title', 'head']);

// Attributes that make the browser fetch a URL on their own (no click needed).
const REMOTE_ATTRS = new Set(['src', 'poster', 'background', 'data', 'srcdoc', 'ping']);

// Elements that count as a "paragraph" for saving reading position.
const POS_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,blockquote:not(:has(p)),pre,hr,img,svg,table,dt,dd,div:not(:has(p,div,h1,h2,h3,h4,h5,h6,blockquote,ul,ol,table))';

function dirOf(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i + 1);
}

// Resolve an href relative to the file at basePath, returning [path, fragment].
function resolveHref(basePath, href) {
  let frag = '';
  const hash = href.indexOf('#');
  if (hash >= 0) { frag = href.slice(hash + 1); href = href.slice(0, hash); }
  try { href = decodeURIComponent(href); } catch (_) { /* keep as-is */ }
  try { frag = decodeURIComponent(frag); } catch (_) { /* keep as-is */ }
  if (!href) return [basePath, frag];
  const parts = (href.startsWith('/') ? href.slice(1) : dirOf(basePath) + href).split('/');
  const out = [];
  for (const part of parts) {
    if (part === '..') out.pop();
    else if (part !== '.' && part !== '') out.push(part);
  }
  return [out.join('/'), frag];
}

function isExternal(href) {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

function parseXml(text, type = 'application/xhtml+xml') {
  const doc = new DOMParser().parseFromString(text, type);
  if (doc.getElementsByTagName('parsererror').length) {
    // Fall back to the forgiving HTML parser for malformed XHTML.
    return new DOMParser().parseFromString(text, 'text/html');
  }
  return doc;
}

function cleanText(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

const DC_LABELS = {
  title: 'Title', publisher: 'Publisher', language: 'Language', source: 'Source', rights: 'Rights',
  type: 'Type', format: 'Format', relation: 'Relation', coverage: 'Coverage',
};
const ROLE_LABELS = {
  aut: 'Author', edt: 'Editor', ill: 'Illustrator', trl: 'Translator', bkp: 'Made with', nrt: 'Narrator',
};
const DATE_LABELS = { publication: 'Published', creation: 'File created', modification: 'Modified' };
const CALIBRE_LABELS = {
  'calibre:series': 'Series', 'calibre:series_index': 'Number in series',
  'calibre:title_sort': 'Title (sort)', 'calibre:author_sort': 'Author (sort)',
};

const DCTERMS_LABELS = {
  'dcterms:date': 'Published', 'dcterms:issued': 'Published', 'dcterms:created': 'File created',
  'dcterms:modified': 'Modified', 'dcterms:extent': 'Length',
};
// Internal bookkeeping that isn't useful to a reader.
const HIDDEN_META = new Set(['cover', 'calibre:link_maps']);

function formatDate(s) {
  const d = new Date(s);
  if (!s || isNaN(d)) return s;
  // Dates without a time are midnight UTC; show them as that calendar day.
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function stars(v) {
  const n = Math.round(Number(v) / 2); // calibre stores ratings out of 10
  return n > 0 ? '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n)) : '';
}

// calibre custom columns are stored as JSON describing the column and its value
// (a string in EPUB 2, already-parsed objects inside the EPUB 3 combined form).
function addCalibreColumn(add, key, json) {
  let col = json;
  if (typeof col === 'string') { try { col = JSON.parse(col); } catch (_) { return; } }
  if (!col || typeof col !== 'object') return;
  const label = col.name || key;
  const v = col['#value#'];
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return;
  if (Array.isArray(v)) v.forEach(x => add(label, x, 'tags'));
  else if (col.datatype === 'comments') add(label, v, 'html');
  else if (col.datatype === 'datetime') add(label, formatDate(v.__value__ || v));
  else if (col.datatype === 'rating') add(label, stars(v));
  else if (col.datatype === 'bool') add(label, v ? 'Yes' : 'No');
  else if (typeof v === 'number') add(label, v.toLocaleString());
  else add(label, v);
}

// Cleans an HTML snippet from metadata (e.g. an AO3 summary) for display:
// no scripts, styles, images or event handlers; external links open in a new tab.
function sanitizeFragment(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.body;
  for (const tag of STRIP_TAGS) root.querySelectorAll(tag).forEach(el => el.remove());
  root.querySelectorAll('img, picture, video, audio, source, svg').forEach(el => el.remove());
  for (const el of root.querySelectorAll('*')) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name !== 'href') el.removeAttribute(attr.name);
    }
    if (el.localName === 'a') {
      if (/^https?:\/\//i.test(el.getAttribute('href') || '')) {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      } else {
        el.removeAttribute('href');
      }
    } else {
      el.removeAttribute('href');
    }
  }
  return root.innerHTML;
}

class EpubBook {
  static async open(blob) {
    const book = new EpubBook(await ZipArchive.open(blob));
    await book._load();
    return book;
  }

  constructor(zip) {
    this.zip = zip;
    this.meta = {};
    this.spine = [];          // [{path, title}]
    this.toc = [];            // [{label, path, frag, spineIndex, children}]
    this._spineByPath = new Map();
    this._htmlCache = new Map();
    this._imageUrls = new Map();
  }

  async _load() {
    const container = parseXml(await this.zip.text('META-INF/container.xml'), 'application/xml');
    const rootfile = container.querySelector('rootfile');
    if (!rootfile) throw new Error('EPUB has no rootfile in container.xml.');
    this.opfPath = rootfile.getAttribute('full-path');
    const opf = parseXml(await this.zip.text(this.opfPath), 'application/xml');

    // Metadata
    const dc = (name) => Array.from(opf.getElementsByTagNameNS(NS.dc, name)).map(e => cleanText(e.textContent)).filter(Boolean);
    this.meta.title = dc('title')[0] || 'Untitled';
    this.meta.authors = dc('creator');
    const pkg = opf.documentElement;
    const uidId = pkg.getAttribute('unique-identifier');
    const ids = Array.from(opf.getElementsByTagNameNS(NS.dc, 'identifier'));
    const uidEl = ids.find(e => e.getAttribute('id') === uidId) || ids[0];
    this.meta.identifier = uidEl ? cleanText(uidEl.textContent) : '';
    // Prefer the source URL (e.g. an AO3 work link) when there is one: it stays
    // the same if the story is re-downloaded or re-exported.
    const source = dc('source')[0] || ids.map(e => cleanText(e.textContent)).find(v => /^https?:\/\//.test(v)) || '';
    this.meta.source = source;
    this.key = source || this.meta.identifier || (this.meta.title + '|' + this.meta.authors.join(', '));

    this._opf = opf;
    this.version = pkg.getAttribute('version') || '';

    // Manifest
    const manifest = new Map();
    let navHref = null, ncxHref = null;
    for (const item of opf.querySelectorAll('manifest > item')) {
      const id = item.getAttribute('id');
      const href = item.getAttribute('href');
      const [path] = resolveHref(this.opfPath, href);
      const entry = { id, path, type: item.getAttribute('media-type') || '', props: item.getAttribute('properties') || '' };
      manifest.set(id, entry);
      if (/\bnav\b/.test(entry.props)) navHref = path;
      if (entry.type === 'application/x-dtbncx+xml') ncxHref = path;
    }
    // Cover image: EPUB 3 "cover-image" property, or EPUB 2 <meta name="cover">.
    const coverMeta = opf.querySelector('metadata meta[name="cover"]');
    const coverItem = Array.from(manifest.values()).find(m => /\bcover-image\b/.test(m.props))
      || (coverMeta && manifest.get(coverMeta.getAttribute('content')));
    this.coverPath = coverItem && /^image\//.test(coverItem.type) && this.zip.has(coverItem.path) ? coverItem.path : null;

    const spineEl = opf.querySelector('spine');
    const tocId = spineEl && spineEl.getAttribute('toc');
    if (tocId && manifest.has(tocId)) ncxHref = manifest.get(tocId).path;

    // Spine
    for (const ref of opf.querySelectorAll('spine > itemref')) {
      const item = manifest.get(ref.getAttribute('idref'));
      if (!item || !this.zip.has(item.path)) continue;
      if (!/html|xml/.test(item.type)) continue;
      this._spineByPath.set(item.path, this.spine.length);
      this.spine.push({ path: item.path, title: '' });
    }
    if (!this.spine.length) throw new Error('EPUB has no readable chapters.');

    // Table of contents: EPUB 3 nav first, NCX as fallback.
    if (navHref && this.zip.has(navHref)) {
      try { this.toc = await this._parseNav(navHref); } catch (e) { console.warn('nav parse failed', e); }
    }
    if (!this.toc.length && ncxHref && this.zip.has(ncxHref)) {
      try { this.toc = await this._parseNcx(ncxHref); } catch (e) { console.warn('NCX parse failed', e); }
    }

    // Give every spine item a title, from the TOC or its own <title>/heading.
    const walk = (items) => {
      for (const t of items) {
        if (t.spineIndex >= 0 && !this.spine[t.spineIndex].title) this.spine[t.spineIndex].title = t.label;
        walk(t.children);
      }
    };
    walk(this.toc);
    if (!this.toc.length) {
      this.toc = this.spine.map((s, i) => ({ label: `Section ${i + 1}`, path: s.path, frag: '', spineIndex: i, children: [] }));
    }
    // Untitled spine items: front matter (e.g. the cover) or continuations of
    // the previous TOC entry (calibre often splits long chapters into files).
    let prev = '';
    this.spine.forEach((s) => { if (!s.title) s.title = prev || 'Front matter'; prev = s.title; });
  }

  _tocEntry(label, base, href) {
    const [path, frag] = href ? resolveHref(base, href) : ['', ''];
    const spineIndex = this._spineByPath.has(path) ? this._spineByPath.get(path) : -1;
    return { label: cleanText(label) || 'Untitled', path, frag, spineIndex, children: [] };
  }

  async _parseNcx(path) {
    const doc = parseXml(await this.zip.text(path), 'application/xml');
    const build = (parent) => Array.from(parent.children)
      .filter(el => el.localName === 'navPoint')
      .map(np => {
        const label = np.querySelector('navLabel > text');
        const content = np.querySelector('content');
        const entry = this._tocEntry(label && label.textContent, path, content && content.getAttribute('src'));
        entry.children = build(np);
        return entry;
      });
    const navMap = doc.querySelector('navMap');
    return navMap ? build(navMap) : [];
  }

  async _parseNav(path) {
    const doc = parseXml(await this.zip.text(path));
    const navs = Array.from(doc.getElementsByTagName('nav'));
    const nav = navs.find(n => (n.getAttributeNS(NS.epub, 'type') || n.getAttribute('epub:type') || '').includes('toc')) || navs[0];
    if (!nav) return [];
    const build = (ol) => Array.from(ol.children)
      .filter(el => el.localName === 'li')
      .map(li => {
        const a = Array.from(li.children).find(el => el.localName === 'a' || el.localName === 'span');
        const entry = this._tocEntry(a && a.textContent, path, a && a.getAttribute('href'));
        const sub = Array.from(li.children).find(el => el.localName === 'ol' || el.localName === 'ul');
        if (sub) entry.children = build(sub);
        return entry;
      });
    const ol = Array.from(nav.children).find(el => el.localName === 'ol' || el.localName === 'ul');
    return ol ? build(ol) : [];
  }

  // Every metadata field in the OPF, as [{label, kind, values}], where kind is
  // 'text', 'link', 'tags' or 'html' (html values still need sanitizeFragment).
  // Includes calibre's own fields and custom columns (words, ship type, …).
  metadataFields() {
    const fields = new Map();
    const add = (label, value, kind = 'text') => {
      if (value == null) return;
      value = kind === 'html' ? String(value).trim() : cleanText(String(value));
      if (!value) return;
      if (kind === 'text' && /^https?:\/\/\S+$/.test(value)) kind = 'link';
      if (!fields.has(label)) fields.set(label, { label, kind, values: [] });
      const f = fields.get(label);
      if (!f.values.includes(value)) f.values.push(value);
    };
    const opfAttr = (el, name) => el.getAttributeNS(NS.opf, name) || el.getAttribute('opf:' + name) || '';

    const md = this._opf.querySelector('metadata');
    if (!md) return [];
    // Old OPF files nest fields in <dc-metadata>/<x-metadata>.
    const els = Array.from(md.children).flatMap(el => /^(dc|x)-metadata$/.test(el.localName) ? Array.from(el.children) : [el]);

    // EPUB 3 "refines" metas describe another element (its role, sort name, …)
    // rather than being fields themselves. Keep the roles; skip the rest.
    const refinedRoles = new Map();
    for (const el of els) {
      const target = el.localName === 'meta' && el.getAttribute('refines');
      if (target && el.getAttribute('property') === 'role') refinedRoles.set(target.replace(/^#/, ''), cleanText(el.textContent));
    }

    for (const el of els) {
      const text = el.textContent;
      if (el.namespaceURI === NS.dc) {
        const name = el.localName;
        if (name === 'creator' || name === 'contributor') {
          const role = ROLE_LABELS[opfAttr(el, 'role') || refinedRoles.get(el.getAttribute('id'))];
          add(role || (name === 'creator' ? 'Author' : 'Contributor'), text);
        } else if (name === 'date') {
          const event = opfAttr(el, 'event');
          // In EPUB a date with no event is the publication date.
          add(DATE_LABELS[event || 'publication'] || `Date (${event})`, formatDate(text));
        } else if (name === 'identifier') {
          let scheme = opfAttr(el, 'scheme');
          let value = cleanText(text);
          // EPUB 3 writes the scheme as a prefix instead, e.g. "calibre:684" or "url:https://…".
          const m = !scheme && value.match(/^([a-z][\w-]*):(?!\/\/)(.+)$/i);
          if (m && !/^(urn|https?)$/i.test(m[1])) { scheme = m[1]; value = m[2]; }
          add(scheme ? `Identifier (${scheme})` : 'Identifier', value);
        } else if (name === 'subject') {
          add('Tags', text, 'tags');
        } else if (name === 'description') {
          add('Summary', text, 'html');
        } else {
          add(DC_LABELS[name] || name, text);
        }
      } else if (el.localName === 'meta') {
        if (el.hasAttribute('refines')) continue;
        // EPUB 2 uses <meta name content>; EPUB 3 uses <meta property>value</meta>.
        const key = el.getAttribute('name') || el.getAttribute('property');
        const value = el.hasAttribute('name') ? el.getAttribute('content') : text;
        if (!key || HIDDEN_META.has(key)) continue;
        if (key.startsWith('calibre:user_metadata:')) {
          addCalibreColumn(add, key.slice('calibre:user_metadata:'.length), value);
        } else if (key === 'calibre:user_metadata') {
          // calibre's EPUB 3 form: one JSON object holding every custom column.
          let cols = null;
          try { cols = JSON.parse(value); } catch (_) { /* malformed: skip */ }
          if (cols && typeof cols === 'object') for (const [k, col] of Object.entries(cols)) addCalibreColumn(add, k, col);
        } else if (key === 'calibre:timestamp') {
          add('Added to calibre', formatDate(value));
        } else if (key === 'calibre:rating') {
          add('Rating', stars(value));
        } else if (DCTERMS_LABELS[key]) {
          add(DCTERMS_LABELS[key], /date|issued|modified|created/.test(key) ? formatDate(value) : value);
        } else {
          add(CALIBRE_LABELS[key] || key.replace(/^dcterms:/, ''), value);
        }
      }
    }
    return Array.from(fields.values());
  }

  spineIndexOf(path) {
    return this._spineByPath.has(path) ? this._spineByPath.get(path) : -1;
  }

  async _imageUrl(path) {
    if (!this._imageUrls.has(path)) {
      const ext = path.split('.').pop().toLowerCase();
      this._imageUrls.set(path, this.zip.has(path)
        ? this.zip.blobOf(path, MIME_BY_EXT[ext] || '').then(b => URL.createObjectURL(b))
        : Promise.resolve(''));
    }
    return this._imageUrls.get(path);
  }

  // Returns sanitised HTML for spine item i. Element ids are prefixed with
  // "c<i>-" so chapters can be shown together without clashes, internal links
  // are rewritten to data-target="<spineIndex>#<id>", and each block element
  // gets data-p (its paragraph index) for saving the reading position.
  chapterHtml(i) {
    if (!this._htmlCache.has(i)) this._htmlCache.set(i, this._buildChapter(i));
    return this._htmlCache.get(i);
  }

  async _buildChapter(i) {
    const path = this.spine[i].path;
    const doc = parseXml(await this.zip.text(path));
    const body = doc.body || doc.getElementsByTagName('body')[0] || doc.documentElement;
    const root = document.createElement('div');
    for (const node of Array.from(body.childNodes)) root.appendChild(document.importNode(node, true));

    for (const tag of STRIP_TAGS) root.querySelectorAll(tag).forEach(el => el.remove());

    const imageJobs = [];
    for (const el of root.querySelectorAll('*')) {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on') || name === 'srcset') el.removeAttribute(attr.name);
        // Inline styles could load remote images via url(); nothing should leave the computer.
        else if (name === 'style' && /url\s*\(/i.test(attr.value)) el.removeAttribute(attr.name);
        // Same for media and legacy attributes that fetch remote files.
        else if (REMOTE_ATTRS.has(name) && isExternal(attr.value.trim()) && !/^data:/i.test(attr.value.trim())) el.removeAttribute(attr.name);
      }
      if (el.id) el.id = `c${i}-${el.id}`;
      if (el.hasAttribute('name') && el.localName === 'a') el.id = el.id || `c${i}-${el.getAttribute('name')}`;

      const local = el.localName;
      // SVG elements such as <use> or <feImage> fetch their href automatically.
      if (local !== 'a' && local !== 'image') {
        const href = (el.getAttributeNS(NS.xlink, 'href') || el.getAttribute('href') || '').trim();
        if (href && isExternal(href) && !/^data:/i.test(href)) {
          el.removeAttributeNS(NS.xlink, 'href');
          el.removeAttribute('href');
        }
      }
      if (local === 'a' && el.hasAttribute('href')) {
        const href = el.getAttribute('href').trim();
        if (/^javascript:/i.test(href)) { el.removeAttribute('href'); continue; }
        if (isExternal(href)) {
          el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noopener noreferrer');
        } else {
          const [p, frag] = resolveHref(path, href);
          const si = this.spineIndexOf(p);
          el.removeAttribute('href');
          if (si >= 0) {
            el.setAttribute('href', '#');
            el.dataset.target = `${si}#${frag}`;
          }
        }
      } else if (local === 'img' && el.hasAttribute('src')) {
        const src = el.getAttribute('src');
        el.removeAttribute('src');
        if (!isExternal(src)) {
          const [p] = resolveHref(path, src);
          imageJobs.push(this._imageUrl(p).then(url => { if (url) el.setAttribute('src', url); }));
        }
        el.setAttribute('loading', 'lazy');
      } else if (local === 'image') {
        // SVG <image> (commonly used on cover pages)
        const src = el.getAttributeNS(NS.xlink, 'href') || el.getAttribute('href');
        el.removeAttributeNS(NS.xlink, 'href');
        el.removeAttribute('href');
        if (src && !isExternal(src)) {
          const [p] = resolveHref(path, src);
          imageJobs.push(this._imageUrl(p).then(url => { if (url) el.setAttribute('href', url); }));
        }
      }
    }
    await Promise.all(imageJobs);

    let n = 0;
    for (const el of root.querySelectorAll(POS_SELECTOR)) {
      if (el.closest('[data-p]') && el.closest('[data-p]') !== el) continue;
      el.dataset.p = n++;
    }
    const words = cleanText(root.textContent).split(' ').filter(Boolean).length;
    return { html: root.innerHTML, words, paragraphs: n };
  }
}
