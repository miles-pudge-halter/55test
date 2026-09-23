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
    let { color = INK, spacing = 6, angle = -0.8, width = 1.2, a = 0.7 } = o;
    if (r > 1500) spacing *= r / 1500;
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
    const { size = 20, color = INK, align = 'center', a = 1, rot = 0, fit = false } = o;
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
    label(text, c.tx, c.ty, { align: c.align, size: o.size, color: o.color, a: o.a });
  }

  // Labels shrink with their scene and vanish when it is tiny or huge.
  const labelFx = (v) => {
    const k = v.s / U;
    return { k: clamp(k, 0.5, 1.2), a: smooth(0.3, 0.6, k) * (1 - smooth(2.5, 4, k)) };
  };
  const fontBase = () => clamp(U * 0.1, 16, 26);

  // ---------------------------------------------------------------------------
  // Scene 1: Earth
  // ---------------------------------------------------------------------------
  const CONTINENTS = [
    // North America
    [[-165, 65], [-140, 70], [-100, 72], [-75, 65], [-60, 50], [-80, 30], [-97, 18], [-85, 10], [-105, 22], [-118, 33], [-125, 48], [-150, 58]],
    // Greenland
    [[-50, 60], [-20, 70], [-25, 82], [-60, 80]],
    // South America
    [[-80, 10], [-60, 8], [-35, -7], [-40, -22], [-58, -38], [-70, -54], [-75, -40], [-72, -18], [-81, -5]],
    // Africa
    [[-17, 21], [-5, 35], [10, 37], [32, 31], [43, 12], [51, 11], [40, -15], [32, -28], [20, -35], [12, -18], [8, 4], [-8, 5], [-17, 14]],
    // Eurasia
    [[-10, 36], [-9, 43], [0, 50], [10, 58], [25, 70], [60, 72], [100, 77], [140, 72], [170, 66], [160, 60], [140, 50], [122, 40], [120, 25], [105, 10], [100, 2], [80, 8], [72, 20], [57, 25], [48, 30], [35, 36], [26, 40], [15, 40], [3, 42]],
    // Australia
    [[114, -22], [130, -12], [142, -11], [153, -27], [146, -39], [135, -35], [115, -34]],
  ];
  const ICE = Array.from({ length: 12 }, (_, i) => [i * 30, 76 + (i % 2) * 4]);
  const CLOUDS = [[-40, 20, 50], [60, -10, 40], [150, 35, 45], [-130, -25, 55], [10, 55, 35]];

  const TILT = 0.4;
  function project(lon, lat, rot) {
    const l = (lon * Math.PI) / 180 - rot, p = (lat * Math.PI) / 180;
    let x = Math.cos(p) * Math.sin(l);
    let y = Math.cos(TILT) * Math.sin(p) - Math.sin(TILT) * Math.cos(p) * Math.cos(l);
    const z = Math.sin(TILT) * Math.sin(p) + Math.cos(TILT) * Math.cos(p) * Math.cos(l);
    if (z < 0) { const m = Math.hypot(x, y) || 1; x /= m; y /= m; } // pin hidden points to the rim
    return [x, -y, z];
  }

  function stickFigure(x, y, h, t) {
    const head = h * 0.18;
    const hip = [x, y - h * 0.42], neck = [x, y - h * 0.78];
    const wave = Math.sin(t * 6) * 0.5;
    const w = clamp(h * 0.08, 1.6, 2.6);
    stroke([[x - h * 0.16, y], hip, [x + h * 0.16, y]], { width: w, j: 0.5 });
    stroke([hip, neck], { width: w, j: 0.5 });
    stroke([[x - h * 0.3, y - h * 0.55], [x, y - h * 0.7]], { width: w, j: 0.5 });
    stroke([[x, y - h * 0.7], [x + Math.cos(-1.1 + wave) * h * 0.35, y - h * 0.7 + Math.sin(-1.1 + wave) * h * 0.35]], { width: w, j: 0.5 });
    circ(x, y - h * 0.78 - head, head, { fill: '#ffe8d6', wash: 1, stroke: INK, width: w, passes: 1, j: 0.5, n: 10 });
  }

  const earthScene = {
    name: 'Earth',
    draw(v, t) {
      const R = 0.72 * v.s, cx = v.x, cy = v.y;
      if (!onScreen(cx, cy, R * 1.8)) return;
      const rot = t * 0.22;
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
      CONTINENTS.forEach((poly, i) => {
        const pr = poly.map(([lo, la]) => project(lo, la, rot));
        if (Math.max(...pr.map((p) => p[2])) < 0.05) return;
        seed(20 + i);
        blob(pr.map((p) => [cx + p[0] * R, cy + p[1] * R]), {
          fill: '#b7e4c7', wash: 0.95, hatchColor: '#2d6a4f', spacing: 5, angle: 0.7, stroke: '#2d6a4f', width: 2, passes: 1,
        });
      });
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

      // A tiny person waving from the top of the world
      if (R > 50) {
        seed(33);
        stickFigure(cx, cy - R + 2, clamp(R * 0.17, 12, 34), t);
        const lx = cx + R * 0.55, ly = cy - R * 1.12 - fs;
        label('you are here!', lx + fs * 1.4, ly - fs * 0.2, { size: fs, color: RED, a: L.a, rot: -0.05 });
        seed(34);
        if (L.a > 0.01) arrow(lx, ly + fs * 0.4, cx + R * 0.08, cy - R - clamp(R * 0.1, 8, 20), { color: RED, bend: -0.3, a: L.a });
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

  const SCENES = [earthScene, solarScene, galaxyScene, universeScene];

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
  let pos = 0, target = 0, T = 0, last = performance.now();

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

    if (pos !== target) {
      const rate = (reducedMotion ? 2.5 : 1 / 2.6) * Math.max(1, Math.abs(target - pos));
      const stepAmt = rate * dt;
      pos = Math.abs(target - pos) <= stepAmt ? target : pos + Math.sign(target - pos) * stepAmt;
    }
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

  function syncUI() {
    const cur = Math.round(pos);
    if (cur !== shown) showCard(cur);
    stepBtns.forEach((b, i) => (i === target ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')));
    backBtn.disabled = target === 0;
    const atEnd = target === SCENES.length - 1;
    const label = atEnd ? '↺ Start over' : 'Zoom out →';
    if (nextBtn.textContent !== label) nextBtn.textContent = label;
  }

  function go(i) { target = clamp(i, 0, SCENES.length - 1); }
  function next() { go(target === SCENES.length - 1 ? 0 : target + 1); }
  function back() { go(target - 1); }

  let auto = false, autoWait = 0;
  function stopAuto() { auto = false; autoBtn.setAttribute('aria-pressed', 'false'); autoBtn.innerHTML = '&#9654; Auto tour'; }
  function startAuto() { auto = true; autoWait = 1.2; autoBtn.setAttribute('aria-pressed', 'true'); autoBtn.innerHTML = '&#10074;&#10074; Pause'; }
  function tickAuto(dt) {
    if (!auto || pos !== target) return;
    autoWait -= dt;
    if (autoWait <= 0) { next(); autoWait = target === 0 ? 3 : 6.5; }
  }

  nextBtn.addEventListener('click', () => { stopAuto(); next(); });
  backBtn.addEventListener('click', () => { stopAuto(); back(); });
  autoBtn.addEventListener('click', () => (auto ? stopAuto() : startAuto()));
  canvas.addEventListener('click', () => { stopAuto(); if (target < SCENES.length - 1) next(); });

  window.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('button') && (e.key === ' ' || e.key === 'Enter')) return;
    if (['ArrowRight', 'ArrowDown', ' ', 'PageDown'].includes(e.key)) { e.preventDefault(); stopAuto(); if (target < SCENES.length - 1) next(); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); stopAuto(); back(); }
    else if (e.key === 'Home') { stopAuto(); go(0); }
    else if (e.key === 'End') { stopAuto(); go(SCENES.length - 1); }
  });

  let wheelLock = 0;
  window.addEventListener('wheel', (e) => {
    const now = performance.now();
    if (now < wheelLock || Math.abs(e.deltaY) < 8) return;
    wheelLock = now + 900;
    stopAuto();
    if (e.deltaY > 0) { if (target < SCENES.length - 1) next(); } else back();
  }, { passive: true });

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
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe($('panel'));
  resize();
  requestAnimationFrame(frame);
})();
