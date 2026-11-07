const E = m => Object.assign(new Error(m), { es: true });
const f = n => +(+n).toFixed(4);
const TX = (T, x) => T ? (T.m ? T.x1 - x : x - T.x0) : x;
const TY = (T, y) => T ? T.y1 - y : y;

/* ---------- Parser Gerber RS-274X ---------- */
function parseGerber(text, T) {
    let xd = 4, yd = 4, xi = 3, yi = 3, tz = false, clr = false, hasClear = false, u = 1, ap = {}, cur = null, x = 0, y = 0, mode = 1;
    let reg = false, pen = false, open = false, ld = 2, rp = '', path = '', gp = null;
    const fills = [], strokes = {}, macros = {}, geo = { polys: [], lines: [] }, bb = [1e9, 1e9, -1e9, -1e9];
    const steps = [];                                   // pasos de polaridad: oscuro (LPD) / claro (LPC)
    const startStep = c => { const t = { c, polys: [], lines: [] }; steps.push(t); geo.polys = t.polys; geo.lines = t.lines; };
    startStep(false);
    const box = (px, py, r) => {
        bb[0] = Math.min(bb[0], px - r); bb[1] = Math.min(bb[1], py - r);
        bb[2] = Math.max(bb[2], px + r); bb[3] = Math.max(bb[3], py + r);
    };
    const px = a => TX(T, a), py = b => TY(T, b), P = (a, b) => f(px(a)) + ' ' + f(py(b));
    const val = (s, d, n) => {
        let sg = 1;
        if (s[0] === '-' || s[0] === '+') { if (s[0] === '-') sg = -1; s = s.slice(1); }
        if (tz) s = s.padEnd(n + d, '0');               // ceros finales omitidos
        return sg * parseInt(s) / Math.pow(10, d) * u;
    };
    const flush = () => {
        if (path && cur) strokes[cur.w] = (strokes[cur.w] || '') + path;
        path = '';
    };
    const add = s => { if (reg) rp += s; else path += s; };

    const circ = (cx, cy, r) => {
        const X = px(cx), Y = py(cy), o = [];
        for (let k = 0; k < 48; k++) { const a = 2 * Math.PI * k / 48; o.push([X + r * Math.cos(a), Y + r * Math.sin(a)]); }
        geo.polys.push(o);
    };
    const arcPts = (x, y, nx, ny, i, j, ccw) => {
        const cx = x + i, cy = y + j, r = Math.hypot(i, j), a0 = Math.atan2(y - cy, x - cx);
        let d = Math.atan2(ny - cy, nx - cx) - a0;
        if (ccw) { while (d <= 1e-9) d += 2 * Math.PI; } else { while (d >= -1e-9) d -= 2 * Math.PI; }
        const n = Math.max(2, Math.ceil(Math.abs(d) / (Math.PI / 36))), o = [];
        for (let k = 1; k <= n; k++) { const a = a0 + d * k / n; o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
        o[n - 1] = [nx, ny];
        return o;
    };
    function arc(x, y, nx, ny, i, j, ccw) {
        const cx = x + i, cy = y + j, r = Math.hypot(i, j);
        let d = Math.atan2(ny - cy, nx - cx) - Math.atan2(y - cy, x - cx);
        if (ccw) { while (d <= 1e-9) d += 2 * Math.PI; } else { while (d >= -1e-9) d -= 2 * Math.PI; }
        const sw = (ccw ? 1 : 0) ^ (T && !T.m ? 1 : 0), R = f(r);
        if (Math.abs(Math.abs(d) - 2 * Math.PI) < 1e-6)
            return `A${R} ${R} 0 0 ${sw} ${P(2 * cx - x, 2 * cy - y)}A${R} ${R} 0 0 ${sw} ${P(nx, ny)}`;
        return `A${R} ${R} 0 ${Math.abs(d) > Math.PI ? 1 : 0} ${sw} ${P(nx, ny)}`;
    }

    const evalMacro = (lines, args) => {
        const v = {}; args.forEach((a, i) => v[i + 1] = a);
        const E = e => {
            e = e.trim().replace(/\$(\d+)/g, (_, n) => '(' + (v[n] || 0) + ')').replace(/x/gi, '*');
            if (!e || !/^[\d+\-*/().eE\s]*$/.test(e)) return 0;
            try { return Function('return ' + e)() || 0; } catch (_) { return 0; }
        };
        const rot = (pts, a) => {
            const c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180);
            return pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
        };
        const out = [];
        for (const L of lines) {
            if (/^\$\d+\s*=/.test(L)) { const k = L.indexOf('='); v[L.slice(1, k).trim()] = E(L.slice(k + 1)); continue; }
            const q = L.split(','), c = parseInt(q[0]);
            if (!(c >= 1)) continue;
            const n = q.slice(1).map(E);
            if (!n[0]) continue;                       // exposición "clear": se ignora
            if (c === 1) { const [x, y] = rot([[n[2], n[3]]], n[4] || 0)[0]; out.push({ x, y, r: n[1] / 2 }); }
            else if (c === 20) {
                const dx = n[4] - n[2], dy = n[5] - n[3], l = Math.hypot(dx, dy) || 1, ox = -dy / l * n[1] / 2, oy = dx / l * n[1] / 2;
                out.push({ pts: rot([[n[2] + ox, n[3] + oy], [n[4] + ox, n[5] + oy], [n[4] - ox, n[5] - oy], [n[2] - ox, n[3] - oy]], n[6] || 0) });
            } else if (c === 21 || c === 22) {
                const w = n[1], h = n[2], cx = c === 22 ? n[3] + w / 2 : n[3], cy = c === 22 ? n[4] + h / 2 : n[4];
                out.push({ pts: rot([[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]], n[5] || 0) });
            } else if (c === 4) {
                const k = n[1] + 1, pts = [];
                for (let i = 0; i < k; i++) pts.push([n[2 + 2 * i], n[3 + 2 * i]]);
                out.push({ pts: rot(pts, n[2 + 2 * k] || 0) });
            } else if (c === 5) {
                const k = n[1], r = n[4] / 2, pts = [];
                for (let i = 0; i < k; i++) { const a = 2 * Math.PI * i / k; pts.push([n[2] + r * Math.cos(a), n[3] + r * Math.sin(a)]); }
                out.push({ pts: rot(pts, n[5] || 0) });
            }
        }
        return out;
    };
    const flashMacro = (nx, ny, a) => {
        for (const s of evalMacro(macros[a.n], a.a)) {
            if (s.r != null) {
                fills.push(`<circle cx="${f(px(nx + s.x * u))}" cy="${f(py(ny + s.y * u))}" r="${f(s.r * u)}"/>`);
                circ(nx + s.x * u, ny + s.y * u, s.r * u);
                box(nx + s.x * u, ny + s.y * u, s.r * u);
            } else {
                fills.push('<path d="' + s.pts.map(([X, Y], i) => (i ? 'L' : 'M') + P(nx + X * u, ny + Y * u)).join('') + 'Z"/>');
                geo.polys.push(s.pts.map(([X, Y]) => [px(nx + X * u), py(ny + Y * u)]));
                s.pts.forEach(([X, Y]) => box(nx + X * u, ny + Y * u, 0));
            }
        }
    };

    const cmd = c => {
        c = c.trim(); if (!c) return;
        let m;
        if (m = c.match(/^FS([LT])?[AI]?X(\d)(\d)Y(\d)(\d)/)) { tz = m[1] === 'T'; xi = +m[2]; xd = +m[3]; yi = +m[4]; yd = +m[5]; return; }
        if (m = c.match(/^LP([DC])/)) {
            flush();
            const c2 = m[1] === 'C';
            if (c2) hasClear = true;
            if (c2 !== clr) {
                clr = c2;
                const t = steps[steps.length - 1];
                if (!t.polys.length && !t.lines.length) t.c = c2; else startStep(c2);
            }
            return;
        }
        if (c === 'MOMM') { u = 1; return; }
        if (c === 'MOIN') { u = 25.4; return; }
        if (m = c.match(/^ADD(\d+)([A-Za-z]\w*),?(.*)$/)) {
            const raw = m[3] ? m[3].split('X').map(Number) : [];
            if (macros[m[2]]) { ap[+m[1]] = { t: 'M', n: m[2], a: raw, w: 0.1 }; return; }
            const p = raw.map(v => v * u);
            const t = 'CROP'.includes(m[2]) && m[2].length === 1 ? m[2] : 'C';
            ap[+m[1]] = { t, p, w: p[0] || 0.1 };
            return;
        }
        m = c.match(/^(?:G(\d+))?(?:X([+-]?\d+))?(?:Y([+-]?\d+))?(?:I([+-]?\d+))?(?:J([+-]?\d+))?(?:D(\d+))?$/);
        if (!m) return;
        const g = m[1] ? +m[1] : null;
        if (g === 1 || g === 2 || g === 3) mode = g;
        if (g === 36) { flush(); reg = true; rp = ''; open = false; pen = false; }
        if (g === 37) { if (open) rp += 'Z'; if (rp) fills.push(`<path d="${rp}"/>`); rp = ''; reg = false; open = false; pen = false; }
        const nx = m[2] != null ? val(m[2], xd, xi) : x, ny = m[3] != null ? val(m[3], yd, yi) : y;
        const i = m[4] != null ? val(m[4], xd, xi) : 0, j = m[5] != null ? val(m[5], yd, yi) : 0;
        let d = m[6] != null ? +m[6] : (m[2] != null || m[3] != null ? ld : null);
        if (d == null) return;
        if (d >= 10) { flush(); cur = ap[d]; pen = false; return; }
        ld = d;
        const w = cur ? cur.w : 0;
        if (d === 1) {
            if (!reg && !cur) { x = nx; y = ny; return; }
            if (!pen) {
                add('M' + P(x, y)); pen = true; if (reg) open = true; box(x, y, w / 2);
                gp = [[px(x), py(y)]];
                if (reg) geo.polys.push(gp); else geo.lines.push({ w, pts: gp });
            }
            if (mode === 1) { add('L' + P(nx, ny)); gp.push([px(nx), py(ny)]); }
            else {
                add(arc(x, y, nx, ny, i, j, mode === 3));
                arcPts(x, y, nx, ny, i, j, mode === 3).forEach(q => gp.push([px(q[0]), py(q[1])]));
                box(x + i, y + j, Math.hypot(i, j) + w / 2);
            }
            box(nx, ny, w / 2);
        } else if (d === 2) {
            if (reg && open) { rp += 'Z'; open = false; }
            pen = false;
        } else if (d === 3 && cur) {
            pen = false;
            const p = cur.p;
            if (cur.t === 'M') flashMacro(nx, ny, cur);
            else if (cur.t === 'R' || cur.t === 'O') {
                const W = p[0], H = p[1] || p[0];
                fills.push(`<rect x="${f(px(nx) - W / 2)}" y="${f(py(ny) - H / 2)}" width="${f(W)}" height="${f(H)}"` +
                    (cur.t === 'O' ? ` rx="${f(Math.min(W, H) / 2)}"` : '') + '/>');
                if (cur.t === 'R') geo.polys.push([[px(nx - W / 2), py(ny - H / 2)], [px(nx + W / 2), py(ny - H / 2)], [px(nx + W / 2), py(ny + H / 2)], [px(nx - W / 2), py(ny + H / 2)]]);
                else if (Math.abs(W - H) < 1e-9) circ(nx, ny, W / 2);
                else {
                    const hx = W > H ? (W - H) / 2 : 0, hy = W > H ? 0 : (H - W) / 2;
                    geo.lines.push({ w: Math.min(W, H), pts: [[px(nx - hx), py(ny - hy)], [px(nx + hx), py(ny + hy)]] });
                }
                box(nx, ny, Math.max(W, H) / 2);
            } else {
                fills.push(`<circle cx="${f(px(nx))}" cy="${f(py(ny))}" r="${f(p[0] / 2 || 0.05)}"/>`);
                circ(nx, ny, p[0] / 2 || 0.05);
                box(nx, ny, p[0] / 2);
            }
        }
        x = nx; y = ny;
    };

    const s = text.replace(/[\r\n]+/g, '');
    const re = /%([^%]*)%|([^*%]*)\*/g; let m;
    while (m = re.exec(s)) {
        if (m[1] != null) {
            const parts = m[1].split('*');
            if (parts[0].startsWith('AM')) macros[parts[0].slice(2)] = parts.slice(1).filter(Boolean);
            else parts.forEach(cmd);
        } else cmd(m[2]);
    }
    flush();
    geo.steps = steps;
    return { fills, strokes, bb, geo, hasClear };
}

