// Runs inside deck.html (after the auto-fit script) and returns every drawable thing on each slide as JSON,
// in px relative to the slide's top-left, already multiplied by the .content scale (--z).
// Used by extract_pptx.mjs -> build_pptx_editable.py. Output per slide: {notes, items:[box|line-free box|text|img|svg]}.
(async () => {
  for (let i = 0; i < 200 && document.body.getAttribute('data-fit') !== '1'; i++) await new Promise(r => setTimeout(r, 50));
  if (document.fonts) await document.fonts.ready;

  // characters Arial has no glyph for (Chrome falls back to Segoe UI Symbol for these)
  const SYMBOL_RE = /([↖-⇿✀-➿⬀-⯿]+)/;
  const CS = new Map();
  const cs = el => { let c = CS.get(el); if (!c) { c = getComputedStyle(el); CS.set(el, c); } return c; };
  const px = v => parseFloat(v) || 0;
  const color = c => {
    const m = c && c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    const a = p.length > 3 ? p[3] : 1;
    if (a === 0) return null;
    return { hex: p.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase(), a };
  };
  const SC = new Map();
  const scaleOf = el => {
    if (SC.has(el)) return SC.get(el);
    let s = 1;
    for (let a = el; a && a.tagName !== 'SECTION'; a = a.parentElement) {
      const t = cs(a).transform;
      if (t && t !== 'none') { const m = new DOMMatrix(t); s *= Math.hypot(m.a, m.b); }
    }
    SC.set(el, s);
    return s;
  };
  const rot180 = el => { const t = cs(el).transform; if (!t || t === 'none') return false; const m = new DOMMatrix(t); return m.a < -0.5 && m.d < -0.5; };
  const isInline = el => cs(el).display === 'inline' && !['IMG', 'svg', 'BR'].includes(el.tagName);
  const isFlexLike = el => /flex|grid/.test(cs(el).display);
  const linkOf = el => { const a = el.closest && el.closest('a[href]'); return a ? a.href : null; };
  const alignOf = el => { const t = cs(el).textAlign; return t === 'center' ? 'ctr' : (t === 'right' || t === 'end') ? 'r' : t === 'justify' ? 'just' : 'l'; };

  const slides = [];
  for (const slide of document.querySelectorAll('section.slide')) {
    const S = slide.getBoundingClientRect();
    const items = [];
    const rel = r => ({ x: r.left - S.left, y: r.top - S.top, w: r.width, h: r.height });
    const contentBox = el => {
      const r = el.getBoundingClientRect(), c = cs(el), s = scaleOf(el);
      const l = r.left + (px(c.borderLeftWidth) + px(c.paddingLeft)) * s;
      const rr = r.right - (px(c.borderRightWidth) + px(c.paddingRight)) * s;
      return { left: l, right: rr };
    };
    const lineHeight = el => {
      const c = cs(el), s = scaleOf(el);
      return (c.lineHeight === 'normal' ? 1.149 * px(c.fontSize) : px(c.lineHeight)) * s;
    };

    // ---------- boxes (backgrounds, borders, radii, clip-path polygons)
    function boxOf(el) {
      const c = cs(el), r = el.getBoundingClientRect();
      if (r.width < 0.5 || r.height < 0.5) return null;
      const s = scaleOf(el);
      const bg = color(c.backgroundColor);
      const sides = ['Top', 'Right', 'Bottom', 'Left'].map(sd => {
        const w = px(c['border' + sd + 'Width']) * s, st = c['border' + sd + 'Style'], col = color(c['border' + sd + 'Color']);
        return (w > 0 && st !== 'none' && st !== 'hidden' && col) ? { w, style: st, color: col.hex } : null;
      });
      if (!bg && !sides.some(Boolean)) return null;
      let radii = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(k => {
        const v = (c['border' + k + 'Radius'] || '0').split(' ')[0];
        return v.endsWith('%') ? px(v) / 100 * r.width : px(v) * s;
      });
      const lim = (len, sum) => (sum > 0 ? len / sum : 1);   // CSS shrinks radii that would overlap
      const f = Math.min(1, lim(r.width, radii[0] + radii[1]), lim(r.width, radii[3] + radii[2]), lim(r.height, radii[0] + radii[3]), lim(r.height, radii[1] + radii[2]));
      radii = radii.map(v => v * f);
      let sidesV = sides;
      if (rot180(el)) { radii = [radii[2], radii[3], radii[0], radii[1]]; sidesV = [sides[2], sides[3], sides[0], sides[1]]; }
      let poly = null;
      const cp = c.clipPath;
      if (cp && cp.startsWith('polygon(')) {
        const ev = (tok, dim) => {
          const e = tok.replace(/^calc/, '').replace(/([\d.]+)%/g, (_, n) => '(' + n / 100 * dim + ')').replace(/([\d.]+)px/g, (_, n) => '(' + n * s + ')');
          return Function('return ' + e)();
        };
        poly = cp.slice(8, -1).split(',').map(pt => {
          const toks = pt.trim().match(/calc\([^)]*\)|[-\d.]+(?:px|%)?/g);
          return [r.left - S.left + ev(toks[0], r.width), r.top - S.top + ev(toks[1], r.height)];
        });
      }
      return { kind: 'box', ...rel(r), fill: bg ? bg.hex : null, fillA: bg ? bg.a : 1, sides: sidesV, radii, poly, link: linkOf(el), tag: el.tagName.toLowerCase(), cls: el.className && el.className.baseVal === undefined ? el.className : '' };
    }

    // ---------- text segments
    function newSeg(block) { return { block, paras: [{ runs: [] }], nodes: [], seq: [] }; }
    function addText(seg, node) {
      const p = node.parentElement, c = cs(p), s = scaleOf(p);
      let t = node.data.replace(/[ \t\n\r\f]+/g, ' ');
      if (!t) return;
      if (c.textTransform === 'uppercase') t = t.toUpperCase();
      const base = {
        size: px(c.fontSize) * s, bold: parseInt(c.fontWeight, 10) >= 600, italic: c.fontStyle === 'italic',
        color: (color(c.color) || { hex: '000000' }).hex, ls: c.letterSpacing === 'normal' ? 0 : px(c.letterSpacing) * s,
      };
      const runs = seg.paras[seg.paras.length - 1].runs;
      for (const part of t.split(SYMBOL_RE)) if (part) runs.push({ ...base, t: part, font: SYMBOL_RE.test(part) ? 'Segoe UI Symbol' : 'Arial' });
      seg.nodes.push(node); seg.seq.push(node);
      if (!seg.link) seg.link = linkOf(p);
    }
    // collapse whitespace across run boundaries, trim paragraph edges; returns false if no text
    function tidy(paras) {
      let any = false;
      for (const p of paras) {
        const runs = [];
        for (const r of p.runs) {
          if (r.br) { if (runs.length) { runs[runs.length - 1].t = runs[runs.length - 1].t.replace(/ +$/, ''); } runs.push(r); continue; }
          const prev = runs[runs.length - 1];
          let t = r.t;
          if ((!prev || prev.br || / $/.test(prev.t)) && t.startsWith(' ')) t = t.replace(/^ +/, '');
          if (t) runs.push({ ...r, t });
        }
        while (runs.length && !runs[runs.length - 1].br && /^ *$/.test(runs[runs.length - 1].t)) runs.pop();
        if (runs.length && !runs[runs.length - 1].br) runs[runs.length - 1].t = runs[runs.length - 1].t.replace(/ +$/, '');
        while (runs.length && runs[runs.length - 1].br) runs.pop();
        p.runs = runs.filter(r => r.br || r.t);
        if (p.runs.some(r => !r.br && r.t.trim())) any = true;
      }
      return any;
    }
    // Words with their rendered boxes, in reading order; forced = a <br> follows the word.
    function wordsOf(seq) {
      const words = [];
      for (const n of seq) {
        if (n.br) { if (words.length) words[words.length - 1].forced = true; continue; }
        const p = n.parentElement, fs = px(cs(p).fontSize) * scaleOf(p);
        const re = /[^\s\-–]+[\-–]?|[\-–]/g;
        let m;
        while ((m = re.exec(n.data))) {
          const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
          const rs = [...rg.getClientRects()].filter(r => r.width > 0.1);
          if (!rs.length) continue;
          const r = rs[rs.length - 1];
          words.push({ left: rs[0].left, right: r.right, mid: r.top + r.height / 2, w: rs.reduce((a, x) => a + x.width, 0), fs, hyph: /[\-–]$/.test(m[0]), forced: false });
        }
      }
      return words;
    }
    // Lines plus the width window that reproduces Chrome's line breaks: every line must fit (lo) and the first word
    // of each soft-wrapped next line must not (hi). The text box gets the middle of that window, so PowerPoint
    // breaks at the same words even though its Arial metrics differ from Chrome's by a fraction of a percent.
    function wrapInfo(seq, L) {
      const words = wordsOf(seq), lines = [];
      for (const w of words) {
        const ln = lines[lines.length - 1];
        if (ln && Math.abs(ln.mid - w.mid) < L * 0.45) ln.words.push(w);
        else lines.push({ mid: w.mid, words: [w] });
      }
      let lo = 0, hi = Infinity;
      lines.forEach((ln, k) => {
        ln.left = Math.min(...ln.words.map(w => w.left)); ln.right = Math.max(...ln.words.map(w => w.right));
        lo = Math.max(lo, ln.right - ln.left);
        const last = ln.words[ln.words.length - 1];
        if (k < lines.length - 1 && !last.forced) {
          const nx = lines[k + 1].words[0];
          hi = Math.min(hi, ln.right - ln.left + (last.hyph ? 0 : 0.278 * last.fs) + nx.w);
        }
      });
      return { lines, lo, hi };
    }
    function pickWidth(lo, hi) { return hi === Infinity ? lo + Math.max(12, lo * 0.08) : (hi > lo ? (lo + hi) / 2 : lo + 0.5); }
    function emitSeg(seg) {
      if (!seg.nodes.length || !tidy(seg.paras)) return;
      const el = seg.block, L = lineHeight(el);
      const { lines, lo, hi } = wrapInfo(seg.seq, L);
      if (!lines.length) return;
      const top = lines[0].mid - L / 2, bottom = lines[lines.length - 1].mid + L / 2;
      const W = pickWidth(lo, hi), align = alignOf(el);
      let left;
      if (align === 'ctr') left = lines.reduce((a, l) => a + (l.left + l.right) / 2, 0) / lines.length - W / 2;
      else if (align === 'r') left = Math.max(...lines.map(l => l.right)) - W;
      else left = Math.min(...lines.map(l => l.left));
      items.push(textItem(seg.paras, left, top, left + W, bottom, align, L, lines.length, seg.link, el));
    }
    function textItem(paras, left, top, right, bottom, align, L, nLines, link, el) {
      return { kind: 'text', x: left - S.left, y: top - S.top, w: right - left, h: bottom - top, align, L, lines: nLines, paras, link, tag: el.tagName.toLowerCase() };
    }

    function emitList(ul) {
      const lis = [...ul.children];
      if (!lis.length || lis.some(li => li.tagName !== 'LI' || [...li.querySelectorAll('*')].some(e => !isInline(e) && e.tagName !== 'BR'))) return false;
      const paras = [];
      let L = 0, top = null, bottom = 0, left = 1e9, lo = 0, hi = Infinity, m = 0, prevBottom = null, n = 0, link = null;
      for (const li of lis) {
        const seg = newSeg(li);
        const walk = node => {
          for (const ch of node.childNodes) {
            if (ch.nodeType === 3) addText(seg, ch);
            else if (ch.tagName === 'BR') { seg.paras[0].runs.push({ br: true }); seg.seq.push({ br: true }); }
            else if (ch.nodeType === 1) walk(ch);
          }
        };
        walk(li);
        if (!seg.nodes.length || !tidy(seg.paras)) continue;
        const Li = lineHeight(li); L = Li;
        const wi = wrapInfo(seg.seq, Li);
        if (!wi.lines.length) continue;
        const t = wi.lines[0].mid - Li / 2, b = wi.lines[wi.lines.length - 1].mid + Li / 2;
        m = 1.0 * px(cs(li).fontSize) * scaleOf(li);   // hanging indent that puts PowerPoint's bullet where Chrome draws its disc
        left = Math.min(left, contentBox(li).left);
        lo = Math.max(lo, wi.lo); hi = Math.min(hi, wi.hi);
        paras.push({ runs: seg.paras[0].runs, bullet: true, marL: m, spaceBefore: prevBottom === null ? 0 : Math.max(0, t - prevBottom) });
        if (top === null) top = t;
        bottom = b; prevBottom = b; n += wi.lines.length;
        link = link || seg.link;
      }
      if (!paras.length) return true;
      items.push(textItem(paras, left - m, top, left + pickWidth(lo, hi), bottom, 'l', L, n, link, ul));
      return true;
    }

    // ---------- pictures
    function emitImg(img) {
      const r = img.getBoundingClientRect(), par = img.parentElement, pc = cs(par);
      let vis = { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, radius = 0;
      if (pc.overflow === 'hidden' || pc.overflowX === 'hidden') {
        const pr = par.getBoundingClientRect(), s = scaleOf(par);
        const c = { left: pr.left + px(pc.borderLeftWidth) * s, top: pr.top + px(pc.borderTopWidth) * s, right: pr.right - px(pc.borderRightWidth) * s, bottom: pr.bottom - px(pc.borderBottomWidth) * s };
        vis = { left: Math.max(vis.left, c.left), top: Math.max(vis.top, c.top), right: Math.min(vis.right, c.right), bottom: Math.min(vis.bottom, c.bottom) };
        radius = Math.max(0, px(pc.borderTopLeftRadius) * s - px(pc.borderTopWidth) * s);
      }
      const crop = { l: (vis.left - r.left) / r.width, t: (vis.top - r.top) / r.height, r: (r.right - vis.right) / r.width, b: (r.bottom - vis.bottom) / r.height };
      items.push({ kind: 'img', src: img.currentSrc || img.src, x: vis.left - S.left, y: vis.top - S.top, w: vis.right - vis.left, h: vis.bottom - vis.top, crop, radius, alt: img.alt || '' });
    }
    const svgJobs = [];
    function emitSvg(svg) {
      const r = svg.getBoundingClientRect();
      const it = { kind: 'svg', ...rel(r), png: null };
      items.push(it);
      svgJobs.push([svg, it]);
    }
    async function raster(svg) {
      const r = svg.getBoundingClientRect(), K = 4;
      const clone = svg.cloneNode(true);
      const src = [svg, ...svg.querySelectorAll('*')], dst = [clone, ...clone.querySelectorAll('*')];
      const props = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'opacity', 'fill-opacity', 'stroke-opacity', 'dominant-baseline'];
      src.forEach((o, i) => { const c = getComputedStyle(o); dst[i].setAttribute('style', props.map(p => p + ':' + c.getPropertyValue(p)).join(';')); });
      clone.removeAttribute('class');
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', r.width * K); clone.setAttribute('height', r.height * K);
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = Math.round(r.width * K); cv.height = Math.round(r.height * K);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      return cv.toDataURL('image/png');
    }

    // ---------- walk: box first, then inline text segments and child blocks in DOM order (= z-order)
    function processBlock(el) {
      const c = cs(el);
      if (c.display === 'none' || c.visibility === 'hidden') return;
      if (el.tagName === 'svg') { emitSvg(el); return; }
      if (el.tagName === 'IMG') { emitImg(el); return; }
      if (el.tagName === 'BR' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
      let box = boxOf(el), deferred = null;
      if (box && (c.overflow === 'hidden') && el.querySelector(':scope > img')) {
        deferred = { ...box, fill: null }; box = { ...box, sides: [null, null, null, null] };   // border goes on top of the screenshot
      }
      if (box) items.push(box);
      if ((el.tagName === 'UL' || el.tagName === 'OL') && emitList(el)) { if (deferred) items.push(deferred); return; }
      if (c.writingMode.startsWith('vertical')) {
        const seg = newSeg(el);
        el.childNodes.forEach(n => { if (n.nodeType === 3) addText(seg, n); });
        if (tidy(seg.paras)) { const r = el.getBoundingClientRect(); items.push({ kind: 'text', ...rel(r), align: 'ctr', anchor: 'ctr', vert: 'vert270', L: lineHeight(el), lines: 1, paras: seg.paras, link: null, tag: el.tagName.toLowerCase() }); }
        return;
      }
      let seg = newSeg(el);
      const flush = () => { emitSeg(seg); seg = newSeg(el); };
      const visit = node => {
        if (node.nodeType === 3) { addText(seg, node); return; }
        if (node.nodeType !== 1) return;
        if (node.tagName === 'BR') { seg.paras[seg.paras.length - 1].runs.push({ br: true }); seg.seq.push({ br: true }); return; }
        if (isInline(node)) { node.childNodes.forEach(visit); return; }
        flush(); processBlock(node);
      };
      el.childNodes.forEach(visit);
      flush();
      if (deferred) items.push(deferred);
    }
    processBlock(slide);
    for (const [svg, it] of svgJobs) it.png = await raster(svg);
    slides.push({ w: S.width, h: S.height, notes: [...slide.children].filter(c => !c.classList.contains('strip')).map(c => c.innerText).join('\n').replace(/\n{2,}/g, '\n').trim(), items });
  }
  return { slides };
})()
