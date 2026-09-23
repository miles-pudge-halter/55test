(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  const canvas = document.getElementById('sky');
  const ctx = canvas.getContext('2d');
  const INK = '#2b2d42';
  const RED = '#e63946';
  const FONT = '"Caveat", "Comic Sans MS", cursive';
  const TAU = Math.PI * 2;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, DPR = 1, U = 100;
  const C = { x: 0, y: 0 };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  // ---------------------------------------------------------------------------
  // Randomness: a seeded RNG so every doodle "boils" between a few fixed poses
  // (like hand-drawn animation) instead of flickering every frame.
  // ---------------------------------------------------------------------------
  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let boil = 0;
  let rnd = mulberry(1);
  const seed = (id) => { rnd = mulberry(Math.imul(id + 1, 2654435761) ^ Math.imul(boil + 1, 97531)); };
  const jit = (a) => (rnd() * 2 - 1) * a;
  const gauss = (r) => (r() + r() + r() + r() - 2) / 2;

  // ---------------------------------------------------------------------------
  // Doodle primitives (all in screen pixels, so lines stay crisp while zooming)
  // ---------------------------------------------------------------------------
  let A = 1; // global opacity of the scene currently being drawn
  const alpha = (a) => { ctx.globalAlpha = clamp(A * a, 0, 1); };
  const onScreen = (x, y, r) => x + r > -40 && x - r < W + 40 && y + r > -40 && y - r < H + 40;

  function tracePath(pts, closed) {
    const n = pts.length;
    if (n < 2) return;
    ctx.beginPath();
    if (closed) {
      ctx.moveTo((pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2);
      for (let i = 0; i < n; i++) {
        const p = pts[i], q = pts[(i + 1) % n];
        ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
      }
      ctx.closePath();
    } else {
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < n - 1; i++) {
        const p = pts[i], q = pts[i + 1];
        ctx.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
      }
      ctx.lineTo(pts[n - 1][0], pts[n - 1][1]);
    }
  }

  const jitter = (pts, j) => pts.map((p) => [p[0] + jit(j), p[1] + jit(j)]);

  function stroke(pts, o = {}) {
    const { color = INK, width = 2, closed = false, j = 1.2, passes = 1, a = 1, dash = null } = o;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (dash) ctx.setLineDash(dash);
    for (let k = 0; k < passes; k++) {
      alpha(a * (k ? 0.55 : 1));
      tracePath(jitter(pts, j), closed);
      ctx.stroke();
    }
    if (dash) ctx.setLineDash([]);
  }

  function circlePts(cx, cy, r, n) {
    const out = [];
    const a0 = rnd() * TAU;
    const rj = Math.min(r * 0.04, 2.5);
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * TAU;
      const rr = r + jit(rj);
      out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    return out;
  }

  function ellipsePts(cx, cy, rx, ry, rot, n, from = 0, to = TAU) {
    const out = [];
    const c = Math.cos(rot), s = Math.sin(rot);
    for (let i = 0; i <= n; i++) {
      const a = from + ((to - from) * i) / n;
      const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
      out.push([cx + x * c - y * s, cy + x * s + y * c]);
    }
    return out;
  }

  // Pencil hatching inside the current clip (or inside `clip` when given).
  function hatch(clip, cx, cy, r, o) {
    const { color = INK, spacing = 6, angle = -0.8, width = 1.2, a = 0.7 } = o;
    const diag = Math.hypot(W, H);
    if (r > diag) { cx = W / 2; cy = H / 2; r = diag / 2; } // the shape is clipped anyway
    ctx.save();
    if (clip) { clip(); ctx.clip(); }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    alpha(a);
    const ca = Math.cos(angle), sa = Math.sin(angle);
    ctx.beginPath();
    for (let d = -r; d <= r; d += spacing) {
      const ox = cx - sa * d + jit(1), oy = cy + ca * d + jit(1);
      ctx.moveTo(ox - ca * r * 1.05 + jit(3), oy - sa * r * 1.05 + jit(3));
      ctx.lineTo(ox + ca * r * 1.05 + jit(3), oy + sa * r * 1.05 + jit(3));
    }
    ctx.stroke();
    ctx.restore();
  }

  // A closed shape with a marker wash, pencil hatching and a sketchy outline.
  function blob(pts, o = {}) {
    const { fill, wash = 0.4, hatchColor, spacing = 6, angle = -0.8, stroke: sc = INK, width = 2, passes = 2, a = 1, j = 1.2 } = o;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, r = Math.max(x1 - x0, y1 - y0) / 2;
    if (!onScreen(cx, cy, r)) return;
    const body = jitter(pts, j * 0.4);
    if (fill) { alpha(a * wash); ctx.fillStyle = fill; tracePath(body, true); ctx.fill(); }
    if (hatchColor && r > 5) hatch(() => tracePath(body, true), cx, cy, r, { color: hatchColor, spacing, angle, a: a * 0.65 });
    if (sc) stroke(pts, { color: sc, width, closed: true, j, passes, a });
  }

  function circ(cx, cy, r, o = {}) {
    if (!onScreen(cx, cy, r)) return;
    if (r < 3) {
      alpha(o.a ?? 1);
      ctx.fillStyle = o.dot || o.stroke || INK;
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(r, 1.2), 0, TAU); ctx.fill();
      return;
    }
    const n = o.n || clamp(Math.round(r / 4), 10, 56);
    blob(circlePts(cx, cy, r, n), o);
  }

  function arrow(x1, y1, x2, y2, o = {}) {
    const { color = INK, width = 2.2, bend = 0.25, a = 1 } = o;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1;
    const qx = mx - dy * bend, qy = my + dx * bend;
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, u = 1 - t;
      pts.push([u * u * x1 + 2 * u * t * qx + t * t * x2, u * u * y1 + 2 * u * t * qy + t * t * y2]);
    }
    stroke(pts, { color, width, a, j: 0.9 });
    const ang = Math.atan2(y2 - qy, x2 - qx), L = 10;
    stroke([
      [x2 - Math.cos(ang - 0.45) * L, y2 - Math.sin(ang - 0.45) * L],
      [x2, y2],
      [x2 - Math.cos(ang + 0.45) * L, y2 - Math.sin(ang + 0.45) * L],
    ], { color, width, a, j: 0.6 });
  }

  function label(str, x, y, o = {}) {
    const { size = 20, color = INK, align = 'center', a = 1, rot = 0, fit = false, bg = false } = o;
    if (a <= 0.01 || size < 6) return;
    alpha(a);
    ctx.fillStyle = color;
    ctx.font = `700 ${size}px ${FONT}`;
    if (fit && align === 'center') { const w = ctx.measureText(str).width; x = clamp(x, w / 2 + 8, W - w / 2 - 8); }
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot + jit(0.012));
    if (bg) {
      // a scrap of paper behind the text so it stays readable over busy doodles
      const w = ctx.measureText(str).width, x0 = align === 'left' ? 0 : align === 'right' ? -w : -w / 2;
      ctx.fillStyle = '#fdfaf1';
      alpha(a * 0.85);
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x0 - 5, -size * 0.55, w + 10, size * 1.1, 6) : ctx.rect(x0 - 5, -size * 0.55, w + 10, size * 1.1);
      ctx.fill();
      alpha(a);
      ctx.fillStyle = color;
    }
    ctx.fillText(str, 0, 0);
    ctx.restore();
  }

  // Plan a "look here!" label + arrow pointing at (sx, sy). Prefers direction
  // (ox, oy) but turns to another side if the text would leave the screen.
  function planCallout(text, sx, sy, ox, oy, off, size) {
    ctx.font = `700 ${size}px ${FONT}`;
    const w = ctx.measureText(text).width, h = size;
    const dirs = [[ox, oy], [0, -1], [0, 1], [-ox, -oy], [1, 0], [-1, 0]];
    let best = null;
    for (const [dx, dy] of dirs) {
      const lx = sx + dx * off, ly = sy + dy * off;
      const align = dx > 0.35 ? 'left' : dx < -0.35 ? 'right' : 'center';
      const tx = lx + dx * 8, ty = ly + (dy >= 0 ? h * 0.7 : -h * 0.7) * Math.abs(dy);
      const cx = align === 'left' ? tx + w / 2 : align === 'right' ? tx - w / 2 : tx;
      const plan = { lx, ly, dx, dy, tx, ty, cx, w, align };
      if (!best) best = plan;
      if (cx - w / 2 > 8 && cx + w / 2 < W - 8 && ty - h > 8 && ty + h < H - 8) return plan;
    }
    return best;
  }
  function drawCallout(text, sx, sy, gap, c, o) {
    arrow(c.lx, c.ly, sx + c.dx * gap, sy + c.dy * gap, { color: o.color, a: o.a, bend: o.bend ?? 0.2 });
    label(text, c.tx, c.ty, { align: c.align, size: o.size, color: o.color, a: o.a, bg: true });
  }

  // Labels shrink with their scene and vanish when it is tiny or huge.
  const labelFx = (v) => {
    const k = v.s / U;
    return { k: clamp(k, 0.5, 1.2), a: smooth(0.3, 0.6, k) * (1 - smooth(2.5, 4, k)) };
  };
  const fontBase = () => clamp(U * 0.1, 16, 26);

  // ---------------------------------------------------------------------------
  // Earth geography (shared by the Earth, Asia and Thailand scenes)
  // ---------------------------------------------------------------------------
  // Rough hand-traced coastlines as [lon, lat] points. Asia gets extra detail
  // because we zoom right into it.
  const EURASIA = [
    [35, 32], [34, 28], [38, 22], [43, 13], [45, 13], [52, 16], [57, 19], [59, 22], [56, 26], [51, 24], [50, 27], [48, 30],
    [50, 30], [54, 27], [57, 26], [62, 25], [67, 24.5], [69, 22.5], [72, 21], [73, 17], [74.5, 13], [76, 9], [77.5, 8],
    [79.5, 10], [80, 13], [80.3, 15.8], [82.5, 17], [85, 19.5], [87, 21.5], [89, 22], [91.5, 22.5], [92.3, 20.5], [94, 18],
    [94.5, 16], [97.5, 16.5], [98, 13.5], [98.5, 10], [98.3, 8], [100, 6.5], [100.3, 4], [101.5, 2.7], [103.5, 1.3],
    [104.2, 1.5], [103.4, 4], [103, 5.5], [101.5, 6.8], [100.3, 8.4], [99.2, 10.3], [99.2, 12.5], [100, 13.4], [100.6, 13.5],
    [101, 12.7], [102.2, 12.2], [102.8, 11.5], [103.5, 10.6], [104.5, 10.4], [105, 9], [106.5, 9.5], [106.8, 10.4],
    [108.9, 11.3], [109.3, 13], [108.8, 15.4], [106.6, 17.4], [105.7, 19], [106.7, 20.7], [108, 21.6], [110, 21],
    [111.5, 21.6], [113.5, 22.2], [116.5, 23], [118.5, 24.6], [120, 26.5], [121.6, 28.5], [122, 30], [121, 32], [120.5, 34],
    [119, 35], [120.5, 36.5], [122.5, 37], [121, 37.8], [118.5, 38], [117.7, 39], [119, 39.5], [121.5, 40.8], [122.2, 40.4],
    [121.5, 39], [124, 39.8], [125.3, 37.7], [126.5, 34.5], [129.3, 35.2], [129.5, 37], [128.5, 38.6], [127.5, 39.8],
    [129.7, 41], [130.7, 42.4], [133, 42.8], [135.5, 44], [138.5, 47], [140.5, 50], [140.5, 53], [137, 54], [135, 55],
    [138, 56.5], [143, 59.3], [150, 59.5], [155, 62], [160, 61], [163, 57], [162, 54.5], [156.5, 51], [156, 57], [160, 60],
    [165, 60], [170, 62], [178, 64.5], [180, 68], [170, 70], [160, 70], [140, 72], [130, 71], [113, 73.5], [105, 77.5],
    [95, 76], [80, 73], [70, 73], [66, 69], [58, 70], [45, 68], [35, 69], [30, 70], [20, 70], [10, 63], [5, 61], [8, 58],
    [10, 54], [3, 51], [-2, 48], [-1, 44], [-9, 43], [-9, 37], [-5, 36], [0, 38], [3, 42], [8, 44], [12, 44], [16, 40],
    [16, 38], [18, 40], [13, 45], [19, 42], [22, 37], [24, 38], [26, 40], [28, 41], [29, 41], [28, 36.5], [32, 36.5], [36, 36.5],
  ];
  const ISLANDS = [
    // Japan (Honshu/Kyushu, Hokkaido)
    [[130, 31], [131.5, 31.5], [132, 33.5], [135, 33.5], [137, 34.5], [140, 35], [141, 38], [142, 40], [141.5, 41.5], [140, 40.5], [139.5, 38], [137, 37], [136, 36], [133, 35.5], [131, 34.5]],
    [[140, 41.8], [141.5, 42.5], [143.5, 42], [145.5, 43.3], [142, 45.4], [141.5, 43.8], [140, 43]],
    // Taiwan, Hainan, Sri Lanka
    [[120.2, 22.5], [121, 21.9], [121.9, 24.5], [121.5, 25.3], [120.1, 23.5]],
    [[108.7, 19.2], [110.5, 20.1], [111, 19.6], [110, 18.2], [108.7, 18.5]],
    [[79.8, 6.5], [80.2, 9.8], [81.9, 7.5], [81.2, 6.2]],
    // Sumatra, Java, Borneo, Sulawesi
    [[95.3, 5.6], [97.5, 5.2], [100.5, 2], [104, -1], [106, -3], [105.8, -5.8], [104, -5], [102, -4], [100, -1], [98.5, 1.5]],
    [[105.3, -6.8], [106.5, -6], [110, -6.9], [112.7, -6.9], [114.5, -7.8], [114.2, -8.7], [110, -8.1], [106.5, -7.4]],
    [[109, 1.5], [109.6, 2], [111, 1.8], [113, 3.2], [115.5, 5.2], [117, 7], [119, 5.2], [118, 4.3], [118.5, 1], [117.5, 0], [116.5, -2.5], [116, -4], [114.5, -3.5], [111, -3], [110, -1.5], [109, 0]],
    [[119.5, -5.5], [120.5, -2], [120, 0.5], [121, 1.2], [124.5, 1.4], [122.5, -0.5], [121.5, -1], [123, -4.5], [121.5, -4.8], [120.5, -5.5]],
    // Philippines (Luzon, Mindanao), New Guinea
    [[120, 18.5], [122.2, 18.5], [122, 16], [124, 13.8], [123.5, 13], [121, 13.8], [120.5, 15], [119.8, 16.2]],
    [[122, 7], [123.5, 8], [125.5, 9.5], [126.5, 7], [125.5, 5.8], [124, 6.3]],
    [[131, -1], [135, -3.3], [138, -1.6], [141, -2.6], [145, -4.5], [147.5, -6], [150, -10.5], [147, -9.5], [143, -9], [141, -9.1], [138, -8.3], [137.5, -5], [133, -4], [132, -2.5]],
  ];
  const THAILAND = [
    [99.9, 20.4], [100.5, 20.2], [100.6, 19.5], [101.2, 19.5], [101, 18.4], [101.6, 17.8], [102.6, 17.9], [103.3, 18.4],
    [104, 18.3], [104.8, 17.4], [104.8, 16.2], [105.6, 15.8], [105.5, 14.5], [104.3, 14.4], [102.9, 14.2], [102.5, 13],
    [102.9, 11.6], [102.3, 12.2], [101.7, 12.7], [100.9, 12.7], [100.9, 13.4], [100.5, 13.5], [100, 13.3], [99.95, 12.5],
    [99.5, 11], [99.2, 10], [99.9, 9.2], [100.3, 8.3], [100.6, 7.1], [101.3, 6.8], [102, 6.2], [101.1, 5.7], [100.6, 6.4],
    [100.1, 6.5], [99.7, 6.9], [99.3, 7.5], [98.3, 8.2], [98.3, 9], [98.7, 10.3], [98.8, 11.7], [99.2, 12.3], [99.2, 13.2],
    [98.2, 15], [98.6, 16.2], [97.4, 18.5], [97.8, 19.6], [98.5, 19.8], [99.4, 20.2],
  ];
  const WORLD = [
    // North America
    [[-165, 65], [-140, 70], [-100, 72], [-75, 65], [-60, 50], [-80, 30], [-97, 18], [-85, 10], [-105, 22], [-118, 33], [-125, 48], [-150, 58]],
    // Greenland
    [[-50, 60], [-20, 70], [-25, 82], [-60, 80]],
    // South America
    [[-80, 10], [-60, 8], [-35, -7], [-40, -22], [-58, -38], [-70, -54], [-75, -40], [-72, -18], [-81, -5]],
    // Africa
    [[-17, 21], [-5, 35], [10, 37], [32, 31], [43, 12], [51, 11], [40, -15], [32, -28], [20, -35], [12, -18], [8, 4], [-8, 5], [-17, 14]],
    EURASIA,
    // Australia
    [[114, -22], [130, -12], [142, -11], [153, -27], [146, -39], [135, -35], [115, -34]],
    ...ISLANDS,
  ];
  const ICE = Array.from({ length: 12 }, (_, i) => [i * 30, 76 + (i % 2) * 4]);
  const CLOUDS = [[-40, 20, 50], [60, -10, 40], [150, 35, 45], [-130, -25, 55], [10, 55, 35]];

  // Home sweet home
  const BKK = [100.5, 13.75];
  const BKK_ROT = (BKK[0] * Math.PI) / 180; // Earth rotation that puts Bangkok front and centre
  let spin = BKK_ROT; // current Earth rotation (advanced in frame())

  const TILT = 0.4;
  function project(lon, lat, rot) {
    const l = (lon * Math.PI) / 180 - rot, p = (lat * Math.PI) / 180;
    let x = Math.cos(p) * Math.sin(l);
    let y = Math.cos(TILT) * Math.sin(p) - Math.sin(TILT) * Math.cos(p) * Math.cos(l);
    const z = Math.sin(TILT) * Math.sin(p) + Math.cos(TILT) * Math.cos(p) * Math.cos(l);
    if (z < 0) { const m = Math.hypot(x, y) || 1; x /= m; y /= m; } // pin hidden points to the rim
    return [x, -y, z];
  }

  // A stick figure. `hand` is where the inner hand reaches (to hold hands),
  // `side` is which way the free arm waves, and `dress` adds a skirt + long hair.
  function stickFigure(x, y, h, t, { hand, side = 1, dress = false, phase = 0 } = {}) {
    const head = h * 0.18;
    const hip = [x, y - h * 0.42], neck = [x, y - h * 0.78], shoulder = [x, y - h * 0.7];
    const wave = Math.sin(t * 6 + phase) * 0.5;
    const w = clamp(h * 0.08, 1.6, 2.6);
    const o = { width: w, j: 0.5 };
    const hy = y - h * 0.78 - head;
    if (dress) {
      stroke([[x - head * 0.9, hy - head * 0.4], [x - head * 1.3, hy + head * 0.6], [x - head * 1.2, hy + head * 1.6]], { color: '#6f4518', width: w * 1.3, j: 0.4 });
      stroke([[x + head * 0.9, hy - head * 0.4], [x + head * 1.3, hy + head * 0.6], [x + head * 1.2, hy + head * 1.6]], { color: '#6f4518', width: w * 1.3, j: 0.4 });
    }
    if (dress) {
      blob([[x, y - h * 0.72], [x + h * 0.22, y - h * 0.16], [x - h * 0.22, y - h * 0.16]], { fill: '#ff8fab', wash: 0.9, stroke: INK, width: w, passes: 1, j: 0.5 });
      stroke([[x - h * 0.1, y - h * 0.16], [x - h * 0.13, y]], o);
      stroke([[x + h * 0.1, y - h * 0.16], [x + h * 0.13, y]], o);
    } else {
      stroke([[x - h * 0.16, y], hip, [x + h * 0.16, y]], o);
      stroke([hip, neck], o);
    }
    const wa = side > 0 ? -0.45 + wave * 0.7 : -Math.PI + 0.45 - wave * 0.7;
    stroke([shoulder, [x + Math.cos(wa) * h * 0.44, y - h * 0.7 + Math.sin(wa) * h * 0.44]], o);
    stroke([shoulder, hand || [x - side * h * 0.3, y - h * 0.55]], o);
    circ(x, hy, head, { fill: '#ffe8d6', wash: 1, stroke: INK, width: w, passes: 1, j: 0.5, n: 10 });
  }

  function heart(x, y, s, o = {}) {
    const pts = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      pts.push([x + s * 16 * Math.pow(Math.sin(a), 3) / 16, y - s * (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 16]);
    }
    blob(pts, { fill: RED, wash: 0.9, stroke: RED, width: 1.6, passes: 1, j: 0.4, ...o });
  }

  // The two of us, holding hands on top of the world, with a little heart.
  function couple(x, y, h, t, R) {
    const gap = h * 0.3;
    const drop = (gap * gap) / (2 * R);
    const hands = [x, y - h * 0.5 + drop];
    stickFigure(x - gap, y + drop, h, t, { hand: hands, side: -1 });
    stickFigure(x + gap, y + drop, h * 0.94, t, { hand: hands, side: 1, dress: true, phase: 1.3 });
    heart(x, y - h * 1.25 + Math.sin(t * 2.5) * h * 0.06, h * 0.16 * (1 + 0.08 * Math.sin(t * 5)));
  }


  // A polygon with near-sharp corners (tracePath rounds every vertex, so we
  // add points hugging each corner).
  function polyPts(corners) {
    const out = [];
    corners.forEach((a, i) => {
      const b = corners[(i + 1) % corners.length];
      const at = (u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
      out.push(a, at(0.08), at(0.5), at(0.92));
    });
    return out;
  }

  function peaks(x, y, s, n, a = 1) {
    for (let k = 0; k < n; k++) {
      const px = x + (k - (n - 1) / 2) * s * 1.1, py = y + (k % 2) * s * 0.35;
      stroke([[px - s * 0.6, py], [px, py - s], [px + s * 0.6, py]], { color: '#6c584c', width: 1.8, a, j: 0.5 });
    }
  }

  // Land masses for any view of the globe, with Thailand in pink.
  function drawLand(proj, toS, sd) {
    WORLD.forEach((poly, i) => {
      const pr = poly.map(([lo, la]) => proj(lo, la));
      if (Math.max(...pr.map((p) => p[2])) < 0.05) return;
      seed(sd + i);
      blob(pr.map(toS), { fill: '#b7e4c7', wash: 0.95, hatchColor: '#2d6a4f', spacing: 5, angle: 0.7, stroke: '#2d6a4f', width: 2, passes: 1 });
    });
    const th = THAILAND.map(([lo, la]) => proj(lo, la));
    if (th[0][2] > 0.05) {
      seed(sd + 60);
      blob(th.map(toS), { fill: '#ffc2d1', wash: 0.95, hatchColor: RED, spacing: 4, angle: -0.6, stroke: RED, width: 2.2, passes: 1 });
    }
  }

  // Close-up views of the globe, always centred on Bangkok.
  const BKK_Y = project(BKK[0], BKK[1], BKK_ROT)[1];
  function drawGlobeMap(v, Rg, sd) {
    const GR = Rg * v.s, gx = v.x, gy = v.y - BKK_Y * GR;
    const f = {
      at: (lo, la) => { const p = project(lo, la, BKK_ROT); return [gx + p[0] * GR, gy + p[1] * GR, p[2]]; },
    };
    seed(sd);
    const globe = GR < Math.hypot(W, H) * 1.5 ? circlePts(gx, gy, GR, 72) : null;
    const ocean = () => { if (globe) tracePath(globe, true); else { ctx.beginPath(); ctx.rect(-20, -20, W + 40, H + 40); } };
    alpha(0.7); ctx.fillStyle = '#a9def9'; ocean(); ctx.fill();
    hatch(ocean, gx, gy, GR, { color: '#219ebc', spacing: 7, angle: -0.9, a: 0.5 });
    ctx.save();
    ocean();
    ctx.clip();
    drawLand((lo, la) => project(lo, la, BKK_ROT), (p) => [gx + p[0] * GR, gy + p[1] * GR], sd + 1);
    ctx.restore();
    if (globe) { seed(sd + 99); stroke(globe, { closed: true, width: 3, passes: 2, j: 1.4 }); }
    return f;
  }

  function mapTagger(f, fs, L) {
    return (lo, la, txt, o = {}) => {
      const p = f.at(lo, la);
      if (p[2] > 0.1) label(txt, p[0], p[1], { size: fs * (o.k || 0.9), a: L.a * (o.a || 0.85), color: o.color || '#1b4332', rot: o.rot || 0 });
    };
  }

  // ---------------------------------------------------------------------------
  // Scene: Asia
  // ---------------------------------------------------------------------------
  const ASIA_R = 1.35, THAI_R = 7;
  const asiaScene = {
    name: 'Asia',
    K: THAI_R / ASIA_R,
    anchor: () => [0, 0],
    draw(v) {
      if (!onScreen(v.x, v.y, v.s * ASIA_R * 2)) return;
      const L = labelFx(v), fs = fontBase() * L.k;
      const f = drawGlobeMap(v, ASIA_R, 700);
      if (L.a <= 0.01) return;
      seed(740);
      const tag = mapTagger(f, fs, L);
      tag(100, 55, 'RUSSIA');
      tag(103, 35, 'CHINA');
      tag(78.5, 21, 'INDIA');
      tag(114, -2, 'INDONESIA', { k: 0.72 });
      tag(137, 40, 'JAPAN', { k: 0.7 });
      tag(80, -4, 'Indian Ocean', { color: '#1d6fa5' });
      tag(142, 15, 'Pacific Ocean', { color: '#1d6fa5' });
      const hm = f.at(86, 29.5);
      if (hm[2] > 0.1) peaks(hm[0], hm[1], clamp(fs * 0.5, 6, 13), 5, L.a);
      tag(86, 33, 'Himalayas', { k: 0.7, color: '#6c584c' });
      const [tx, ty] = f.at(101.5, 15);
      const co = planCallout('Thailand', tx, ty, 0.95, 0.3, clamp(v.s * 0.5, 60, 160), fs * 1.1);
      drawCallout('Thailand', tx, ty, 10, co, { color: RED, a: L.a, size: fs * 1.1 });
    },
  };

  // ---------------------------------------------------------------------------
  // Scene: Thailand
  // ---------------------------------------------------------------------------
  const BKK_K = 18;
  const thailandScene = {
    name: 'Thailand',
    K: BKK_K,
    anchor: () => [0, 0],
    draw(v, t) {
      if (!onScreen(v.x, v.y, v.s * 2)) return;
      const L = labelFx(v), fs = fontBase() * L.k;
      const f = drawGlobeMap(v, THAI_R, 800);
      if (L.a > 0.01) {
        seed(840);
        const tag = mapTagger(f, fs, L);
        tag(96.3, 21, 'MYANMAR', { k: 0.75 });
        tag(103.6, 19.4, 'LAOS', { k: 0.75 });
        tag(104.9, 12.9, 'CAMBODIA', { k: 0.7 });
        tag(107.7, 14.5, 'VIETNAM', { k: 0.7, rot: -1.2 });
        tag(102.3, 4.2, 'MALAYSIA', { k: 0.75 });
        tag(101.9, 9.4, 'Gulf of Thailand', { color: '#1d6fa5', k: 0.8 });
        tag(95.6, 9.3, 'Andaman Sea', { color: '#1d6fa5', k: 0.8 });
        tag(102.4, 16.2, 'THAILAND', { k: 1.3, color: RED, a: 1 });
        const pk = f.at(99.6, 19.3);
        peaks(pk[0], pk[1], clamp(fs * 0.45, 5, 12), 3, L.a);
        [[98.98, 18.79, 'Chiang Mai', 1], [98.39, 7.88, 'Phuket', -1]].forEach(([lo, la, name, side]) => {
          const [x, y] = f.at(lo, la);
          circ(x, y, 3.5, { dot: INK, a: L.a });
          label(name, x + side * 8, y, { size: fs * 0.8, a: L.a, align: side > 0 ? 'left' : 'right' });
        });
      }
      // Bangkok: the spot we zoomed out of
      seed(850);
      const r = Math.max((1.3 / BKK_K) * v.s, 4);
      circ(v.x, v.y, r, { fill: '#ffd166', wash: 1, stroke: RED, width: 2.2, passes: 1, dot: RED });
      if (L.a > 0.01) {
        heart(v.x, v.y - r - 12, clamp(fs * 0.4, 6, 11), { a: L.a });
        const co = planCallout('Bangkok (home!)', v.x, v.y, -0.95, -0.3, clamp(v.s * 0.45, 60, 150), fs);
        drawCallout('Bangkok (home!)', v.x, v.y, r + 6, co, { color: RED, a: L.a, size: fs, bend: 0.25 });
      }
    },
  };

  // ---------------------------------------------------------------------------
  // Scene: Bangkok (side-on doodle of the riverside skyline, with us in it)
  // ---------------------------------------------------------------------------
  function prang(X, Y, cx, base, w, h, a) {
    const P = (u, k) => [X(cx + u * w), Y(base - k * h)];
    const pts = polyPts([P(-0.5, 0), P(-0.42, 0.25), P(-0.3, 0.55), P(-0.16, 0.8), P(-0.05, 0.93), P(0.05, 0.93), P(0.16, 0.8), P(0.3, 0.55), P(0.42, 0.25), P(0.5, 0)]);
    blob(pts, { fill: '#fefae0', wash: 1, hatchColor: '#e9c46a', spacing: 4, angle: 0.8, width: 2, passes: 1, a });
    [[0.25, 0.42], [0.55, 0.3], [0.8, 0.16]].forEach(([k, u]) => stroke([P(-u, k), P(u, k)], { color: '#e76f51', width: 1.8, a }));
    stroke([P(0, 0.93), P(0, 1.1)], { width: 2, a });
    ['#f72585', '#4361ee', '#2a9d8f'].forEach((c, i) => {
      const [x, y] = P((i - 1) * 0.2, 0.4 + (i % 2) * 0.1);
      alpha(a); ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, w * 0.02 * (X(1) - X(0))), 0, TAU); ctx.fill();
    });
  }

  const BUILDINGS = [
    [0.27, 0.12, 0.42, '#bde0fe'], [0.41, 0.1, 0.56, '#cdb4db'], [0.53, 0.12, 0.36, '#ffc8dd'],
    [0.67, 0.1, 0.84, '#a2d2ff', 'mahanakhon'], [0.8, 0.12, 0.5, '#caffbf'], [0.94, 0.11, 0.68, '#ffd6a5', 'antenna'],
    [1.07, 0.1, 0.4, '#bde0fe'],
  ];

  const bangkokScene = {
    name: 'Bangkok',
    draw(v, t) {
      if (!onScreen(v.x, v.y, v.s * 1.4)) return;
      const L = labelFx(v), fs = fontBase() * L.k;
      const X = (x) => v.x + x * v.s, Y = (y) => v.y + y * v.s, S = (d) => d * v.s;
      const G = 0.3; // riverbank line

      // Sun
      seed(600);
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * TAU + t * 0.2;
        stroke([[X(-0.95) + Math.cos(ang) * S(0.13), Y(-0.62) + Math.sin(ang) * S(0.13)], [X(-0.95) + Math.cos(ang) * S(0.18), Y(-0.62) + Math.sin(ang) * S(0.18)]], { color: '#f77f00', width: 2.5 });
      }
      circ(X(-0.95), Y(-0.62), S(0.1), { fill: '#ffd166', wash: 0.9, hatchColor: '#f77f00', spacing: 5, width: 2.4 });
      label('phew, 35°C!', X(-0.95), Y(-0.4), { size: fs * 0.75, a: L.a, color: '#bc6c25', rot: -0.06 });

      // Skyline
      BUILDINGS.forEach(([x, w, h, c, kind], i) => {
        seed(610 + i);
        const x0 = X(x - w / 2), x1 = X(x + w / 2), top = Y(G - h), bot = Y(G);
        blob(polyPts([[x0, bot], [x0, top], [x1, top], [x1, bot]]), { fill: c, wash: 0.9, width: 2, passes: 1, j: 0.8 });
        alpha(0.55); ctx.strokeStyle = INK; ctx.lineWidth = 1.3; ctx.beginPath();
        for (let yy = top + S(0.05); yy < bot - S(0.04); yy += S(0.065)) {
          for (let xx = x0 + S(0.022); xx < x1 - S(0.03); xx += S(0.035)) {
            ctx.moveTo(xx + jit(0.6), yy + jit(0.6)); ctx.lineTo(xx + S(0.016) + jit(0.6), yy + jit(0.6));
          }
        }
        ctx.stroke();
        if (kind === 'mahanakhon') {
          const pts = [];
          for (let k = 0; k <= 8; k++) pts.push([x1 - S(k % 2 ? 0.035 : 0.012), top + S(0.05 + k * 0.07)]);
          stroke(pts, { width: 2, j: 0.5 });
        }
        if (kind === 'antenna') {
          stroke([[X(x), top], [X(x), top - S(0.12)]], { width: 2 });
          circ(X(x), top - S(0.12), 2.5, { dot: RED });
        }
      });

      // Grand Palace
      seed(630);
      blob(polyPts([[X(-0.26), Y(G)], [X(-0.26), Y(G - 0.13)], [X(0), Y(G - 0.13)], [X(0), Y(G)]]), { fill: '#ffffff', wash: 1, width: 2, passes: 1, j: 0.8 });
      [-0.22, -0.16, -0.1, -0.04].forEach((px) => stroke([[X(px), Y(G - 0.12)], [X(px), Y(G)]], { width: 1.4, a: 0.6 }));
      blob(polyPts([[X(-0.3), Y(G - 0.13)], [X(0.04), Y(G - 0.13)], [X(-0.13), Y(G - 0.3)]]), { fill: '#e85d04', wash: 0.95, hatchColor: '#9d0208', spacing: 4, width: 2, passes: 1, j: 0.8 });
      blob(polyPts([[X(-0.24), Y(G - 0.2)], [X(-0.02), Y(G - 0.2)], [X(-0.13), Y(G - 0.36)]]), { fill: '#2a9d8f', wash: 0.9, width: 2, passes: 1, j: 0.8 });
      blob(polyPts([[X(-0.16), Y(G - 0.33)], [X(-0.1), Y(G - 0.33)], [X(-0.13), Y(G - 0.6)]]), { fill: '#ffb703', wash: 1, hatchColor: '#bc6c25', spacing: 3, width: 2, passes: 1, j: 0.6 });
      stroke([[X(-0.3), Y(G - 0.13)], [X(-0.325), Y(G - 0.17)], [X(-0.31), Y(G - 0.195)]], { color: '#e09f3e', width: 2.4 });
      stroke([[X(0.04), Y(G - 0.13)], [X(0.065), Y(G - 0.17)], [X(0.05), Y(G - 0.195)]], { color: '#e09f3e', width: 2.4 });

      // Wat Arun
      seed(640);
      prang(X, Y, -0.86, G, 0.12, 0.36, 1);
      prang(X, Y, -0.38, G, 0.12, 0.36, 1);
      prang(X, Y, -0.62, G, 0.26, 0.78, 1);

      // Palm tree
      seed(650);
      const trunk = [[X(-1.1), Y(G)], [X(-1.105), Y(G - 0.12)], [X(-1.12), Y(G - 0.24)], [X(-1.14), Y(G - 0.32)]];
      stroke(trunk, { color: '#7f5539', width: clamp(S(0.02), 3, 7) });
      [[-2.6, 0.13], [-1.9, 0.15], [-1.1, 0.15], [-0.4, 0.13], [0.3, 0.1]].forEach(([ang, len]) => {
        const sway = Math.sin(t * 1.5) * 0.08, a2 = ang + sway;
        const ox = X(-1.14), oy = Y(G - 0.32);
        stroke([[ox, oy], [ox + Math.cos(a2) * S(len) * 0.6, oy + Math.sin(a2) * S(len) * 0.6 - S(0.02)], [ox + Math.cos(a2) * S(len), oy + Math.sin(a2) * S(len) + S(0.03)]], { color: '#2d6a4f', width: clamp(S(0.014), 2.5, 5) });
      });

      // Riverbank and the Chao Phraya
      seed(660);
      blob(polyPts([[X(-1.5), Y(G + 0.02)], [X(1.5), Y(G + 0.02)], [X(1.5), Y(G + 0.34)], [X(-1.5), Y(G + 0.34)]]), { fill: '#8ecae6', wash: 0.8, stroke: null });
      stroke([[X(-1.5), Y(G)], [X(-0.5), Y(G + 0.005)], [X(0.5), Y(G - 0.004)], [X(1.5), Y(G)]], { width: 3 });
      for (let i = 0; i < 12; i++) {
        const wx = ((i * 0.37 + t * 0.04) % 2.8) - 1.4, wy = G + 0.07 + (i % 4) * 0.065;
        stroke([[X(wx), Y(wy)], [X(wx + 0.03), Y(wy - 0.012)], [X(wx + 0.06), Y(wy)], [X(wx + 0.09), Y(wy - 0.012)]], { color: '#219ebc', width: 1.8, a: 0.8 });
      }
      // Longtail boat
      const bx = ((t * 0.06) % 3) - 1.5, by = G + 0.17 + Math.sin(t * 2) * 0.004;
      seed(670);
      blob(polyPts([[X(bx - 0.13), Y(by - 0.025)], [X(bx + 0.14), Y(by - 0.04)], [X(bx + 0.1), Y(by + 0.02)], [X(bx - 0.11), Y(by + 0.02)]]), { fill: '#bc6c25', wash: 0.95, hatchColor: '#7f5539', spacing: 4, width: 2, passes: 1, j: 0.6 });
      stroke([[X(bx - 0.13), Y(by - 0.025)], [X(bx - 0.22), Y(by + 0.03)]], { width: 2 });
      stroke([[X(bx - 0.26), Y(by + 0.035)], [X(bx - 0.22), Y(by + 0.025)], [X(bx - 0.18), Y(by + 0.04)]], { color: '#ffffff', width: 2.5 });

      // Tuk-tuk
      const kx = 1.4 - ((t * 0.09 + 0.8) % 2.8);
      seed(680);
      blob(polyPts([[X(kx - 0.08), Y(G - 0.03)], [X(kx + 0.07), Y(G - 0.03)], [X(kx + 0.07), Y(G - 0.075)], [X(kx - 0.08), Y(G - 0.075)]]), { fill: '#06d6a0', wash: 0.95, width: 2, passes: 1, j: 0.6 });
      blob(polyPts([[X(kx - 0.09), Y(G - 0.135)], [X(kx + 0.03), Y(G - 0.135)], [X(kx + 0.03), Y(G - 0.115)], [X(kx - 0.09), Y(G - 0.115)]]), { fill: '#ffd166', wash: 1, width: 2, passes: 1, j: 0.5 });
      stroke([[X(kx - 0.075), Y(G - 0.115)], [X(kx - 0.075), Y(G - 0.075)]], { width: 2 });
      stroke([[X(kx + 0.02), Y(G - 0.115)], [X(kx + 0.02), Y(G - 0.075)]], { width: 2 });
      circ(X(kx - 0.055), Y(G - 0.02), S(0.02), { fill: INK, wash: 1, width: 2, passes: 1, dot: INK });
      circ(X(kx + 0.05), Y(G - 0.02), S(0.02), { fill: INK, wash: 1, width: 2, passes: 1, dot: INK });

      // Us!
      seed(690);
      couple(X(0.13), Y(G), S(0.26), t, 1e9);

      if (L.a > 0.01) {
        seed(695);
        label('Bangkok', X(0.62), Y(-0.72), { size: fs * 1.6, a: L.a, rot: -0.05 });
        label('Wat Arun', X(-0.62), Y(G + 0.055), { size: fs * 0.7, a: L.a * 0.85 });
        label('Grand Palace', X(-0.13), Y(G + 0.055), { size: fs * 0.7, a: L.a * 0.85 });
        label('Chao Phraya River', X(0.62), Y(G + 0.29), { size: fs * 0.8, a: L.a, color: '#1d6fa5' });
        const hx = X(0.13), hy = Y(G - 0.3);
        const co = planCallout('we are here!', hx, hy, 0.55, -0.83, clamp(S(0.32), 50, 120), fs);
        drawCallout('we are here!', hx, hy, 14, co, { color: RED, a: L.a, size: fs, bend: -0.25 });
      }
    },
  };

  const EARTH_R = 0.72;
  const earthScene = {
    name: 'Earth',
    K: ASIA_R / EARTH_R,
    anchor: () => { const p = project(BKK[0], BKK[1], spin); return [p[0] * EARTH_R, p[1] * EARTH_R]; },
    draw(v, t) {
      const R = EARTH_R * v.s, cx = v.x, cy = v.y;
      if (!onScreen(cx, cy, R * 1.8)) return;
      const rot = spin;
      const L = labelFx(v), fs = fontBase() * L.k;

      // Moon on a tilted orbit: back half drawn behind Earth, front half in front.
      const ma = t * 0.3 + 0.6, orx = R * 1.5, ory = R * 0.34, orot = -0.22;
      const moonPos = ellipsePts(cx, cy, orx, ory, orot, 1, ma, ma)[0];
      const moonBehind = Math.sin(ma) < 0;
      const drawMoon = () => {
        seed(12);
        circ(moonPos[0], moonPos[1], R * 0.14, { fill: '#e9ecef', wash: 1, hatchColor: '#8d99ae', spacing: 5, width: 2 });
        seed(13);
        circ(moonPos[0] - R * 0.04, moonPos[1] - R * 0.03, R * 0.035, { stroke: '#8d99ae', width: 1.5, passes: 1 });
        circ(moonPos[0] + R * 0.05, moonPos[1] + R * 0.04, R * 0.025, { stroke: '#8d99ae', width: 1.5, passes: 1 });
        label('Moon', moonPos[0], moonPos[1] + R * 0.14 + fs * 0.8, { size: fs * 0.85, a: L.a, color: '#5c6178' });
      };
      seed(10);
      stroke(ellipsePts(cx, cy, orx, ory, orot, 40, Math.PI, TAU), { a: 0.3, dash: [4, 7], width: 1.5 });
      if (moonBehind) drawMoon();

      // Ocean
      seed(11);
      const earth = circlePts(cx, cy, R, 56);
      alpha(0.7); ctx.fillStyle = '#a9def9'; tracePath(earth, true); ctx.fill();
      hatch(() => tracePath(earth, true), cx, cy, R, { color: '#219ebc', spacing: 7, angle: -0.9, a: 0.55 });

      ctx.save();
      tracePath(earth, true);
      ctx.clip();
      // Continents
      drawLand((lo, la) => project(lo, la, rot), (p) => [cx + p[0] * R, cy + p[1] * R], 20);
      // North polar cap
      seed(30);
      blob(ICE.map(([lo, la]) => project(lo, la, rot)).map((p) => [cx + p[0] * R, cy + p[1] * R]), {
        fill: '#ffffff', wash: 0.95, stroke: '#90e0ef', width: 2, passes: 1,
      });
      // Clouds drift a bit faster than the ground
      CLOUDS.forEach(([lo, la, len], i) => {
        const pts = [];
        for (let k = 0; k <= 6; k++) {
          const p = project(lo + (k / 6) * len, la + Math.sin(k * 1.3 + i) * 4, rot * 1.25);
          if (p[2] > 0.05) pts.push([cx + p[0] * R, cy + p[1] * R]);
        }
        seed(40 + i);
        if (pts.length > 2) stroke(pts, { color: '#ffffff', width: clamp(R * 0.035, 2, 9), a: 0.9, j: 1.5 });
      });
      // Night side: scribbled shadow crescent
      ctx.beginPath();
      ctx.rect(-10, -10, W + 20, H + 20);
      ctx.arc(cx - R * 0.32, cy - R * 0.22, R * 1.08, 0, TAU);
      ctx.clip('evenodd');
      seed(31);
      hatch(null, cx, cy, R, { color: '#1d3557', spacing: 4.5, angle: 0.95, width: 1.4, a: 0.5 });
      ctx.restore();

      seed(32);
      stroke(earth, { closed: true, width: 3, passes: 2, j: 1.4 });

      if (!moonBehind) drawMoon();

      // Where we live
      const home = project(BKK[0], BKK[1], rot);
      if (home[2] > 0.25 && R > 50 && L.a > 0.01) {
        const hx = cx + home[0] * R, hy = cy + home[1] * R;
        seed(33);
        heart(hx, hy - 4, clamp(R * 0.05, 6, 14), { a: L.a });
        const co = planCallout('we are here!', hx, hy, 0.75, -0.66, clamp(R * 0.75, 70, 170), fs);
        drawCallout('we are here!', hx, hy, 16, co, { color: RED, a: L.a, size: fs, bend: -0.2 });
      }
      label('Earth', cx - R * 0.95, cy + R * 0.95, { size: fs * 1.4, a: L.a, rot: -0.08 });
    },
  };

  // ---------------------------------------------------------------------------
  // Scene 2: the Solar System
  // ---------------------------------------------------------------------------
  const PLANETS = [
    { n: 'Mercury', a: 0.2, r: 0.016, c: '#b5a397' },
    { n: 'Venus', a: 0.28, r: 0.025, c: '#f4a261' },
    { n: 'Earth', a: 0.37, r: 0.027, c: '#4cc9f0' },
    { n: 'Mars', a: 0.46, r: 0.021, c: '#e76f51' },
    { n: 'Jupiter', a: 0.64, r: 0.06, c: '#dda15e', stripes: true },
    { n: 'Saturn', a: 0.78, r: 0.05, c: '#e9c46a', ring: true },
    { n: 'Uranus', a: 0.9, r: 0.036, c: '#90e0ef' },
    { n: 'Neptune', a: 1.0, r: 0.036, c: '#4361ee' },
  ];
  (() => {
    const r = mulberry(5);
    PLANETS.forEach((p) => {
      p.speed = 0.3 * Math.pow(0.37 / p.a, 1.5);
      p.phase = r() * TAU;
    });
    PLANETS[2].phase = -0.5;
  })();
  const BELT = (() => {
    const r = mulberry(9);
    return Array.from({ length: 170 }, () => ({ rad: 0.53 + r() * 0.05, ang: r() * TAU }));
  })();
  const planetPos = (p, t) => {
    const ang = p.phase + t * p.speed;
    return [Math.cos(ang) * p.a, Math.sin(ang) * p.a];
  };

  const solarScene = {
    name: 'Solar System',
    K: 0.72 / 0.027,
    anchor: (t) => planetPos(PLANETS[2], t),
    draw(v, t) {
      if (!onScreen(v.x, v.y, v.s * 1.2)) return;
      const L = labelFx(v), fs = fontBase() * L.k;
      const P = (x, y) => [v.x + x * v.s, v.y + y * v.s];

      // Orbits
      PLANETS.forEach((p, i) => {
        seed(100 + i);
        const rr = p.a * v.s;
        if (!onScreen(v.x, v.y, rr)) return;
        if (rr > Math.hypot(W, H) * 3) return;
        stroke(circlePts(v.x, v.y, rr, clamp(Math.round(rr / 6), 24, 120)), { closed: true, width: 1.4, a: 0.35, dash: [5, 8], j: 1 });
      });

      // Asteroid belt
      seed(120);
      alpha(0.55);
      ctx.fillStyle = '#8d99ae';
      ctx.beginPath();
      BELT.forEach((b) => {
        const ang = b.ang + t * 0.04;
        const x = v.x + Math.cos(ang) * b.rad * v.s + jit(0.6), y = v.y + Math.sin(ang) * b.rad * v.s + jit(0.6);
        if (x < -5 || x > W + 5 || y < -5 || y > H + 5) return;
        ctx.moveTo(x + 1.4, y);
        ctx.arc(x, y, 1.4, 0, TAU);
      });
      ctx.fill();

      // Sun with wiggly rays and a smile
      const Rs = 0.1 * v.s;
      if (onScreen(v.x, v.y, Rs * 1.7)) {
        seed(130);
        for (let i = 0; i < 14; i++) {
          const ang = (i / 14) * TAU + t * 0.15;
          const r0 = Rs * 1.22, r1 = Rs * (i % 2 ? 1.5 : 1.7);
          const pts = [];
          for (let k = 0; k <= 4; k++) {
            const rr = r0 + ((r1 - r0) * k) / 4, wob = Math.sin(k * 2 + t * 3) * 0.05;
            pts.push([v.x + Math.cos(ang + wob) * rr, v.y + Math.sin(ang + wob) * rr]);
          }
          stroke(pts, { color: '#f77f00', width: 3, j: 1 });
        }
        seed(131);
        circ(v.x, v.y, Rs, { fill: '#ffd166', wash: 0.9, hatchColor: '#f77f00', spacing: 6, width: 2.8 });
        if (Rs > 22) {
          const e = Rs * 0.07;
          seed(132);
          circ(v.x - Rs * 0.32, v.y - Rs * 0.15, e, { dot: INK, stroke: INK, fill: INK, wash: 1, passes: 1 });
          circ(v.x + Rs * 0.32, v.y - Rs * 0.15, e, { dot: INK, stroke: INK, fill: INK, wash: 1, passes: 1 });
          stroke(ellipsePts(v.x, v.y + Rs * 0.1, Rs * 0.35, Rs * 0.28, 0, 8, 0.3, Math.PI - 0.3), { width: 2.4, j: 0.6 });
        }
      }

      // "You are here" for Earth goes on the side away from the Sun
      const [ex, ey] = planetPos(PLANETS[2], t);
      const [sx, sy] = P(ex, ey);
      const d = Math.hypot(ex, ey), ox = ex / d, oy = ey / d;
      const youTxt = 'Earth (you!)';
      const co = planCallout(youTxt, sx, sy, ox, oy, clamp(v.s * 0.26, 50, 120), fs);

      // Planets
      PLANETS.forEach((p, i) => {
        const [px, py] = P(...planetPos(p, t));
        const pr = Math.max(p.r * v.s, 3.5);
        if (!onScreen(px, py, pr * 2.2)) return;
        seed(140 + i);
        if (p.ring) stroke(ellipsePts(px, py, pr * 2, pr * 0.6, -0.35, 28, Math.PI, TAU), { width: 2, color: '#bc6c25' });
        circ(px, py, pr, { fill: p.c, wash: 0.95, hatchColor: INK, spacing: 4, angle: 0.8, width: 2, passes: 1, dot: p.c });
        if (p.stripes && pr > 8) {
          stroke([[px - pr * 0.9, py - pr * 0.25], [px, py - pr * 0.35], [px + pr * 0.9, py - pr * 0.25]], { color: '#9c6644', width: 2 });
          stroke([[px - pr * 0.85, py + pr * 0.35], [px, py + pr * 0.25], [px + pr * 0.85, py + pr * 0.35]], { color: '#9c6644', width: 2 });
        }
        if (p.ring) stroke(ellipsePts(px, py, pr * 2, pr * 0.6, -0.35, 28, 0, Math.PI), { width: 2, color: '#bc6c25' });
        const ny = py + pr + fs * 0.65;
        const clash = Math.abs(px - co.cx) < co.w / 2 + fs * 1.5 && Math.abs(ny - co.ty) < fs * 1.1;
        if (p.n !== 'Earth' && !clash) label(p.n, px, ny, { size: fs * 0.8, a: L.a * 0.85 });
      });

      if (L.a > 0.01) {
        seed(150);
        circ(sx, sy, Math.max(PLANETS[2].r * v.s, 3.5) + 7, { stroke: RED, width: 2, passes: 1, a: L.a });
        drawCallout(youTxt, sx, sy, 14, co, { color: RED, a: L.a, size: fs });
      }
    },
  };

  // ---------------------------------------------------------------------------
  // Scene 3: the Milky Way
  // ---------------------------------------------------------------------------
  const STAR_COLORS = ['#7b2cbf', '#4361ee', '#4cc9f0', '#f72585', '#2b2d42', '#ffb703'];
  const GALAXY = (() => {
    const r = mulberry(42);
    const groups = STAR_COLORS.map(() => []);
    const add = (rad, ang) => groups[Math.floor(r() * STAR_COLORS.length)].push({ rad, ang, s: 0.7 + r() * 1.7, plus: r() < 0.08 });
    for (let k = 0; k < 4; k++) {
      const a0 = (k * Math.PI) / 2, count = k % 2 ? 260 : 440;
      for (let i = 0; i < count; i++) {
        const t = r();
        const rad = 0.12 + 0.88 * t;
        const ang = a0 + Math.log(rad / 0.12) * 2.3;
        add(Math.abs(rad + gauss(r) * 0.05), ang + gauss(r) * 0.2 * (1 - t * 0.4));
      }
    }
    for (let i = 0; i < 380; i++) add(Math.sqrt(r()) * 1.02, r() * TAU);
    for (let i = 0; i < 260; i++) add(Math.abs(gauss(r)) * 0.14, r() * TAU);
    return groups;
  })();
  const GAL_SPIN = 0.01;
  const SUN_R = 0.56, SUN_A = -0.25;
  const sunInGalaxy = (t) => [Math.cos(SUN_A + t * GAL_SPIN) * SUN_R, Math.sin(SUN_A + t * GAL_SPIN) * SUN_R];

  const galaxyScene = {
    name: 'Milky Way',
    K: 50,
    anchor: sunInGalaxy,
    draw(v, t) {
      if (!onScreen(v.x, v.y, v.s * 1.1)) return;
      const L = labelFx(v), fs = fontBase() * L.k;
      const rot = t * GAL_SPIN;

      // Soft marker strokes along the spiral arms
      for (let k = 0; k < 4; k++) {
        const pts = [];
        for (let i = 0; i <= 24; i++) {
          const rad = 0.12 + 0.88 * (i / 24);
          const ang = (k * Math.PI) / 2 + Math.log(rad / 0.12) * 2.3 + rot;
          pts.push([v.x + Math.cos(ang) * rad * v.s, v.y + Math.sin(ang) * rad * v.s]);
        }
        seed(200 + k);
        stroke(pts, { color: k % 2 ? '#bde0fe' : '#d8c8ff', width: Math.min((k % 2 ? 0.07 : 0.11) * v.s, 400), a: 0.55, j: 2 });
      }

      // Glowing bulge
      seed(210);
      circ(v.x, v.y, 0.17 * v.s, { fill: '#ffe29a', wash: 0.8, stroke: null });
      const scribble = [];
      for (let i = 0; i <= 70; i++) {
        const u = i / 70, ang = u * TAU * 5 + t * 0.4;
        scribble.push([v.x + Math.cos(ang) * u * 0.14 * v.s, v.y + Math.sin(ang) * u * 0.14 * v.s]);
      }
      stroke(scribble, { color: '#f4a261', width: 2.2, a: 0.8, j: 1.5 });

      // Stars
      seed(220);
      GALAXY.forEach((group, gi) => {
        ctx.fillStyle = STAR_COLORS[gi];
        ctx.strokeStyle = STAR_COLORS[gi];
        ctx.lineWidth = 1.3;
        alpha(0.85);
        const dots = new Path2D(), pluses = new Path2D();
        for (const s of group) {
          const ang = s.ang + rot;
          const x = v.x + Math.cos(ang) * s.rad * v.s + jit(0.5), y = v.y + Math.sin(ang) * s.rad * v.s + jit(0.5);
          if (x < -5 || x > W + 5 || y < -5 || y > H + 5) continue;
          if (s.plus) {
            const q = s.s * 2.2;
            pluses.moveTo(x - q, y); pluses.lineTo(x + q, y);
            pluses.moveTo(x, y - q); pluses.lineTo(x, y + q);
          } else {
            dots.moveTo(x + s.s, y);
            dots.arc(x, y, s.s, 0, TAU);
          }
        }
        ctx.fill(dots);
        ctx.stroke(pluses);
      });

      // Where the Sun is
      const [sx0, sy0] = sunInGalaxy(t);
      const sx = v.x + sx0 * v.s, sy = v.y + sy0 * v.s;
      seed(230);
      circ(sx, sy, Math.max(0.02 * v.s, 3.5), { fill: '#ffd166', wash: 1, stroke: INK, width: 2, passes: 1, dot: '#f77f00' });
      if (L.a > 0.01) {
        circ(sx, sy, Math.max(0.02 * v.s, 3.5) + 9, { stroke: RED, width: 2, passes: 1, a: L.a });
        const d = Math.hypot(sx0, sy0), ox = sx0 / d, oy = sy0 / d;
        const txt = 'our Sun lives here';
        const co = planCallout(txt, sx, sy, ox, oy, clamp(v.s * 0.3, 50, 120), fs);
        drawCallout(txt, sx, sy, 16, co, { color: RED, a: L.a, size: fs, bend: -0.25 });
      }

      // Galactic centre callout + scale bar
      if (L.a > 0.01) {
        seed(240);
        const cx = v.x - v.s * 0.62, cy = v.y - v.s * 0.92;
        label('supermassive black hole!', cx, cy, { size: fs * 0.8, a: L.a, rot: -0.04 });
        arrow(cx + fs * 0.5, cy + fs * 0.6, v.x - 0.05 * v.s, v.y - 0.06 * v.s, { a: L.a * 0.8, bend: 0.25, width: 1.8 });
        const y = v.y + v.s * 1.1;
        stroke([[v.x - v.s, y], [v.x + v.s, y]], { width: 2, a: L.a * 0.8 });
        stroke([[v.x - v.s, y - 7], [v.x - v.s, y + 7]], { width: 2, a: L.a * 0.8 });
        stroke([[v.x + v.s, y - 7], [v.x + v.s, y + 7]], { width: 2, a: L.a * 0.8 });
        label('~100,000 light-years', v.x, y - fs * 0.6, { size: fs * 0.85, a: L.a * 0.9 });
      }
    },
  };

  // ---------------------------------------------------------------------------
  // Scene 4: the (observable) Universe
  // ---------------------------------------------------------------------------
  const GAL_COLORS = ['#7b2cbf', '#4361ee', '#f72585', '#2a9d8f', '#e76f51', '#3a0ca3'];
  const UNIVERSE = (() => {
    const r = mulberry(7);
    const mk = (x, y, extra = {}) => ({
      x, y, s: 0.011 + r() * 0.018, rot: r() * TAU, spin: (r() - 0.5) * 0.4,
      spiral: r() < 0.6, c: GAL_COLORS[Math.floor(r() * GAL_COLORS.length)], tw: r() * TAU, ...extra,
    });
    const nodes = [
      mk(0, 0, { s: 0.02, spiral: true, c: '#7b2cbf', mw: true, spin: 0.3 }),
      mk(0.075, -0.045, { s: 0.017, spiral: true, c: '#4361ee', name: 'Andromeda' }),
    ];
    let tries = 0;
    while (nodes.length < 80 && tries++ < 2000) {
      const x = (r() * 2 - 1) * 1.7, y = (r() * 2 - 1) * 1.3;
      if (Math.hypot(x, y) < 0.22) continue;
      if (nodes.some((n) => Math.hypot(n.x - x, n.y - y) < 0.1)) continue;
      nodes.push(mk(x, y));
      // Clumps of galaxies = clusters
      if (r() < 0.35) {
        const m = 2 + Math.floor(r() * 3);
        for (let i = 0; i < m; i++) nodes.push(mk(x + gauss(r) * 0.05, y + gauss(r) * 0.05, { s: 0.007 + r() * 0.01, cluster: true }));
      }
    }
    const edges = [];
    const seen = new Set();
    nodes.forEach((a, i) => {
      if (a.cluster) return;
      nodes
        .map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.y - b.y), b }))
        .filter((e) => e.j !== i && !e.b.cluster && e.d < 0.6)
        .sort((p, q) => p.d - q.d)
        .slice(0, 3)
        .forEach(({ j }) => {
          const key = i < j ? `${i}-${j}` : `${j}-${i}`;
          if (!seen.has(key)) { seen.add(key); edges.push([i, j]); }
        });
    });
    const dust = [];
    edges.forEach(([i, j]) => {
      const a = nodes[i], b = nodes[j];
      for (let k = 0; k < 9; k++) {
        const u = r();
        dust.push([a.x + (b.x - a.x) * u + gauss(r) * 0.018, a.y + (b.y - a.y) * u + gauss(r) * 0.018]);
      }
    });
    return { nodes, edges, dust };
  })();

  function miniGalaxy(x, y, rr, g, t, a) {
    const rot = g.rot + t * g.spin;
    if (rr < 2.5) { alpha(a); ctx.fillStyle = g.c; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, TAU); ctx.fill(); return; }
    if (g.spiral) {
      circ(x, y, rr * 0.3, { fill: '#ffd166', wash: 0.9, stroke: g.c, width: 1.6, passes: 1, a, n: 8, dot: g.c });
      for (let k = 0; k < 2; k++) {
        const pts = [];
        for (let i = 0; i <= 7; i++) {
          const u = i / 7, ang = rot + k * Math.PI + u * 2.6, rad = rr * (0.3 + 0.8 * u);
          pts.push([x + Math.cos(ang) * rad, y + Math.sin(ang) * rad * 0.8]);
        }
        stroke(pts, { color: g.c, width: clamp(rr * 0.12, 1.4, 3), a, j: 0.6 });
      }
    } else {
      blob(ellipsePts(x, y, rr, rr * 0.6, rot, 12).slice(0, 12), { fill: g.c, wash: 0.35, stroke: g.c, width: 1.6, passes: 1, a, j: 0.6 });
    }
  }

  const universeScene = {
    name: 'Universe',
    K: 50,
    anchor: () => [0, 0],
    draw(v, t) {
      const L = labelFx(v), fs = fontBase() * L.k;
      const pos = (n, i) => {
        if (n.mw) return [v.x, v.y];
        const bob = 0.004;
        return [v.x + (n.x + Math.sin(t * 0.3 + i) * bob) * v.s, v.y + (n.y + Math.cos(t * 0.27 + i * 1.7) * bob) * v.s];
      };
      const fade = (n) => (Math.hypot(n.x, n.y) > 1 ? 0.35 : 1);
      const { nodes, edges, dust } = UNIVERSE;
      const P = nodes.map(pos);

      // Cosmic web filaments
      edges.forEach(([i, j], k) => {
        const a = P[i], b = P[j];
        if (!onScreen((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.hypot(a[0] - b[0], a[1] - b[1]) / 2)) return;
        seed(300 + k);
        const pts = [];
        for (let s = 0; s <= 4; s++) pts.push([a[0] + ((b[0] - a[0]) * s) / 4, a[1] + ((b[1] - a[1]) * s) / 4]);
        stroke(pts, { color: '#b392f0', width: clamp(v.s * 0.008, 1.2, 6), a: 0.45 * Math.min(fade(nodes[i]), fade(nodes[j])), j: 2 });
      });
      seed(299);
      alpha(0.4);
      ctx.fillStyle = '#9d4edd';
      ctx.beginPath();
      dust.forEach(([dx, dy]) => {
        const x = v.x + dx * v.s + jit(0.5), y = v.y + dy * v.s + jit(0.5);
        if (x < -5 || x > W + 5 || y < -5 || y > H + 5) return;
        ctx.moveTo(x + 1.2, y);
        ctx.arc(x, y, 1.2, 0, TAU);
      });
      ctx.fill();

      // Galaxies
      nodes.forEach((n, i) => {
        const [x, y] = P[i], rr = n.s * v.s;
        if (!onScreen(x, y, rr + 4)) return;
        seed(400 + i);
        miniGalaxy(x, y, rr, n, t, fade(n) * (0.75 + 0.25 * Math.sin(t * 1.5 + n.tw)));
      });

      // Edge of the observable universe (centred on us!) and the Big Bang afterglow
      seed(500);
      stroke(circlePts(v.x, v.y, v.s, 90), { closed: true, color: '#e76f51', width: 2.5, dash: [10, 9], a: 0.9 });
      const cmb = [];
      for (let i = 0; i < 160; i++) {
        const ang = (i / 160) * TAU, rad = v.s * (1.06 + 0.012 * Math.sin(i * 0.9 + t * 2));
        cmb.push([v.x + Math.cos(ang) * rad, v.y + Math.sin(ang) * rad]);
      }
      stroke(cmb, { closed: true, color: '#f4a261', width: 2, a: 0.6, j: 1 });

      if (L.a > 0.01) {
        seed(510);
        const mwR = Math.max(0.02 * v.s, 3);
        circ(v.x, v.y, mwR + 10, { stroke: RED, width: 2.2, passes: 1, a: L.a });
        const lx = v.x - clamp(v.s * 0.28, 60, 140), ly = v.y + clamp(v.s * 0.26, 55, 120);
        arrow(lx, ly, v.x - mwR - 8, v.y + mwR + 6, { color: RED, a: L.a, bend: 0.3 });
        label('Milky Way (us!)', lx, ly + fs * 0.7, { size: fs, color: RED, a: L.a });
        const an = P[1];
        label('Andromeda', an[0] + fs * 2.4, an[1] - fs * 0.3, { size: fs * 0.75, a: L.a * 0.85 });

        label('edge of the observable universe', v.x, v.y - v.s * 0.93, { size: fs * 0.9, color: '#e76f51', a: L.a });
        label('Big Bang afterglow', v.x + v.s * 0.8, v.y + v.s * 0.83, { size: fs * 0.8, color: '#bc6c25', a: L.a, rot: -0.7 });

        // Point at a filament
        const [i, j] = UNIVERSE.edges.find(([a, b]) => {
          const m = [(nodes[a].x + nodes[b].x) / 2, (nodes[a].y + nodes[b].y) / 2];
          return m[0] > 0.3 && m[0] < 0.75 && m[1] < -0.25 && m[1] > -0.7;
        }) || UNIVERSE.edges[0];
        const mx = (P[i][0] + P[j][0]) / 2, my = (P[i][1] + P[j][1]) / 2;
        arrow(mx + fs * 2.2, my + fs * 2.4, mx + 4, my + 4, { color: '#7b2cbf', a: L.a, bend: 0.25 });
        label('the cosmic web', mx + fs * 2.6, my + fs * 3.1, { size: fs * 0.9, color: '#7b2cbf', a: L.a, fit: true });
      }
    },
  };

  const SCENES = [bangkokScene, thailandScene, asiaScene, earthScene, solarScene, galaxyScene, universeScene];
  const EARTH = SCENES.indexOf(earthScene);

  // ---------------------------------------------------------------------------
  // Background doodle stars (screen-space, gently twinkling)
  // ---------------------------------------------------------------------------
  const BG = (() => {
    const r = mulberry(3);
    return Array.from({ length: 60 }, () => ({ x: r(), y: r(), s: 3 + r() * 5, ph: r() * TAU, sparkle: r() < 0.45 }));
  })();
  function drawBackground(t) {
    seed(1);
    BG.forEach((b) => {
      const x = b.x * W, y = b.y * H, a = 0.25 + 0.2 * Math.sin(t * 1.3 + b.ph);
      if (b.sparkle) {
        stroke([[x - b.s, y], [x + b.s, y]], { color: '#8d99ae', width: 1.5, a, j: 0.6 });
        stroke([[x, y - b.s], [x, y + b.s]], { color: '#8d99ae', width: 1.5, a, j: 0.6 });
      } else {
        alpha(a); ctx.fillStyle = '#8d99ae'; ctx.beginPath(); ctx.arc(x, y, 1.4, 0, TAU); ctx.fill();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Camera: `pos` glides between integer steps; between step i and i+1 we zoom
  // out from the anchor (the previous world) while crossfading the scenes.
  // ---------------------------------------------------------------------------
  // The page scrolls, and the scroll position drives the zoom: every STEP
  // pixels of scrolling is one step outwards. `pos` eases after it.
  let pos = 0, T = 0, last = performance.now(), STEP = 800;
  const scroller = document.getElementById('scroller');
  const scrollPos = () => clamp(window.scrollY / STEP, 0, SCENES.length - 1);

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    A = 1;
    drawBackground(T);

    const i = Math.min(Math.floor(pos), SCENES.length - 1);
    const p = pos - i;
    if (p < 1e-4 || i === SCENES.length - 1) {
      A = 1;
      SCENES[i].draw({ x: C.x, y: C.y, s: U }, T);
      return;
    }
    const next = SCENES[i + 1];
    const e = ease(p);
    const z = Math.pow(next.K, 1 - e);
    const an = next.anchor(T);
    const fx = an[0] * (1 - e / z), fy = an[1] * (1 - e / z);
    const vN = { x: C.x - z * U * fx, y: C.y - z * U * fy, s: z * U };
    const vP = { x: vN.x + an[0] * vN.s, y: vN.y + an[1] * vN.s, s: vN.s / next.K };

    A = smooth(0.08, 0.5, e);
    if (A > 0.01) next.draw(vN, T);
    A = 1 - smooth(0.2, 0.62, e);
    if (A > 0.01) SCENES[i].draw(vP, T);
    A = 1;
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    T += dt;
    boil = Math.floor(T * (reducedMotion ? 2 : 7)) % 4;

    tickSettle(now);
    tickScrollTween(now);
    const sp = scrollPos();

    // Earth spins freely from the Earth step outwards. Heading back in towards
    // Asia, it first swings round so that Bangkok faces us.
    let aligned = true;
    if (pos >= EARTH && sp >= EARTH) {
      spin += dt * 0.22;
    } else {
      let d = (((spin - BKK_ROT) % TAU) + TAU) % TAU;
      if (d > Math.PI) d -= TAU;
      spin -= Math.abs(d) < 0.003 ? d : d * Math.min(1, dt * 4);
      aligned = Math.abs(d) < 0.02;
    }
    const from = pos;
    pos = reducedMotion || Math.abs(sp - pos) < 0.0005 ? sp : pos + (sp - pos) * Math.min(1, dt * 7);
    if (!aligned && from >= EARTH && pos < EARTH) pos = EARTH; // wait for Bangkok to come round
    tickAuto(dt);
    render();
    syncUI();
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  const STEPS = [
    {
      title: 'Bangkok',
      text: 'This is where we live! A buzzing city on the <b>Chao Phraya River</b>, full of golden temples, tuk-tuks and street food, with more than <b>10 million people</b> in the metro area.',
      scale: 'The city is roughly 50 km across.',
    },
    {
      title: 'Thailand',
      text: 'Zoom out and Bangkok is a dot at the top of the <b>Gulf of Thailand</b>. Thailand covers about <b>513,000 km²</b> and is home to around <b>70 million people</b>. Some say its map looks like an elephant\'s head.',
      scale: 'About 1,600 km from north to south.',
    },
    {
      title: 'Asia',
      text: 'Thailand sits in Southeast Asia. Asia is the <b>biggest continent</b>: about 44 million km², with more than <b>4.7 billion people</b>, around 6 in every 10 humans.',
      scale: 'Asia covers about 30% of Earth\'s land.',
    },
    {
      title: 'Planet Earth',
      text: 'Our home! A rocky, watery ball about <b>12,742 km</b> across, with the Moon tagging along <b>384,400 km</b> away. Everyone you have ever met lives on this dot.',
      scale: 'Light zips around it in about 0.13 seconds.',
    },
    {
      title: 'The Solar System',
      text: 'Zoom out and Earth becomes a tiny blue speck, the 3rd of <b>8 planets</b> circling the Sun. Sunlight takes about <b>8 minutes</b> to reach us.',
      scale: 'Light needs ~8 hours to cross Neptune\'s orbit. (Sizes not to scale!)',
    },
    {
      title: 'The Milky Way',
      text: 'Our Sun is just one of <b>100 to 400 billion stars</b> in a spiral galaxy. We live out in the Orion Arm and take <b>~230 million years</b> to go around once.',
      scale: 'About 100,000 light-years across.',
    },
    {
      title: 'The Universe',
      text: 'The Milky Way is one of <b>hundreds of billions of galaxies</b>, strung along a giant cosmic web. The part we can see is about <b>93 billion light-years</b> wide, and it is still expanding.',
      scale: 'The observable universe is centred on wherever you stand. Hi!',
    },
  ];

  const $ = (id) => document.getElementById(id);
  const card = $('card'), backBtn = $('back'), nextBtn = $('next'), autoBtn = $('auto');
  const stepBtns = SCENES.map((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = s.name;
    b.addEventListener('click', () => { stopAuto(); go(i); });
    $('steps').appendChild(b);
    return b;
  });

  let shown = -1, swapTimer = 0;
  function showCard(i) {
    shown = i;
    clearTimeout(swapTimer);
    card.classList.add('swap');
    swapTimer = setTimeout(() => {
      $('kicker').textContent = `Step ${i + 1} of ${STEPS.length}`;
      $('title').textContent = STEPS[i].title;
      $('text').innerHTML = STEPS[i].text;
      $('scale').textContent = STEPS[i].scale;
      card.classList.remove('swap');
    }, shown === 0 && !card.dataset.ready ? 0 : 220);
    card.dataset.ready = '1';
  }

  const hint = $('hint');
  function syncUI() {
    const cur = Math.round(pos), at = Math.round(scrollPos());
    if (cur !== shown) showCard(cur);
    stepBtns.forEach((b, i) => (i === at ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')));
    backBtn.disabled = at === 0;
    const atEnd = at === SCENES.length - 1;
    const label = atEnd ? '\u21BA Start over' : 'Zoom out \u2192';
    if (nextBtn.textContent !== label) nextBtn.textContent = label;
    hint.classList.toggle('gone', window.scrollY > 30);
  }

  // Buttons, keys and the auto tour glide the page to a step at a gentle,
  // zoom-friendly pace (native smooth scrolling is too quick for this).
  let tween = null;
  function scrollToStep(i) {
    i = clamp(i, 0, SCENES.length - 1);
    const from = window.scrollY, to = i * STEP;
    const dist = Math.abs(to - from) / STEP;
    if (dist < 0.001) return;
    const dur = reducedMotion ? 1 : 1000 * clamp(2.4 * Math.sqrt(dist), 1.2, 6);
    tween = { from, to, start: performance.now(), dur };
  }
  function endTween() { tween = null; }

  // When hands-on scrolling pauses partway through a zoom, finish the zoom in
  // the direction the reader was going (or back, if they barely started).
  let lastY = 0, dir = 1, idle = 0;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (!tween && y !== lastY) { dir = Math.sign(y - lastY) || dir; idle = performance.now(); }
    lastY = y;
  }, { passive: true });
  function tickSettle(now) {
    if (tween || !idle || now - idle < 350 || touching) return;
    idle = 0;
    const sp = scrollPos(), base = Math.floor(sp), frac = sp - base;
    if (frac < 0.002 || frac > 0.998) return;
    const goal = dir > 0 ? (frac > 0.12 ? base + 1 : base) : (frac < 0.88 ? base : base + 1);
    const from = window.scrollY, to = goal * STEP;
    tween = { from, to, start: now, dur: 1000 * clamp(2.4 * (Math.abs(to - from) / STEP), 0.35, 2.4) };
  }
  let touching = false;
  window.addEventListener('touchstart', () => { touching = true; }, { passive: true });
  window.addEventListener('touchend', () => { touching = false; idle = performance.now(); }, { passive: true });
  function tickScrollTween(now) {
    if (!tween) return;
    const u = clamp((now - tween.start) / tween.dur, 0, 1);
    window.scrollTo(0, tween.from + (tween.to - tween.from) * ease(u));
    if (u >= 1) endTween();
  }
  // Any hands-on scrolling takes over from a running glide.
  ['wheel', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => { if (tween) endTween(); stopAuto(); }, { passive: true }));

  const current = () => Math.round(scrollPos());
  function go(i) { scrollToStep(i); }
  function next() { go(current() === SCENES.length - 1 ? 0 : current() + 1); }
  function back() { go(current() - 1); }

  let auto = false, autoWait = 0;
  function stopAuto() { auto = false; autoBtn.setAttribute('aria-pressed', 'false'); autoBtn.innerHTML = '&#9654; Auto tour'; }
  function startAuto() { auto = true; autoWait = 1.2; autoBtn.setAttribute('aria-pressed', 'true'); autoBtn.innerHTML = '&#10074;&#10074; Pause'; }
  function tickAuto(dt) {
    if (!auto || tween || Math.abs(pos - scrollPos()) > 0.01) return;
    autoWait -= dt;
    if (autoWait <= 0) { next(); autoWait = current() === SCENES.length - 1 ? 3 : 6.5; }
  }

  nextBtn.addEventListener('click', () => { stopAuto(); next(); });
  backBtn.addEventListener('click', () => { stopAuto(); back(); });
  autoBtn.addEventListener('click', () => (auto ? stopAuto() : startAuto()));
  canvas.addEventListener('click', () => { stopAuto(); if (current() < SCENES.length - 1) next(); });

  window.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('button') && (e.key === ' ' || e.key === 'Enter')) return;
    if (['ArrowRight', 'ArrowDown', ' ', 'PageDown'].includes(e.key)) { e.preventDefault(); stopAuto(); if (current() < SCENES.length - 1) next(); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); stopAuto(); back(); }
    else if (e.key === 'Home') { e.preventDefault(); stopAuto(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); stopAuto(); go(SCENES.length - 1); }
  });

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    const top = $('top').getBoundingClientRect().bottom;
    const bottom = H - $('panel').getBoundingClientRect().top;
    const avail = Math.max(120, H - top - bottom);
    C.x = W / 2;
    C.y = top + avail / 2;
    U = Math.max(70, Math.min(W * 0.43, avail * 0.44));

    // Scroll length per step. Mobile browsers change innerHeight as the URL bar
    // shows/hides, so only re-measure on big changes to keep the zoom steady.
    const step = Math.max(500, Math.round(H * 1.1));
    if (Math.abs(step - STEP) > 150 || !scroller.style.height) {
      const p = window.scrollY / STEP;
      STEP = step;
      scroller.style.height = `${(SCENES.length - 1) * STEP + H}px`;
      window.scrollTo(0, p * STEP);
    }
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe($('panel'));
  resize();
  requestAnimationFrame(frame);
})();