/* ---------- Parser Excellon ---------- */
function parseDrill(text, T) {
    let u = 1, ints = 3, decs = 3, lz = false, tools = {}, cur = null; const raw = [], geo = { polys: [] };
    const bb = [1e9, 1e9, -1e9, -1e9];
    const setUnit = inch => { u = inch ? 25.4 : 1; ints = inch ? 2 : 3; decs = inch ? 4 : 3; };
    const num = s => {
        if (s.includes('.')) return parseFloat(s) * u;
        let sg = 1;
        if (s[0] === '-' || s[0] === '+') { if (s[0] === '-') sg = -1; s = s.slice(1); }
        if (lz) s = s.padEnd(ints + decs, '0');         // LZ: se conservan ceros iniciales, faltan los finales
        return sg * parseInt(s) / Math.pow(10, decs) * u;
    };
    for (let line of text.split(/\r?\n/)) {
        line = line.trim(); let m;
        if (line === 'M48') { setUnit(false); lz = false; }
        if (m = line.match(/FILE_FORMAT=(\d):(\d)/)) { ints = +m[1]; decs = +m[2]; }
        if (m = line.match(/^(METRIC|INCH)(?:,(LZ|TZ))?(?:,(\d+)\.(\d+))?/)) {
            setUnit(m[1] === 'INCH'); lz = m[2] === 'LZ';
            if (m[3]) { ints = m[3].length; decs = m[4].length; }
        } else if (/^M72/.test(line)) setUnit(true);
        else if (/^M71/.test(line)) setUnit(false);
        if (m = line.match(/^T(\d+).*C([\d.]+)/)) tools[+m[1]] = +m[2] * u;
        else if (m = line.match(/^T(\d+)$/)) cur = +m[1];
        else if ((m = line.match(/^X([+-]?[\d.]+)Y([+-]?[\d.]+)/)) && tools[cur]) {
            const X = num(m[1]), Y = num(m[2]), r = tools[cur] / 2;
            raw.push(`<circle cx="${f(TX(T, X))}" cy="${f(TY(T, Y))}" r="${f(r)}"/>`);
            const o = [];
            for (let k = 0; k < 64; k++) { const a = 2 * Math.PI * k / 64; o.push([TX(T, X) + r * Math.cos(a), TY(T, Y) + r * Math.sin(a)]); }
            geo.polys.push(o);
            bb[0] = Math.min(bb[0], X - r); bb[1] = Math.min(bb[1], Y - r);
            bb[2] = Math.max(bb[2], X + r); bb[3] = Math.max(bb[3], Y + r);
        }
    }
    return { raw, bb, geo };
}

/* ---------- Construcción del SVG ---------- */
const LAY = [
    ['cobre', 'GRABADO_cobre', '#000000', 0],
    ['pads', 'GRABADO_pads', '#0000ff', 0],
    ['silk', 'GRABADO_serigrafia', '#00a000', 0],
    ['drill', 'CORTE_taladros', '#ff0000', 1],
    ['edge', 'CORTE_marco', '#ff00ff', 0]
];

function layerBody(l) {
    const g = l.g, c = l.col;
    const st = (el, a) => el.replace(/\/>$/, ' ' + a + '/>');
    if (l.isD) return g.raw.map(e => st(e, `fill="none" stroke="${c}" stroke-width="0.05"`)).join('');
    let s = g.fills.map(e => st(e, `fill="${c}" stroke="none"`)).join('');
    for (const w in g.strokes)
        s += `<path d="${g.strokes[w]}" fill="none" stroke="${c}" stroke-width="${f(w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    return s;
}

function cuBody(geo, R, col, neg, holes) {
    if (typeof ClipperLib === 'undefined') throw E('No se pudo cargar la librería Clipper (revisa tu conexión).');
    const C = ClipperLib, S = 1e4, NZ = C.PolyFillType.pftNonZero, CT = C.ClipType;
    const tp = r => r.map(p => ({ X: Math.round(p[0] * S), Y: Math.round(p[1] * S) }));
    const pos = r => { const p = tp(r); if (!C.Clipper.Orientation(p)) p.reverse(); return p; };
    const run = (type, a, b) => {
        const c = new C.Clipper(), out = new C.Paths();
        a.forEach(p => c.AddPath(p, C.PolyType.ptSubject, true));
        b.forEach(p => c.AddPath(p, C.PolyType.ptClip, true));
        c.Execute(type, out, NZ, NZ);
        return out;
    };
    const shapes = st => {
        const subj = st.polys.filter(r => r.length > 2).map(pos);
        const byW = {};
        st.lines.forEach(l => { if (l.pts.length > 1) (byW[l.w] = byW[l.w] || []).push(tp(l.pts)); });
        for (const k in byW) {
            const co = new C.ClipperOffset(2, 0.002 * S), sol = new C.Paths();
            co.AddPaths(byW[k], C.JoinType.jtRound, C.EndType.etOpenRound);
            co.Execute(sol, +k / 2 * S);
            sol.forEach(p => subj.push(p));          // los huecos del offset ya vienen orientados: no se tocan
        }
        return run(CT.ctUnion, subj, []);
    };
    const steps = geo.steps || [{ c: false, polys: geo.polys, lines: geo.lines }];
    let res = new C.Paths();
    for (const st of steps) {                         // LPD suma, LPC resta, en el orden del archivo
        if (!st.polys.length && !st.lines.length) continue;
        const sh = shapes(st);
        res = st.c ? run(CT.ctDifference, res, sh) : run(CT.ctUnion, res.concat(sh), []);
    }
    if (holes && holes.length) res = run(CT.ctDifference, res, holes.map(pos));   // perforaciones reales
    if (neg) res = run(CT.ctDifference, [tp([[R.x, R.y], [R.x + R.w, R.y], [R.x + R.w, R.y + R.h], [R.x, R.y + R.h]])], res);
    const path = res.map(p => 'M' + p.map(q => f(q.X / S) + ' ' + f(q.Y / S)).join('L') + 'Z').join('');
    return `<path d="${path}" fill="${col}" fill-rule="evenodd" stroke="none"/>`;
}

/* Marco de corte: solo contorno (sin relleno). Sin archivo se dibuja el rectángulo de la placa. */
function cutBody(l, bb) {
    const st = `fill="none" stroke="${l.col}" stroke-width="0.1" stroke-linecap="round" stroke-linejoin="round"`;
    if (l.auto) {
        const xa = TX(l.T, bb[0]), xb = TX(l.T, bb[2]), y0 = TY(l.T, bb[3]), y1 = TY(l.T, bb[1]);
        return `<path d="M${f(Math.min(xa, xb))} ${f(y0)}H${f(Math.max(xa, xb))}V${f(y1)}H${f(Math.min(xa, xb))}Z" ${st}/>`;
    }
    let s = '';
    for (const k in l.g.strokes) s += `<path d="${l.g.strokes[k]}" ${st}/>`;
    return s + l.g.fills.map(e => e.replace(/\/>$/, ' ' + st + '/>')).join('');
}

/* Lienzo: "Placa" (cobre, pads, taladros y marco de corte) pegada a la derecha, a 5 mm del borde derecho y del superior.
   La serigrafía (con W = ancho del lienzo, 5 mm por lado) va a la izquierda, a 5 mm del borde izquierdo, y comparte
   con la placa la misma referencia vertical: así, al dar vuelta la placa, todo queda alineado.
   Cada espejo gira su conjunto horizontalmente sobre sí mismo, sin perder su lado. */
function buildSvg(L, mirror, silkMirror, neg, merge, W) {
    const M = 5, bb = [1e9, 1e9, -1e9, -1e9], sb = [1e9, 1e9, -1e9, -1e9];
    const uni = (a, b) => { a[0] = Math.min(a[0], b[0]); a[1] = Math.min(a[1], b[1]); a[2] = Math.max(a[2], b[2]); a[3] = Math.max(a[3], b[3]); };
    L.forEach(l => {
        if (l.auto) return;
        l.g = l.isD ? parseDrill(l.t) : parseGerber(l.t);
        uni(l.k === 'silk' ? sb : bb, l.g.bb);
    });
    if (bb[0] > bb[2]) throw E('No se encontró geometría en los archivos.');
    const sk = L.some(l => l.k === 'silk');
    const bw = bb[2] - bb[0], bh = bb[3] - bb[1], sw = sb[2] - sb[0];
    if (sk) {
        if (sb[0] > sb[2]) throw E('No se encontró geometría en la serigrafía.');
        if (!(W > 2 * M)) throw E('Indica el ancho de la PCB (mínimo 10 mm) para colocar la serigrafía.');
        if (Math.max(bw, sw) > W - 2 * M + 1e-6) throw E(`El ancho indicado (${f(W)} mm) es menor que el necesario (${f(Math.max(bw, sw) + 2 * M)} mm).`);
    }
    const CW = sk ? W : bw + M, fr = CW - M;
    const Yt = Math.max(bb[3], sk ? sb[3] : -1e9);       // referencia vertical común (arriba, a 5 mm)
    const g = neg ? 1 : 0;                             // el negativo sobresale 1 mm de la placa, dentro del margen
    L.forEach(l => {
        l.T = l.k === 'silk'
            ? { m: silkMirror, x0: sb[0] - M, x1: sb[2] + M, y1: Yt + M }                     // lado izquierdo, misma altura que la placa
            : { m: mirror, x0: bb[2] - fr, x1: fr + bb[0], y1: Yt + M };                      // lado derecho
        if (!l.auto) l.g = l.isD ? parseDrill(l.t, l.T) : parseGerber(l.t, l.T);
    });
    const w = f(CW), h = f(M + Yt - Math.min(bb[1] - g, sk ? sb[1] : 1e9));
    let s = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">`;
    const cob = L.find(l => l.k === 'cobre');
    const rx = Math.min(TX(cob.T, bb[0]), TX(cob.T, bb[2])), rx0 = Math.max(0, rx - g);
    const R = { x: rx0, y: TY(cob.T, bb[3]) - g, w: rx + bw + g - rx0, h: bh + 2 * g };
    const dl = L.find(l => l.isD), holes = merge && dl ? dl.g.geo.polys : [];
    const body = l => {
        if (l.k === 'edge') return cutBody(l, cob.g.bb);                 // marco = contorno del Gerber de cobre
        const cu = l.k === 'cobre', mg = (cu || l.k === 'pads') && holes.length, clr = !l.isD && l.g.hasClear;
        return (cu && neg) || mg || clr ? cuBody(l.g.geo, R, l.col, cu && neg, mg ? holes : null) : layerBody(l);
    };
    if (L.length === 1) s += body(L[0]);            // un solo archivo: SVG plano, sin capas
    else for (const l of L)
        s += `<g id="${l.label}" inkscape:groupmode="layer" inkscape:label="${l.label}">${body(l)}</g>`;
    return s + '</svg>';
}

/* ---------- UI ---------- */
const $ = id => document.getElementById(id);
const SW = { kicad: 'KiCad', easyeda: 'EasyEDA', proteus: 'Proteus' };
const sw = () => document.querySelector('input[name="sw"]:checked').value;
document.body.dataset.sw = sw();
document.querySelectorAll('input[name="sw"]').forEach(r => r.onchange = () => { document.body.dataset.sw = sw(); });

$('go').onclick = async () => {
    $('err').textContent = ''; $('dl').style.display = 'none';
    try {
        const L = [];
        for (const [k, label, col, isD] of LAY) {
            if (k === 'edge') {                           // marco de corte: sin archivo, usa el contorno del cobre
                if ($('edgeYes').checked) L.push({ k, label, col, isD, auto: true });
                continue;
            }
            const files = [...$(k).files];
            if (!files.length) { if (k === 'cobre') throw E('Falta el Gerber principal.'); continue; }
            const t = (await Promise.all(files.map(fl => fl.text()))).join('\n');   // varios taladros (PTH, vías, NPTH) se unen
            L.push({ k, label, col, isD, t });
        }
        if ($('mergeYes').checked && !$('drill').files.length) throw E('Para unir los taladros sube el archivo de taladros.');
        const W = parseFloat($('pcbw').value) || 0;
        const svg = buildSvg(L, $('mirror').checked, $('mirrorSilk').checked, $('negYes').checked, $('mergeYes').checked, W);
        $('stage').innerHTML = svg;
        fitView();
        $('dl').href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        $('dl').style.display = 'inline-block';
    } catch (e) {
        console.error(e);
        $('err').textContent = e.es ? e.message : `No se pudo procesar el archivo. Revisa que sea un Gerber o Excellon válido exportado desde ${SW[sw()]}.`;
    }
};
/* Persistencia: los archivos y las opciones se conservan (al descargar, al generar de nuevo y al recargar). */
const idb = () => new Promise((ok, no) => {
    const r = indexedDB.open('jackgerber', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('estado');
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
});
const guardar = async (k, v) => { try { (await idb()).transaction('estado', 'readwrite').objectStore('estado').put(v, k); } catch (_) { } };
const leer = async k => {
    try {
        const d = await idb();
        return await new Promise(ok => { const q = d.transaction('estado').objectStore('estado').get(k); q.onsuccess = () => ok(q.result); q.onerror = () => ok(undefined); });
    } catch (_) { return undefined; }
};
const FK = ['cobre', 'pads', 'silk', 'drill'];
const nombres = k => { const fl = [...$(k).files]; $(k + '-n').textContent = fl.length ? fl.map(x => x.name).join(', ') : 'Ningún archivo'; };
const ctl = () => [...document.querySelectorAll('.controls input:not([type=file])')];
const guardarOpc = () => guardar('opc', ctl().map(i => ({ c: i.checked, v: i.value })));
FK.forEach(k => $(k).onchange = () => { nombres(k); guardar('f:' + k, [...$(k).files]); });
document.querySelector('.controls').addEventListener('change', guardarOpc);
$('pcbw').addEventListener('input', guardarOpc);
(async () => {
    for (const k of FK) {
        const fl = await leer('f:' + k);
        if (fl && fl.length && window.DataTransfer) {
            const dt = new DataTransfer(); fl.forEach(x => dt.items.add(x));
            $(k).files = dt.files; nombres(k);
        }
    }
    const o = await leer('opc');
    if (o) ctl().forEach((i, n) => { if (o[n]) { if (i.type === 'number') i.value = o[n].v; else i.checked = o[n].c; } });
    document.body.dataset.sw = sw();
})();
$('clr').onclick = () => {
    document.querySelector('.controls').reset();
    FK.forEach(k => { guardar('f:' + k, []); nombres(k); });
    guardarOpc(); $('err').textContent = ''; document.body.dataset.sw = sw();
};
const vp = $('prev'), st = $('stage'), ptrs = new Map();
let sc = 1, tx = 0, ty = 0, pd = 0;
function apply() {
    tx = Math.min(0, Math.max(vp.clientWidth * (1 - sc), tx));
    ty = Math.min(0, Math.max(vp.clientHeight * (1 - sc), ty));
    st.style.transform = `translate(${tx}px,${ty}px) scale(${sc})`;
}
function fitView() { sc = 1; tx = ty = 0; apply(); }
function zoomAt(cx, cy, k) {
    const n = Math.min(80, Math.max(1, sc * k)); k = n / sc;
    tx = cx - (cx - tx) * k; ty = cy - (cy - ty) * k; sc = n; apply();
}
const pinch = () => {
    const a = [...ptrs.values()];
    return a.length === 2 ? { d: Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]), x: (a[0][0] + a[1][0]) / 2, y: (a[0][1] + a[1][1]) / 2 } : null;
};
vp.addEventListener('wheel', e => {
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });
vp.onpointerdown = e => { vp.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); const p = pinch(); pd = p ? p.d : 0; };
vp.onpointermove = e => {
    if (!ptrs.has(e.pointerId)) return;
    const o = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 1) { tx += e.clientX - o[0]; ty += e.clientY - o[1]; apply(); }
    else { const p = pinch(), r = vp.getBoundingClientRect(); if (p && pd) zoomAt(p.x - r.left, p.y - r.top, p.d / pd); if (p) pd = p.d; }
};
vp.onpointerup = vp.onpointercancel = e => { ptrs.delete(e.pointerId); const p = pinch(); pd = p ? p.d : 0; };
vp.ondblclick = fitView;
$('zin').onclick = () => zoomAt(vp.clientWidth / 2, vp.clientHeight / 2, 1.5);
$('zout').onclick = () => zoomAt(vp.clientWidth / 2, vp.clientHeight / 2, 1 / 1.5);
$('zfit').onclick = fitView;
window.addEventListener('resize', apply);