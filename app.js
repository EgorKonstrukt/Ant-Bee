/* ============================================================
   Ant & Bee — Langton's Ant (2D) + Bee (3D)
   Fast typed-array engine + WebGL hardware rendering.
   ============================================================ */
'use strict';

/* ---------------- utils ---------------- */
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');

function hexToRgb(hex) {
  hex = hex.trim();
  if (hex[0] === '#') hex = hex.slice(1);
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  const v = parseInt(hex, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
// cached glow tint (0-255 ints): parsed once per color change instead of
// twice per frame (updateTrail + draw) — string parsing in the frame loop
// is pure CPU burn with zero visual difference
let glowTintR = 255, glowTintG = 158, glowTintB = 80;
function syncGlowTint() {
  const t = hexToRgb(S.glowColor || '#FF9E50');
  glowTintR = t[0]; glowTintG = t[1]; glowTintB = t[2];
}
function genColor(i) {
  // golden-ratio hue, vivid, readable on dark stage
  const h = (i * 137.508) % 360;
  const s = 72, l = 58;
  return hslToHex(h, s, l);
}
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return ('#' + to(f(0)) + to(f(8)) + to(f(4))).toUpperCase();
}
let snackTimer = 0;
function snack(msg, ms = 2600) {
  const el = $('snackbar');
  $('snackbarText').textContent = msg;
  el.classList.add('show');
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ---------------- presets ---------------- */
const PRESETS_2D = [
  { name: 'Classic highway — LR', rule: 'LR', colors: ['#101014', '#FFFFFF'], desc: "Langton's original 1986 ant. Chaotic for ~10,000 steps, then builds the famous 104-step periodic highway." },
  { name: 'Symmetric growth — LLRR', rule: 'LLRR', colors: ['#101014', '#03DAC6', '#FF0266', '#FFEB3B'], desc: 'Textbook turmite: symmetric, ever-expanding colonies with a woven texture.' },
  { name: 'Chaotic growth — RLR', rule: 'RLR', colors: ['#101014', '#FF0266', '#03DAC6'], desc: 'Classic chaotic turmite — restless textured growth that never settles.' },
  { name: 'Textured square — LRRRRRLLR', rule: 'LRRRRRLLR', colors: null, desc: 'Builds a textured square over which new highways are repeatedly born and crash (Lutfalla, 2024).' },
  { name: 'Travelling triangle — LLRRRLRRRLLL', rule: 'LLRRRLRRRLLL', colors: null, desc: 'Grows a triangle that travels across the plane (Lutfalla, "Ants on the highway", 2024).' },
  { name: 'Spiral square — LRRRRLLLRRRL', rule: 'LRRRRLLLRRRL', colors: null, desc: 'Builds a square containing a logarithmic spiral inside (Lutfalla, 2024).' },
  { name: 'Endless highways — LLRRRLL', rule: 'LLRRRLL', colors: null, desc: 'Member of the proven infinite-highway family: can produce unboundedly many distinct highways.' },
  { name: 'Endless highways II — LLRLRRLL', rule: 'LLRLRRLL', colors: null, desc: 'Another member of the infinite-highway family ("Ants on the highway", 2024).' },
];
const PRESETS_3D = [
  { name: '3D classic — LR', rule: 'LR', colors: ['#121218', '#03DAC6'], desc: "Hamann-style 3D ant (Complex Systems, 2003): the same L/R letter rule as the 2D classic, flying on the cubic lattice." },
  { name: '3D symmetric — LLRR', rule: 'LLRR', colors: ['#121218', '#FFEB3B', '#FF0266'], desc: 'The symmetric 2D rule lifted to 3D — slow-growing knotted colonies.' },
  { name: '3D chaos — RLR', rule: 'RLR', colors: ['#121218', '#FF0266', '#03DAC6'], desc: 'The chaotic 2D rule lifted to 3D — dense tangled tunnels.' },
  { name: '3D textured cube — LRRRRRLLR', rule: 'LRRRRRLLR', colors: null, desc: 'Experimental analog: the famous textured-square rule running on the bee. Watch for drifting 3D highways.' },
  { name: 'Branching coral — FRLUD', rule: 'FRLUD', colors: null, desc: 'Uses the full relative 3D turn set (forward/back/left/right/up/down) — grows branching coral-like structures.' },
];

const TURNS_2D = ['L', 'R', 'U', 'C'];
const TURNS_2D_LABEL = { L: '↰ Left', R: '↱ Right', U: '↩ U-turn', C: '↑ Straight' };
const TURNS_3D = ['F', 'B', 'L', 'R', 'U', 'D'];
const TURNS_3D_LABEL = { F: '↑ Forward', B: '↓ Back', L: '← Left', R: '→ Right', U: '⬆ Up', D: '⬇ Down' };
// turn codes 2D: 0=L 1=R 2=U 3=C
const TURN2D_CODE = { L: 0, R: 1, U: 2, C: 3 };

/* ---------------- global state ---------------- */
const S = {
  mode: '2d',            // '2d' | '3d'
  running: false,
  stepsPerFrame: 10000,
  turbo: false,
  wrap2d: false,
  wrap3d: true,
  showGrid: true,
  follow: false,
  showAnt: true,
  tool: 'paint',         // pan | paint | ant | erase
  paintState: 1,
  size2d: 256,
  size3d: 64,
  fx: { glow: true, vig: true, trail: true },
  trailTime: 1.2,
  voxelOpacity: 0.85,
  bloom: true,
  bloomStrength: 0.85,
  bloomThreshold: 0.6,
  bloomRadius: 0.6,
  cellGlow3d: true,
  cellGlowTime: 1.1,
  cellFlash: 1.0,
  glowStrength2d: 1.0,
  glowSpread: 1,
  antLight: true,
  antRadius: 12,
  glowColor: '#FF9E50',
  trailFlash: 1.0,
  glowThr2d: 0.0,
  beeLight: true,
  fogDensity: 0.011,
  rules2d: { turns: ['L', 'R'], colors: ['#101014', '#FFFFFF'] },
  rules3d: { turns: ['F', 'R'], colors: ['#121218', '#03DAC6'] },
  voxelScale: 0.95,
  spin: false,
};

/* ============================================================
   2D SIMULATION — flat Uint8Array, branch-lean inner loop
   ============================================================ */
class Sim2D {
  constructor(n) {
    this.resize(n);
  }
  resize(n) {
    this.W = n; this.H = n;
    this.maskW = n - 1; this.maskH = n - 1;
    this.grid = new Uint8Array(n * n);
    this.colorBuf = new Uint8Array(n * n * 4);
    this.heat = new Float32Array(n * n);
    this.hotFlag = new Uint8Array(n * n);
    this.hot = [];
    this.ants = [{ x: n >> 1, y: n >> 1, dir: 0 }];
    this.steps = 0;
    this.alive = 0;
    this.turnCodes = new Uint8Array([0, 1]);
    this.nStates = 2;
    this.palR = new Uint8Array([16, 255]);
    this.palG = new Uint8Array([16, 255]);
    this.palB = new Uint8Array([20, 255]);
    this.applyColorsToAll();
  }
  setRules(turns, colors) {
    const n = turns.length;
    this.nStates = n;
    const tc = new Uint8Array(n);
    for (let i = 0; i < n; i++) tc[i] = TURN2D_CODE[turns[i]] ?? 0;
    this.turnCodes = tc;
    const r = new Uint8Array(n), g = new Uint8Array(n), b = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const [rr, gg, bb] = hexToRgb(colors[i]);
      r[i] = rr; g[i] = gg; b[i] = bb;
    }
    this.palR = r; this.palG = g; this.palB = b;
    // re-tint existing cells (cheap full pass, rare op)
    const grid = this.grid, cb = this.colorBuf;
    for (let i = 0; i < grid.length; i++) {
      const s = grid[i] % n;
      grid[i] = s;
      const o = i * 4;
      cb[o] = r[s]; cb[o + 1] = g[s]; cb[o + 2] = b[s]; cb[o + 3] = 255;
    }
    let alive = 0;
    for (let i = 0; i < grid.length; i++) if (grid[i] !== 0) alive++;
    this.alive = alive;
  }
  applyColorsToAll() {
    const cb = this.colorBuf, n = this.grid.length;
    const r = this.palR[0], g = this.palG[0], b = this.palB[0];
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      cb[o] = r; cb[o + 1] = g; cb[o + 2] = b; cb[o + 3] = 255;
    }
  }
  reset() {
    this.grid.fill(0);
    this.applyColorsToAll();
    this.heat.fill(0); this.hotFlag.fill(0); this.hot.length = 0;
    const c = this.W >> 1;
    this.ants = [{ x: c, y: c, dir: 0 }];
    this.steps = 0; this.alive = 0;
  }
  clearCells() {
    this.grid.fill(0);
    this.applyColorsToAll();
    this.heat.fill(0); this.hotFlag.fill(0); this.hot.length = 0;
    this.alive = 0;
  }
  paint(cx, cy, v) {
    if (cx < 0 || cy < 0 || cx >= this.W || cy >= this.H) return;
    const i = cy * this.W + cx;
    const old = this.grid[i];
    if (old === v) return;
    this.grid[i] = v;
    const o = i * 4;
    this.colorBuf[o] = this.palR[v]; this.colorBuf[o + 1] = this.palG[v];
    this.colorBuf[o + 2] = this.palB[v]; this.colorBuf[o + 3] = 255;
    if (old === 0 && v !== 0) this.alive++;
    else if (old !== 0 && v === 0) this.alive--;
    if (S.fx.trail) {
      this.heat[i] = 1;
      if (!this.hotFlag[i] && this.hot.length < Sim2D.TRAIL_CAP) { this.hotFlag[i] = 1; this.hot.push(i); }
    }
  }
  addAnt(x, y) {
    if (this.ants.length >= 12) { snack('Maximum 12 ants. Reset to clear.'); return; }
    x = clamp(Math.round(x), 0, this.W - 1);
    y = clamp(Math.round(y), 0, this.H - 1);
    const dirs = new Set(this.ants.map(a => a.x + ',' + a.y));
    this.ants.push({ x, y, dir: (Math.random() * 4) | 0 });
    if (dirs.has(x + ',' + y)) snack('Ant added (stacked on existing cell)');
    else snack('Ant placed at (' + x + ', ' + y + ')');
    syncAntStats();
  }
  // --- wrapped (torus), power-of-two mask => fastest ---
  runWrapped(budget) {
    const W = this.W, grid = this.grid, cb = this.colorBuf;
    const tc = this.turnCodes, n = this.nStates;
    const pR = this.palR, pG = this.palG, pB = this.palB;
    const mW = this.maskW, mH = this.maskH;
    const ants = this.ants;
    const DX = Sim2D.DX, DY = Sim2D.DY;
    const useTrail = S.fx.trail ? 1 : 0;
    const heat = this.heat, hflag = this.hotFlag, hlist = this.hot;
    const hcap = Sim2D.TRAIL_CAP;
    let alive = this.alive, steps = this.steps;
    for (let k = 0; k < budget; k++) {
      for (let a = 0; a < ants.length; a++) {
        const ant = ants[a];
        let x = ant.x, y = ant.y;
        const idx = y * W + x;
        const s = grid[idx];
        let ns = s + 1;
        if (ns === n) ns = 0;
        grid[idx] = ns;
        const o = idx * 4;
        cb[o] = pR[ns]; cb[o + 1] = pG[ns]; cb[o + 2] = pB[ns];
        if (useTrail) { heat[idx] = 1; if (!hflag[idx] && hlist.length < hcap) { hflag[idx] = 1; hlist.push(idx); } }
        if (s === 0) alive++; else if (s === n - 1) alive--;
        const t = tc[s];
        let d = ant.dir;
        if (t === 0) d = (d + 3) & 3;
        else if (t === 1) d = (d + 1) & 3;
        else if (t === 2) d = (d + 2) & 3;
        ant.dir = d;
        ant.x = (x + DX[d]) & mW;
        ant.y = (y + DY[d]) & mH;
        steps++;
      }
    }
    this.alive = alive; this.steps = steps;
  }
  // --- infinite (shift grid to recenter when ant leaves) ---
  runInfinite(budget) {
    const W = this.W, H = this.H;
    let grid = this.grid;
    const cb = this.colorBuf;
    const tc = this.turnCodes, n = this.nStates;
    const pR = this.palR, pG = this.palG, pB = this.palB;
    const ants = this.ants;
    const DX = Sim2D.DX, DY = Sim2D.DY;
    const useTrail = S.fx.trail ? 1 : 0;
    const heat = this.heat, hflag = this.hotFlag, hlist = this.hot;
    const hcap = Sim2D.TRAIL_CAP;
    let alive = this.alive, steps = this.steps;
    for (let k = 0; k < budget; k++) {
      for (let a = 0; a < ants.length; a++) {
        const ant = ants[a];
        const x = ant.x, y = ant.y;
        const idx = y * W + x;
        const s = grid[idx];
        let ns = s + 1;
        if (ns === n) ns = 0;
        grid[idx] = ns;
        const o = idx * 4;
        cb[o] = pR[ns]; cb[o + 1] = pG[ns]; cb[o + 2] = pB[ns];
        if (useTrail) { heat[idx] = 1; if (!hflag[idx] && hlist.length < hcap) { hflag[idx] = 1; hlist.push(idx); } }
        if (s === 0) alive++; else if (s === n - 1) alive--;
        const t = tc[s];
        let d = ant.dir;
        if (t === 0) d = (d + 3) & 3;
        else if (t === 1) d = (d + 1) & 3;
        else if (t === 2) d = (d + 2) & 3;
        ant.dir = d;
        let nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) {
          // recenter synchronously (rare, O(WH) native-speed copies)
          this.alive = alive; this.steps = steps;
          this.shiftToFit(a, nx, ny);
          alive = this.alive;
          grid = this.grid; // shift replaced the array — refresh local ref
          // ant fields refreshed by shift
        } else {
          ant.x = nx; ant.y = ny;
        }
        steps++;
      }
    }
    this.alive = alive; this.steps = steps;
  }
  shiftToFit(ai, nx, ny) {
    const W = this.W, H = this.H;
    // shift so offending ant lands near center
    const ant = this.ants[ai];
    const sx = (W >> 1) - nx, sy = (H >> 1) - ny;
    if (sx === 0 && sy === 0) return;
    const grid = this.grid;
    const tmp = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const srcY = y - sy;
      if (srcY < 0 || srcY >= H) continue;
      for (let x = 0; x < W; x++) {
        const srcX = x - sx;
        if (srcX < 0 || srcX >= W) continue;
        tmp[y * W + x] = grid[srcY * W + srcX];
      }
    }
    this.grid = tmp;
    // recount: cells shifted off-screen are gone, so the counter must be rebuilt
    let alive = 0;
    for (let i = 0; i < tmp.length; i++) if (tmp[i] !== 0) alive++;
    this.alive = alive;
    // rebuild color buffer from palette (single pass, native-speed-ish)
    const cb = this.colorBuf;
    const pR = this.palR, pG = this.palG, pB = this.palB;
    const g2 = this.grid;
    for (let i = 0; i < g2.length; i++) {
      const s = g2[i], o = i * 4;
      cb[o] = pR[s]; cb[o + 1] = pG[s]; cb[o + 2] = pB[s]; cb[o + 3] = 255;
    }
    for (const an of this.ants) {
      an.x = clamp(an.x + sx, 0, W - 1);
      an.y = clamp(an.y + sy, 0, H - 1);
    }
    this.heat.fill(0); this.hotFlag.fill(0); this.hot.length = 0;
    renderer2d.dirty = true;
  }
  run(budget, wrap) {
    if (wrap) this.runWrapped(budget);
    else this.runInfinite(budget);
  }
  // restore base colors and drop all residual heat (e.g. when trail is toggled off)
  clearTrail() {
    const hot = this.hot;
    if (!hot.length) return;
    const grid = this.grid, cb = this.colorBuf;
    const pR = this.palR, pG = this.palG, pB = this.palB;
    for (let k = 0; k < hot.length; k++) {
      const i = hot[k];
      const s = grid[i], o = i * 4;
      cb[o] = pR[s]; cb[o + 1] = pG[s]; cb[o + 2] = pB[s];
      this.hotFlag[i] = 0; this.heat[i] = 0;
    }
    hot.length = 0;
    renderer2d.dirty = true;
  }
  // smooth phosphor-style decay, time-based so it looks identical at any speed.
  // only hot cells are touched — no full-grid pass, no allocation.
  updateTrail(dtSec) {
    const hot = this.hot;
    if (!hot.length) return;
    // phosphor fade at 30 Hz: the decay envelope is ~1s, so halving the
    // rate is visually identical but halves per-frame CPU (up to 150k
    // cells/frame) and halves full-texture re-uploads
    this._trailAcc = (this._trailAcc || 0) + dtSec;
    if (this._trailAcc < 1 / 30) return;
    const dtUse = this._trailAcc;
    this._trailAcc = 0;
    const f = Math.pow(0.5, dtUse / Math.max(0.05, S.trailTime));
    const grid = this.grid, cb = this.colorBuf, heat = this.heat, flag = this.hotFlag;
    const pR = this.palR, pG = this.palG, pB = this.palB;
    const fl = S.trailFlash;
    for (let k = hot.length - 1; k >= 0; k--) {
      const i = hot[k];
      const h = heat[i] * f;
      const s = grid[i], o = i * 4;
      if (h < 0.012) {
        heat[i] = 0; flag[i] = 0;
        cb[o] = pR[s]; cb[o + 1] = pG[s]; cb[o + 2] = pB[s];
        hot[k] = hot[hot.length - 1]; hot.pop();
      } else {
        heat[i] = h;
        // blend toward the cached glow tint (visible on dark AND light
        // cells); values are clamped — Uint8Array would wrap on overflow
        let g2 = h * h * fl;
        if (g2 > 1.5) g2 = 1.5;
        let r = pR[s] + (glowTintR - pR[s]) * g2;
        let g = pG[s] + (glowTintG - pG[s]) * g2;
        let b = pB[s] + (glowTintB - pB[s]) * g2;
        cb[o] = r > 255 ? 255 : r < 0 ? 0 : r;
        cb[o + 1] = g > 255 ? 255 : g < 0 ? 0 : g;
        cb[o + 2] = b > 255 ? 255 : b < 0 ? 0 : b;
      }
    }
    if (hot.length > 1000000) {
      // (defensive; input is capped at Sim2D.TRAIL_CAP so this rarely triggers)
      const drop = hot.length >> 1;
      for (let k = 0; k < drop; k++) {
        const i = hot[k];
        const s = grid[i], o = i * 4;
        cb[o] = pR[s]; cb[o + 1] = pG[s]; cb[o + 2] = pB[s];
        flag[i] = 0; heat[i] = 0;
      }
      hot.splice(0, drop);
    }
    renderer2d.dirty = true;
  }
}
Sim2D.DX = new Int8Array([0, 1, 0, -1]);
Sim2D.DY = new Int8Array([-1, 0, 1, 0]);
Sim2D.DIR_NAME = ['N', 'E', 'S', 'W'];
// upper bound for tracked glowing cells — keeps the per-frame fade pass cheap
Sim2D.TRAIL_CAP = 150000;

/* ============================================================
   2D RENDERER — raw WebGL, single texture, hardware scaled
   ============================================================ */
const renderer2d = {
  gl: null, tex: null, prog: null, dirty: true,
  cam: { x: 128, y: 128, zoom: 3 },
  loc: {},
  init(canvas) {
    const gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) { snack('WebGL unavailable — cannot render 2D grid.'); return false; }
    this.gl = gl;
    const vs = `precision mediump float;attribute vec2 a_pos;uniform vec2 u_res;uniform vec2 u_cam;uniform float u_zoom;varying vec2 v_cell;
void main(){gl_Position=vec4(a_pos,0.,1.);vec2 screen=vec2((a_pos.x*.5+.5)*u_res.x,(.5-a_pos.y*.5)*u_res.y);v_cell=u_cam+(screen-u_res*.5)/u_zoom;}`;
    const fs = `precision mediump float;varying vec2 v_cell;uniform sampler2D u_tex;uniform vec2 u_grid;uniform vec3 u_bg;uniform float u_zoom;uniform float u_gridOn;uniform float u_glow;uniform float u_glowAmt;uniform float u_glowR;uniform float u_glowThr;uniform vec3 u_glowCol;uniform float u_vig;uniform vec2 u_ant;uniform float u_antOn;uniform float u_antSig;uniform vec2 u_res;
vec3 samp(vec2 cell){vec2 uv=vec2((cell.x+.5)/u_grid.x,(cell.y+.5)/u_grid.y);return texture2D(u_tex,uv).rgb;}
void main(){vec2 c=floor(v_cell);vec3 col;
if(c.x<0.||c.y<0.||c.x>=u_grid.x||c.y>=u_grid.y){float chk=mod(c.x+c.y,2.0);col=u_bg*(0.85+0.15*chk);}
else{col=samp(c);
if(u_glow>0.5){float GR=u_glowR;vec3 b=(samp(c+vec2(GR,0.))+samp(c-vec2(GR,0.))+samp(c+vec2(0.,GR))+samp(c-vec2(0.,GR)))*0.25;float bl=dot(b,vec3(0.299,0.587,0.114));float gm=smoothstep(u_glowThr,u_glowThr+0.25,bl)*u_glowAmt;col+=(b-col)*(0.22*gm)+b*(0.16*gm);}
if(u_gridOn>0.5){float act=clamp((u_zoom-2.0)/10.0,0.0,1.0);if(act>0.0){vec2 f=abs(fract(v_cell)-.5);float dd=.5-max(f.x,f.y);float lw=1.2/max(u_zoom,1.0);float line=1.0-smoothstep(0.0,lw,dd);col*=(1.0-0.38*line*act);}}
float bd=min(min(c.x,c.y),min(u_grid.x-1.0-c.x,u_grid.y-1.0-c.y));col=mix(col,vec3(0.62,0.55,1.0),(1.0-smoothstep(-0.5,0.5,bd))*0.45);
if(u_antOn>0.5){vec2 dv=v_cell-u_ant;float g=exp(-dot(dv,dv)/u_antSig);col+=u_glowCol*g*0.4;}}
if(u_vig>0.5){vec2 q=gl_FragCoord.xy/u_res*2.0-1.0;q.x*=u_res.x/max(u_res.y,1.0);float vig=1.0-dot(q,q)*0.16;col*=clamp(vig,0.35,1.0);}
gl_FragColor=vec4(col,1.);}`;
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    this.prog = prog;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    // NOTE: canvas.width resets wipe ALL GL state (incl. attrib bindings),
    // so these handles are re-applied on every draw() call, not just here.
    this.quadBuf = buf;
    this.aPos = gl.getAttribLocation(prog, 'a_pos');
    for (const n of ['u_res', 'u_cam', 'u_zoom', 'u_tex', 'u_grid', 'u_bg', 'u_gridOn', 'u_glow', 'u_glowAmt', 'u_glowR', 'u_glowThr', 'u_glowCol', 'u_vig', 'u_ant', 'u_antOn', 'u_antSig'])
      this.loc[n] = gl.getUniformLocation(prog, n);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.uniform1i(this.loc.u_tex, 0);
    return true;
  },
  allocTexture(sim) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, sim.W, sim.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, sim.colorBuf);
    this.dirty = false;
  },
  draw(sim) {
    const gl = this.gl;
    if (!gl) return;
    const canvas = gl.canvas;
    if (canvas.width === 0) return;
    if (!this._w || this._w !== sim.W) { this.allocTexture(sim); this._w = sim.W; }
    else if (this.dirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sim.W, sim.H, gl.RGBA, gl.UNSIGNED_BYTE, sim.colorBuf);
      this.dirty = false;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(this.prog);
    // re-apply buffer + attrib state every frame: any canvas resize wipes GL state
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(this.loc.u_tex, 0);
    gl.uniform2f(this.loc.u_res, canvas.width, canvas.height);
    gl.uniform2f(this.loc.u_cam, this.cam.x, this.cam.y);
    gl.uniform1f(this.loc.u_zoom, this.cam.zoom);
    gl.uniform2f(this.loc.u_grid, sim.W, sim.H);
    gl.uniform3f(this.loc.u_bg, 0.028, 0.028, 0.045);
    gl.uniform1f(this.loc.u_gridOn, S.showGrid ? 1 : 0);
    gl.uniform1f(this.loc.u_glow, S.fx.glow ? 1 : 0);
    gl.uniform1f(this.loc.u_glowAmt, S.glowStrength2d);
    gl.uniform1f(this.loc.u_glowR, S.glowSpread);
    gl.uniform3f(this.loc.u_glowCol, glowTintR / 255, glowTintG / 255, glowTintB / 255);
    gl.uniform1f(this.loc.u_glowThr, S.glowThr2d);
    gl.uniform1f(this.loc.u_vig, S.fx.vig ? 1 : 0);
    const a0 = sim.ants[0];
    if (a0 && S.antLight) {
      gl.uniform2f(this.loc.u_ant, a0.x + 0.5, a0.y + 0.5);
      gl.uniform1f(this.loc.u_antOn, 1);
      const ar = Math.max(1, S.antRadius);
      gl.uniform1f(this.loc.u_antSig, (ar * ar) / 2);
    } else {
      gl.uniform1f(this.loc.u_antOn, 0);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
};

/* overlay (ant markers, crisp 2D canvas) */
function drawOverlay2D() {
  const cv = $('overlay2d');
  const ctx = cv.getContext('2d');
  const wrap = $('wrap2D');
  const r = wrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  ctx.clearRect(0, 0, W, H);
  if (S.mode !== '2d') return;
  const cam = renderer2d.cam;
  const toScr = (cx, cy) => [(cx - cam.x) * cam.zoom + W / 2, (cy - cam.y) * cam.zoom + H / 2];
  // hover cell
  if (hoverCell && S.tool !== 'pan') {
    const [sx, sy] = toScr(hoverCell.x + 0.5, hoverCell.y + 0.5);
    const z = cam.zoom;
    if (z > 3) {
      ctx.strokeStyle = 'rgba(3,218,198,.9)';
      ctx.lineWidth = Math.max(1.5, dpr);
      ctx.strokeRect(sx - z / 2, sy - z / 2, z, z);
    }
  }
  if (!S.showAnt) return;
  sim2d.ants.forEach((a, i) => {
    const [sx, sy] = toScr(a.x + 0.5, a.y + 0.5);
    if (sx < -40 || sy < -40 || sx > W + 40 || sy > H + 40) return;
    const R = clamp(cam.zoom * 0.9, 7 * dpr, 26 * dpr);
    const ang = [ -Math.PI / 2, 0, Math.PI / 2, Math.PI ][a.dir];
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(R * 0.9, 0);
    ctx.lineTo(-R * 0.55, R * 0.62);
    ctx.lineTo(-R * 0.25, 0);
    ctx.lineTo(-R * 0.55, -R * 0.62);
    ctx.closePath();
    ctx.fillStyle = i === 0 ? '#FF0266' : '#03DAC6';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2 * dpr * 0.7;
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.restore();
  });
}

/* ============================================================
   3D BEE — dense Uint8 grid + Three.js instanced voxels
   ============================================================ */
const DIRS3 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const OPP3 = [1, 0, 3, 2, 5, 4];
function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function neg3(a) { return [-a[0], -a[1], -a[2]]; }
function vecKey(v) { return v[0] + ',' + v[1] + ',' + v[2]; }
const DIR_INDEX = { '1,0,0': 0, '-1,0,0': 1, '0,1,0': 2, '0,-1,0': 3, '0,0,1': 4, '0,0,-1': 5 };

class Sim3D {
  constructor(n) { this.resize(n); }
  resize(n) {
    this.N = n; this.mask = n - 1;
    this.grid = new Uint8Array(n * n * n);
    this.dirty = new Uint8Array(n * n * n);
    this.dirtyCount = 0;
    const c = n >> 1;
    this.bees = [{ x: c, y: c, z: c, dir: 0, up: 2 }];
    this.steps = 0; this.alive = 0;
    this.nStates = 2;
    this.turns = ['F', 'R'];
    this.colors = ['#121218', '#03DAC6'];
  }
  idx(x, y, z) { return (z * this.N + y) * this.N + x; }
  setRules(turns, colors) {
    this.turns = turns.slice();
    this.colors = colors.slice();
    this.nStates = turns.length;
    // clamp existing states
    const g = this.grid;
    let alive = 0;
    for (let i = 0; i < g.length; i++) {
      if (g[i] >= this.nStates) g[i] = 0;
      if (g[i] !== 0) alive++;
    }
    this.alive = alive;
  }
  reset() {
    this.grid.fill(0);
    this.dirty.fill(0); this.dirtyCount = 0;
    const c = this.N >> 1;
    this.bees = [{ x: c, y: c, z: c, dir: 0, up: 2 }];
    this.steps = 0; this.alive = 0;
  }
  clearCells() { this.grid.fill(0); this.dirty.fill(0); this.dirtyCount = 0; this.alive = 0; }
  applyTurn(bee, t) {
    const D = DIRS3[bee.dir], U = DIRS3[bee.up];
    if (t === 'F') return;
    if (t === 'B') { bee.dir = OPP3[bee.dir]; return; }
    const right = cross3(D, U);
    const rk = vecKey(right);
    const left = neg3(right);
    if (t === 'R') { bee.dir = DIR_INDEX[rk]; return; }
    if (t === 'L') { bee.dir = DIR_INDEX[vecKey(left)]; return; }
    if (t === 'U') {
      const nd = bee.up, nu = OPP3[bee.dir];
      bee.dir = nd; bee.up = nu; return;
    }
    if (t === 'D') {
      const nd = OPP3[bee.up], nu = bee.dir;
      bee.dir = nd; bee.up = nu; return;
    }
  }
  // Fast loop: one extra dirty-byte write per step, no allocation.
  // Renderer syncs via syncDirty() which scans the flag array once.
  run(budget, wrap) {
    const N = this.N, grid = this.grid, dirty = this.dirty, n = this.nStates;
    const turns = this.turns, mask = this.mask;
    let alive = this.alive, steps = this.steps;
    for (let k = 0; k < budget; k++) {
      for (let bi = 0; bi < this.bees.length; bi++) {
        const b = this.bees[bi];
        const i = (b.z * N + b.y) * N + b.x;
        const s = grid[i];
        let ns = s + 1;
        if (ns === n) ns = 0;
        grid[i] = ns;
        dirty[i] = 1;
        if (s === 0) alive++; else if (s === n - 1) alive--;
        this.applyTurn(b, turns[s]);
        const d = DIRS3[b.dir];
        let nx = b.x + d[0], ny = b.y + d[1], nz = b.z + d[2];
        if (wrap) { b.x = nx & mask; b.y = ny & mask; b.z = nz & mask; }
        else {
          if (nx < 0 || ny < 0 || nz < 0 || nx >= N || ny >= N || nz >= N) {
            b.dir = OPP3[b.dir]; // bounce off wall
          } else { b.x = nx; b.y = ny; b.z = nz; }
        }
        steps++;
      }
    }
    this.alive = alive; this.steps = steps;
  }
}

/* Three.js renderer — lazy loaded so 2D works even offline */
let T = null; // three module
const render3d = {
  ready: false, loading: false,
  voxelMesh: null, beeGroup: null, cellToInst: new Map(), instToCell: [],
  instCount: 0, capacity: 0, overCapWarned: false,
  young: new Map(), cooled: new Map(), glowAttr: null, FX: null, composer: null, bloomPass: null,
  _m4: null, _c: null, _hot: null,
  palCache: [], _nowSec: 0, _glowAcc: 0,
  async ensure() {
    if (this.ready || this.loading) return;
    this.loading = true;
    try {
      T = await import('three');
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
      this.TOrbit = OrbitControls;
      try {
        const [ec, rp, ub, op] = await Promise.all([
          import('three/addons/postprocessing/EffectComposer.js'),
          import('three/addons/postprocessing/RenderPass.js'),
          import('three/addons/postprocessing/UnrealBloomPass.js'),
          import('three/addons/postprocessing/OutputPass.js'),
        ]);
        this.FX = { EffectComposer: ec.EffectComposer, RenderPass: rp.RenderPass, UnrealBloomPass: ub.UnrealBloomPass, OutputPass: op.OutputPass };
      } catch (e2) { this.FX = null; console.warn('bloom unavailable', e2); }
      this.initScene();
      this.ready = true;
      this.rebuildAll();
      snack('3D engine ready (Three.js WebGL, instanced voxels)');
    } catch (e) {
      console.error(e);
      snack('Could not load Three.js CDN — 3D needs internet. 2D still works.');
    }
    this.loading = false;
  },
  initScene() {
    const canvas = $('gl3');
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    this.renderer = renderer;
    const scene = new T.Scene();
    scene.background = new T.Color(0x0b0b10);
    scene.fog = new T.FogExp2(0x0b0b10, S.fogDensity);
    this.scene = scene;
    const N = sim3d.N;
    const cam = new T.PerspectiveCamera(55, 1, 0.1, 2000);
    cam.position.set(N * 0.9, N * 0.7, N * 0.9);
    this.camera = cam;
    const ctl = new this.TOrbit(cam, canvas);
    ctl.enableDamping = true; ctl.dampingFactor = 0.08;
    ctl.target.set(0, 0, 0);
    this.controls = ctl;
    scene.add(new T.HemisphereLight(0xffffff, 0x30293f, 1.05));
    const dir = new T.DirectionalLight(0xffffff, 1.6);
    dir.position.set(60, 100, 40);
    scene.add(dir);
    const dir2 = new T.DirectionalLight(0x03dac6, 0.5);
    dir2.position.set(-60, -30, -50);
    scene.add(dir2);
    // soft fill from below so undersides (and the glow) stay readable
    const upFill = new T.DirectionalLight(0x9fb4ff, 0.45);
    upFill.position.set(-15, -60, -10);
    scene.add(upFill);
    // headlight that follows the lead bee: soft local fill, never a nuke
    this.beeLight = new T.PointLight(0xff7aa8, N * 1.5, N * 2, 2);
    scene.add(this.beeLight);
    // bounds box
    const box = new T.LineSegments(
      new T.EdgesGeometry(new T.BoxGeometry(N, N, N)),
      new T.LineBasicMaterial({ color: 0x8e77ff, transparent: true, opacity: 0.55 })
    );
    this.boundsBox = box;
    scene.add(box);
    // faint ground grid
    const gh = new T.GridHelper(N, N, 0x3a3348, 0x232030);
    gh.position.y = -N / 2 - 0.5;
    this.groundGrid = gh;
    scene.add(gh);
    this.beeGroup = new T.Group();
    scene.add(this.beeGroup);
    // bee markers are built ONCE and repositioned per frame (no per-frame alloc)
    this.beeMeshes = [];
    this._beeGeoBody = new T.SphereGeometry(0.55, 20, 14);
    this._beeGeoNeedle = new T.ConeGeometry(0.3, 0.95, 10);
    this._beeMatPink = new T.MeshBasicMaterial({ color: 0xff2e88 });
    this._beeMatCyan = new T.MeshBasicMaterial({ color: 0x2ee6d0 });
    const haloCanvas = document.createElement('canvas');
    haloCanvas.width = haloCanvas.height = 128;
    const hx = haloCanvas.getContext('2d');
    const hg = hx.createRadialGradient(64, 64, 0, 64, 64, 64);
    hg.addColorStop(0, 'rgba(255,255,255,1)');
    hg.addColorStop(0.25, 'rgba(255,255,255,0.5)');
    hg.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    hg.addColorStop(1, 'rgba(255,255,255,0)');
    hx.fillStyle = hg;
    hx.fillRect(0, 0, 128, 128);
    const haloTex = new T.CanvasTexture(haloCanvas);
    this.haloPink = new T.SpriteMaterial({ map: haloTex, color: 0xff5c8a, transparent: true, opacity: 0.45, blending: T.AdditiveBlending, depthWrite: false });
    this.haloCyan = new T.SpriteMaterial({ map: haloTex, color: 0x54f0dd, transparent: true, opacity: 0.45, blending: T.AdditiveBlending, depthWrite: false });
    // scratch objects for the appear-glow animation (no per-frame allocation)
    this._m4 = new T.Matrix4();
    this._c = new T.Color();
    this._sm = new T.Matrix4();
    this._sc = new T.Color();
    this._hot = new T.Color();
    this.refreshHot();
    // post-process bloom chain (optional, toggleable)
    if (this.FX) {
      this.composer = new this.FX.EffectComposer(this.renderer);
      this.composer.addPass(new this.FX.RenderPass(this.scene, this.camera));
      this.bloomPass = new this.FX.UnrealBloomPass(
        new T.Vector2(512, 512), S.bloomStrength, S.bloomRadius, S.bloomThreshold);
      this.composer.addPass(this.bloomPass);
      this.composer.addPass(new this.FX.OutputPass());
    }
    this.resize();
    this.allocMesh(Math.min(350000, N * N * N));
  },
  allocMesh(cap) {
    if (this.voxelMesh) { this.scene.remove(this.voxelMesh); this.voxelMesh.geometry?.dispose?.(); this.voxelMesh.dispose?.(); }
    const geo = new T.BoxGeometry(S.voxelScale, S.voxelScale, S.voxelScale);
    const mat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.38, metalness: 0.12, transparent: true, opacity: S.voxelOpacity });
    // per-instance emissive: hot voxels emit light themselves, so the glow
    // reads from ANY viewing angle instead of dying on unlit faces
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
        .replace('#include <color_vertex>', '#include <color_vertex>\nvGlow = aGlow;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vGlow;\nuniform vec3 uGlowColor;\nuniform float uGlowBoost;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGlowColor * (vGlow * uGlowBoost);');
      sh.uniforms.uGlowColor = this._uGlowCol || (this._uGlowCol = { value: new T.Color() });
      sh.uniforms.uGlowBoost = this._uGlowBoost || (this._uGlowBoost = { value: 1.1 });
      this._uGlowCol.value.set(S.glowColor || '#FF9E50');
      this._uGlowBoost.value = 1.1 * (S.cellFlash || 1);
    };
    mat.customProgramCacheKey = () => 'voxel-glow';
    const glow = new T.InstancedBufferAttribute(new Float32Array(cap), 1);
    glow.setUsage(T.DynamicDrawUsage);
    geo.setAttribute('aGlow', glow);
    this.glowAttr = glow;
    const m = new T.InstancedMesh(geo, mat, cap);
    m.instanceMatrix.setUsage(T.DynamicDrawUsage);
    m.count = 0;
    m.frustumCulled = false;
    this.scene.add(m);
    this.voxelMesh = m;
    this.capacity = cap;
    this.cellToInst.clear(); this.instToCell = []; this.instCount = 0;
    this.young.clear(); this.cooled.clear();
    this.applyVoxelOpacity();
  },
  // opaque fast path: blending hundreds of thousands of transparent boxes
  // is the dominant GPU cost — skip it entirely at (near-)full opacity
  applyVoxelOpacity() {
    const m = this.voxelMesh;
    if (!m) return;
    const op = S.voxelOpacity;
    m.material.transparent = op < 0.999;
    m.material.opacity = op;
  },
  // per-state base colors as THREE.Color, parsed ONCE per rule change.
  // the sim hot path (setVoxel per step) and the fade loop (per glowing
  // cell per frame) used to re-parse '#RRGGBB' strings every single time —
  // tens of thousands of string parses per frame, pure CPU burn
  refreshPalette() {
    this.palCache.length = 0;
    if (!T) return;
    const cols = sim3d.colors || [];
    for (let i = 0; i < cols.length; i++) this.palCache[i] = new T.Color(cols[i] || '#ffffff');
  },
  baseCol(st) {
    let c = this.palCache[st];
    if (!c) { c = new T.Color((sim3d.colors && sim3d.colors[st]) || '#ffffff'); this.palCache[st] = c; }
    return c;
  },
  // hot flash color + lead-bee halo follow the shared glow color (×3 HDR)
  refreshHot() {
    const col = S.glowColor || '#FF9E50';
    this._hot.set(col).multiplyScalar(3);
    if (this.haloPink) this.haloPink.color.set(col);
    if (this._uGlowCol) this._uGlowCol.value.set(col);
    if (this._uGlowBoost) this._uGlowBoost.value = 1.1 * (S.cellFlash || 1);
  },
  // reflash cooldown: long enough that hyper-churn shimmers instead of
  // burning as one solid flame, short enough to stay lively
  reflashCooldown() {
    return Math.max(4, S.cellGlowTime * 4);
  },
  // voxel size that actually works: geometry is baked at alloc time, so the
  // slider swaps just the box geometry in place — instances stay untouched
  applyVoxelScale() {
    const m = this.voxelMesh;
    if (!m || !T) return;
    const old = m.geometry;
    const geo = new T.BoxGeometry(S.voxelScale, S.voxelScale, S.voxelScale);
    const glow = new T.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
    glow.setUsage(T.DynamicDrawUsage);
    const oldGlow = old && old.getAttribute('aGlow');
    if (oldGlow) glow.array.set(oldGlow.array.subarray(0, Math.min(oldGlow.array.length, this.capacity)));
    geo.setAttribute('aGlow', glow);
    this.glowAttr = glow;
    m.geometry = geo;
    if (old) old.dispose();
  },
  finalizeYoung(cell, remember = false) {
    const m = this.voxelMesh;
    const id = m ? this.cellToInst.get(cell) : undefined;
    if (id !== undefined) {
      // voxels are always full-size; finalizing only restores base color
      this._c.copy(this.baseCol(sim3d.grid[cell]));
      m.setColorAt(id, this._c);
      m.instanceColor.needsUpdate = true;
      if (this.glowAttr) { this.glowAttr.setX(id, 0); this.glowAttr.needsUpdate = true; }
    }
    // remember=true: record cooldown so instant churn does not re-ignite;
    // after one glow-time the next color change may flash again.
    // remember=false: forget completely.
    const now = this._nowSec || performance.now() / 1000;
    if (remember) {
      this.young.delete(cell);
      this.cooled.set(cell, now);
      if (this.cooled.size > 200000) {
        const k = this.cooled.keys().next().value;
        if (k !== undefined) this.cooled.delete(k);
      }
    } else {
      this.young.delete(cell);
      this.cooled.delete(cell);
    }
  },
  compactYoung() {
    // only genuinely glowing instances live here; finalize oldest first
    for (const cell of this.young.keys()) {
      if (this.young.size < 60000) break;
      this.finalizeYoung(cell);
    }
  },
  cellPos(i) {
    const N = sim3d.N;
    const x = i % N, y = ((i / N) | 0) % N, z = (i / (N * N)) | 0;
    return [x - N / 2 + 0.5, y - N / 2 + 0.5, z - N / 2 + 0.5];
  },
  setVoxel(i, state, quiet = false) {
    const m = this.voxelMesh;
    if (!m) return;
    const has = this.cellToInst.get(i);
    if (state !== 0) {
      this._sc.copy(this.baseCol(state));
      if (has === undefined) {
        if (this.instCount >= this.capacity) {
          if (!this.overCapWarned) { snack('Voxel cap reached (' + fmtInt(this.capacity) + ') — oldest voxels stay. Clear or use smaller grid.'); this.overCapWarned = true; }
          return;
        }
        const p = this.cellPos(i);
        this._sm.setPosition(p[0], p[1], p[2]);
        m.setMatrixAt(this.instCount, this._sm);
        m.setColorAt(this.instCount, this._sc);
        this.cellToInst.set(i, this.instCount);
        this.instToCell[this.instCount] = i;
        this.instCount++;
        m.count = this.instCount;
        // flash on appearance AND on color change, throttled: a cooled cell
        // may re-ignite only after 3× glow-time, so hyper-churn shimmers
        // instead of burning as one solid flame
        if (!quiet && S.cellGlow3d) {
          // frame-cached clock: performance.now() per voxel in the sim hot
          // path costs milliseconds at high step counts — one read per
          // frame is plenty for second-scale glow timestamps
          const now = this._nowSec || performance.now() / 1000;
          if (!this.young.has(i)) {
            const cd = this.cooled.get(i);
            if (cd === undefined || now - cd > this.reflashCooldown()) {
              if (this.young.size >= 60000) this.compactYoung();
              this.young.set(i, now);
              if (cd !== undefined) this.cooled.delete(i);
            }
          }
        }
        if (this.glowAttr) {
          this.glowAttr.setX(this.instCount - 1, (!quiet && S.cellGlow3d && this.young.has(i)) ? 1 : 0);
          this.glowAttr.needsUpdate = true;
        }
      } else {
        const p = this.cellPos(i);
        this._sm.setPosition(p[0], p[1], p[2]);
        m.setMatrixAt(has, this._sm);
        m.setColorAt(has, this._sc);
      }
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    } else if (has !== undefined) {
      // swap-with-last removal
      const last = this.instCount - 1;
      const lastCell = this.instToCell[last];
      if (has !== last) {
        m.getMatrixAt(last, this._sm);
        m.setMatrixAt(has, this._sm);
        m.getColorAt(last, this._sc);
        m.setColorAt(has, this._sc);
        this.cellToInst.set(lastCell, has);
        this.instToCell[has] = lastCell;
      }
      this.cellToInst.delete(i);
      this.instCount--;
      m.count = this.instCount;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      if (this.glowAttr && has !== last) {
        this.glowAttr.setX(has, this.glowAttr.getX(last));
        this.glowAttr.needsUpdate = true;
      }
      // erased: record time so an instant repaint stays calm (cooldown)
      this.young.delete(i);
      if (S.cellGlow3d) {
        this.cooled.set(i, this._nowSec || performance.now() / 1000);
        if (this.cooled.size > 200000) {
          const k = this.cooled.keys().next().value;
          if (k !== undefined) this.cooled.delete(k);
        }
      }
    }
  },
  applyChanges(changes) {
    if (!changes || !this.voxelMesh) return;
    for (let k = 0; k < changes.length; k += 2) this.setVoxel(changes[k], changes[k + 1]);
  },
  syncDirty() {
    // single linear scan of the dirty-flag array — native-speed, no GC churn
    if (!this.ready || !this.voxelMesh) return;
    this._nowSec = performance.now() / 1000;
    const d = sim3d.dirty, g = sim3d.grid;
    let any = false;
    for (let i = 0; i < d.length; i++) {
      if (d[i]) { d[i] = 0; this.setVoxel(i, g[i]); any = true; }
    }
    if (any) {
      this.voxelMesh.instanceMatrix.needsUpdate = true;
      if (this.voxelMesh.instanceColor) this.voxelMesh.instanceColor.needsUpdate = true;
    }
  },
  rebuildAll() {
    if (!this.ready) return;
    this.overCapWarned = false;
    this.refreshPalette();
    const need = Math.min(350000, sim3d.N ** 3);
    if (!this.voxelMesh || this.capacity !== need) this.allocMesh(need);
    else { this.cellToInst.clear(); this.instToCell = []; this.instCount = 0; this.voxelMesh.count = 0; this.young.clear(); this.cooled.clear(); }
    const g = sim3d.grid;
    for (let i = 0; i < g.length; i++) if (g[i] !== 0) this.setVoxel(i, g[i], true);
    this.refreshBounds();
    this.refreshBees();
  },
  refreshBounds() {
    if (!this.boundsBox) return;
    const N = sim3d.N;
    this.boundsBox.geometry.dispose();
    this.boundsBox.geometry = new T.EdgesGeometry(new T.BoxGeometry(N, N, N));
    if (this.beeLight) { this.beeLight.intensity = N * 1.5; this.beeLight.distance = N * 2; }
    if (this.scene.fog) this.scene.fog.density = S.fogDensity;
    this.groundGrid.geometry.dispose?.();
    this.groundGrid.geometry = new T.BufferGeometry(); // hide stale, recreate
    this.scene.remove(this.groundGrid);
    this.groundGrid = new T.GridHelper(N, Math.min(N, 64), 0x3a3348, 0x232030);
    this.groundGrid.position.y = -N / 2 - 0.5;
    this.scene.add(this.groundGrid);
  },
  refreshBees() {
    if (!this.beeGroup) return;
    const N = sim3d.N;
    const bees = sim3d.bees;
    while (this.beeMeshes.length < bees.length) {
      const grp = new T.Group();
      const body = new T.Mesh(this._beeGeoBody, this._beeMatPink);
      const needle = new T.Mesh(this._beeGeoNeedle, this._beeMatPink);
      const halo = new T.Sprite(this.haloPink);
      halo.scale.set(3.6, 3.6, 1);
      grp.add(body, needle, halo);
      this.beeGroup.add(grp);
      this.beeMeshes.push({ grp, body, needle, halo });
    }
    if (!this._upVec) { this._upVec = new T.Vector3(0, 1, 0); this._dirVec = new T.Vector3(); }
    this.beeMeshes.forEach((bm, i) => {
      const b = bees[i];
      if (!b) { bm.grp.visible = false; return; }
      bm.grp.visible = true;
      const pink = i === 0;
      bm.body.material = pink ? this._beeMatPink : this._beeMatCyan;
      bm.needle.material = pink ? this._beeMatPink : this._beeMatCyan;
      bm.halo.material = pink ? this.haloPink : this.haloCyan;
      const d = DIRS3[b.dir];
      bm.needle.position.set(d[0] * 0.95, d[1] * 0.95, d[2] * 0.95);
      this._dirVec.set(d[0], d[1], d[2]);
      bm.needle.quaternion.setFromUnitVectors(this._upVec, this._dirVec);
      bm.grp.position.set(b.x - N / 2 + 0.5, b.y - N / 2 + 0.5, b.z - N / 2 + 0.5);
    });
  },
  recolorAll() {
    if (!this.ready || !this.voxelMesh) return;
    this.refreshPalette();
    for (let inst = 0; inst < this.instCount; inst++) {
      const cell = this.instToCell[inst];
      this.voxelMesh.setColorAt(inst, this.baseCol(sim3d.grid[cell]));
    }
    if (this.voxelMesh.instanceColor) this.voxelMesh.instanceColor.needsUpdate = true;
  },
  resize() {
    if (!this.renderer) return;
    const wrap = $('wrap3D');
    const r = wrap.getBoundingClientRect();
    const w = Math.max(2, r.width), h = Math.max(2, r.height);
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.composer.setSize(w, h);
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  },
  frame(dtSec = 1 / 60) {
    if (!this.ready) return;
    this.controls.autoRotate = S.spin;
    this.controls.update();
    this.refreshBees();
    if (this.beeLight) {
      const b = sim3d.bees[0], N = sim3d.N;
      this.beeLight.visible = S.beeLight && !!b;
      if (b) this.beeLight.position.set(b.x - N / 2 + 0.5, b.y - N / 2 + 0.5, b.z - N / 2 + 0.5);
    }
    // appear-glow: pure color flash, no scaling — new and recolored voxels
    // ignite white-hot and cool down to their base color, always full size.
    // only genuinely flashing instances are visited here (cooled ones live
    // in a separate map that costs nothing per frame).
    // runs at 30 Hz: identical look for a ~1s glow, but halves per-cell CPU
    // and halves full instanceColor/glow buffer re-uploads to the GPU
    if (S.cellGlow3d && this.young.size && this.voxelMesh) {
      this._nowSec = performance.now() / 1000;
      this._glowAcc = (this._glowAcc || 0) + Math.min(dtSec, 0.1);
      if (this._glowAcc >= 1 / 30) {
        this._glowAcc = 0;
        const now = this._nowSec, F = S.cellGlowTime;
        const m = this.voxelMesh;
        const fl = S.cellFlash;
        let touched = false;
        // keys()+get: no per-entry array allocation unlike [k,v] destructuring
        for (const cell of this.young.keys()) {
          const bt = this.young.get(cell);
          const age = now - bt;
          if (age >= F) { this.finalizeYoung(cell, true); continue; }
          const id = this.cellToInst.get(cell);
          if (id === undefined) { this.young.delete(cell); continue; }
          this._c.copy(this.baseCol(sim3d.grid[cell]));
          this._c.lerp(this._hot, (1 - age / F) * fl);
          m.setColorAt(id, this._c);
          // emissive envelope follows the same fade: visible from any angle
          if (this.glowAttr) this.glowAttr.setX(id, 1 - age / F);
          touched = true;
        }
        if (touched) {
          if (m.instanceColor) m.instanceColor.needsUpdate = true;
          if (this.glowAttr) this.glowAttr.needsUpdate = true;
        }
      }
    }
    if (this.composer && S.bloom) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
};

/* ---------------- instances ---------------- */
let sim2d = new Sim2D(S.size2d);
let sim3d = new Sim3D(S.size3d);
let hoverCell = null;

/* ---------------- 2D camera / interaction ---------------- */
function fitView2D() {
  const wrap = $('wrap2D');
  const r = wrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const z = Math.min((r.width * dpr) / (sim2d.W + 8), (r.height * dpr) / (sim2d.H + 8));
  renderer2d.cam.zoom = clamp(z, 0.6, 64);
  renderer2d.cam.x = sim2d.W / 2;
  renderer2d.cam.y = sim2d.H / 2;
  renderer2d.dirty = true;
}
function resizeCanvases() {
  const wrap = $('wrap2D');
  const r = wrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const gl = $('gl');
  const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
  if (gl.width !== w || gl.height !== h) { gl.width = w; gl.height = h; }
  render3d.resize();
}
function clientToCell(e) {
  const gl = $('gl');
  const rect = gl.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const sx = (e.clientX - rect.left) * dpr, sy = (e.clientY - rect.top) * dpr;
  const cam = renderer2d.cam;
  return { x: cam.x + (sx - gl.width / 2) / cam.zoom, y: cam.y + (sy - gl.height / 2) / cam.zoom };
}

function wireCanvas2D() {
  const gl = $('gl');
  const pointers = new Map();
  let panning = false, painting = false, lastCell = null, movedPx = 0, lastPinch = 0;
  let downPos = null, downButton = 0;

  gl.style.touchAction = 'none';
  gl.addEventListener('contextmenu', (e) => e.preventDefault());

  gl.addEventListener('pointerdown', (e) => {
    gl.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    movedPx = 0;
    downPos = { x: e.clientX, y: e.clientY };
    downButton = e.button;
    if (pointers.size === 2) {
      const p = [...pointers.values()];
      lastPinch = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      painting = false; panning = true;
      return;
    }
    const tool = (e.button === 2) ? 'erase' : S.tool;
    if (tool === 'pan' || e.button === 1) { panning = true; return; }
    const c = clientToCell(e);
    const cx = Math.floor(c.x), cy = Math.floor(c.y);
    if (tool === 'ant') {
      sim2d.addAnt(cx, cy);
      renderer2d.dirty = true;
      return;
    }
    painting = true; lastCell = null;
    paintLine(cx, cy, cx, cy, tool);
  });
  gl.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (prev) {
      movedPx += Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    const c = clientToCell(e);
    hoverCell = { x: Math.floor(c.x), y: Math.floor(c.y) };
    if (pointers.size === 2 && panning) {
      const p = [...pointers.values()];
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      if (lastPinch > 0) {
        const cam = renderer2d.cam;
        cam.zoom = clamp(cam.zoom * (d / lastPinch), 0.5, 300);
      }
      lastPinch = d;
      return;
    }
    if (panning && prev) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cam = renderer2d.cam;
      cam.x -= (e.clientX - prev.x) * dpr / cam.zoom;
      cam.y -= (e.clientY - prev.y) * dpr / cam.zoom;
      return;
    }
    if (painting) {
      const tool = (downButton === 2) ? 'erase' : S.tool;
      const cx = Math.floor(c.x), cy = Math.floor(c.y);
      const lc = lastCell || { x: cx, y: cy };
      paintLine(lc.x, lc.y, cx, cy, tool);
    }
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) lastPinch = 0;
    if (pointers.size === 0) { panning = false; painting = false; lastCell = null; }
  };
  gl.addEventListener('pointerup', up);
  gl.addEventListener('pointercancel', up);
  gl.addEventListener('pointerleave', () => { hoverCell = null; });
  gl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const cam = renderer2d.cam;
    const before = clientToCell(e);
    cam.zoom = clamp(cam.zoom * Math.exp(-e.deltaY * 0.0014), 0.5, 300);
    const after = clientToCell(e);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
  }, { passive: false });

  function paintLine(x0, y0, x1, y1, tool) {
    const v = tool === 'erase' ? 0 : (S.paintState % sim2d.nStates);
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const steps = Math.max(dx, dy, 1);
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + (x1 - x0) * (i / steps));
      const y = Math.round(y0 + (y1 - y0) * (i / steps));
      sim2d.paint(x, y, v);
    }
    lastCell = { x: x1, y: y1 };
    renderer2d.dirty = true;
  }
}

/* 3D picking */
function wireCanvas3D() {
  const canvas = $('gl3');
  let downAt = null;
  canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, btn: e.button }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    const btn = downAt.btn;
    downAt = null;
    if (moved > 6 || !render3d.ready) return;
    handle3DClick(e, btn);
  });
  canvas.addEventListener('dblclick', (e) => {
    if (!render3d.ready) return;
    handle3DClick(e, 0, true);
  });
}
function handle3DClick(e, btn, forceBee = false) {
  const canvas = $('gl3');
  const rect = canvas.getBoundingClientRect();
  const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  const ray = new T.Raycaster();
  ray.setFromCamera({ x: nx, y: ny }, render3d.camera);
  const tool = btn === 2 ? 'erase' : S.tool;
  const hits = render3d.voxelMesh ? ray.intersectObject(render3d.voxelMesh) : [];
  if (forceBee || tool === 'ant') {
    let p = null;
    if (hits.length) {
      const h = hits[0];
      p = h.point.clone().add(h.face.normal.clone().multiplyScalar(0.6));
    } else {
      const plane = new T.Plane(new T.Vector3(0, 1, 0), 0);
      p = new T.Vector3();
      ray.ray.intersectPlane(plane, p);
    }
    if (p) {
      const N = sim3d.N;
      const cx = clamp(Math.round(p.x + N / 2 - 0.5), 0, N - 1);
      const cy = clamp(Math.round(p.y + N / 2 - 0.5), 0, N - 1);
      const cz = clamp(Math.round(p.z + N / 2 - 0.5), 0, N - 1);
      if (sim3d.bees.length >= 12) { snack('Maximum 12 bees.'); return; }
      sim3d.bees.push({ x: cx, y: cy, z: cz, dir: (Math.random() * 6) | 0, up: 2 });
      if (sim3d.bees[sim3d.bees.length - 1].dir === 2 || sim3d.bees[sim3d.bees.length - 1].dir === 3)
        sim3d.bees[sim3d.bees.length - 1].up = 0;
      snack('Bee placed at (' + cx + ', ' + cy + ', ' + cz + ')');
      syncAntStats();
    }
    return;
  }
  if (tool === 'paint' || tool === 'erase') {
    const v = tool === 'erase' ? 0 : (S.paintState % sim3d.nStates);
    if (hits.length) {
      const inst = hits[0].instanceId;
      const cell = render3d.instToCell[inst];
      if (cell !== undefined) {
        const N = sim3d.N;
        sim3d.grid[cell] = v;
        if (v === 0) sim3d.alive--;
        render3d.setVoxel(cell, v);
        return;
      }
    }
    // paint on center plane
    const plane = new T.Plane(new T.Vector3(0, 1, 0), 0);
    const p = new T.Vector3();
    if (ray.ray.intersectPlane(plane, p)) {
      const N = sim3d.N;
      const cx = clamp(Math.round(p.x + N / 2 - 0.5), 0, N - 1);
      const cz = clamp(Math.round(p.z + N / 2 - 0.5), 0, N - 1);
      const cy = sim3d.bees[0] ? sim3d.bees[0].y : (N >> 1);
      const i = sim3d.idx(cx, cy, cz);
      const old = sim3d.grid[i];
      if (old === 0 && v !== 0) sim3d.alive++;
      if (old !== 0 && v === 0) sim3d.alive--;
      sim3d.grid[i] = v;
      render3d.setVoxel(i, v);
    }
  }
}
$('gl3')?.addEventListener('contextmenu', (e) => e.preventDefault());

/* ---------------- rules UI ---------------- */
function currentRules() { return S.mode === '2d' ? S.rules2d : S.rules3d; }
function allowedTurns() { return S.mode === '2d' ? TURNS_2D : TURNS_3D; }
function turnLabels() { return S.mode === '2d' ? TURNS_2D_LABEL : TURNS_3D_LABEL; }

function ensureColors(rules) {
  while (rules.colors.length < rules.turns.length) rules.colors.push(genColor(rules.colors.length));
  rules.colors.length = rules.turns.length;
}
function applyRulesToSim() {
  const r = currentRules();
  ensureColors(r);
  if (S.mode === '2d') {
    sim2d.setRules(r.turns, r.colors);
    renderer2d.dirty = true;
    renderer2d._w = 0;
  } else {
    sim3d.setRules(r.turns, r.colors);
    if (render3d.ready) render3d.rebuildAll();
  }
  S.paintState = clamp(S.paintState, 0, Math.max(0, r.turns.length - 1));
}
function refreshRulesUI() {
  const r = currentRules();
  ensureColors(r);
  $('ruleText').value = r.turns.join('');
  $('ruleStringChip').textContent = r.turns.join('');
  $('stateCount').textContent = '· ' + r.turns.length + ' states';
  $('ruleHint').textContent = S.mode === '2d' ? '— L left · R right · U u-turn · C straight' : '— F fwd · B back · L R U D relative';
  const list = $('rulesList');
  list.innerHTML = '';
  const labels = turnLabels();
  const turns = allowedTurns();
  r.turns.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'm2-rule';
    const idx = document.createElement('div');
    idx.className = 'm2-rule__idx'; idx.textContent = i;
    const col = document.createElement('input');
    col.type = 'color'; col.value = r.colors[i]; col.title = 'State ' + i + ' color';
    col.addEventListener('input', () => {
      r.colors[i] = col.value.toUpperCase();
      applyRulesToSim();
      buildPaintDots();
      saveSoon();
    });
    const turnWrap = document.createElement('label');
    turnWrap.className = 'm2-rule__turn';
    const arrow = document.createElement('span');
    arrow.className = 'm2-rule__arrow';
    arrow.textContent = S.mode === '2d'
      ? ({ L: '↰', R: '↱', U: '↩', C: '↑' })[t]
      : ({ F: '↑', B: '↓', L: '←', R: '→', U: '⬆', D: '⬇' })[t];
    const sel = document.createElement('select');
    turns.forEach((tt) => {
      const o = document.createElement('option');
      o.value = tt; o.textContent = labels[tt];
      if (tt === t) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => {
      r.turns[i] = sel.value;
      $('ruleText').value = r.turns.join('');
      $('ruleStringChip').textContent = r.turns.join('');
      arrow.textContent = sel.selectedOptions[0].textContent.trim()[0] || '';
      applyRulesToSim(); doReset();
      saveSoon(); updateHashSoon();
    });
    turnWrap.appendChild(arrow);
    turnWrap.appendChild(sel);
    const del = document.createElement('button');
    del.className = 'm2-icon-btn m2-rule__del';
    del.title = 'Remove state ' + i;
    del.innerHTML = '<span class="material-icons" style="font-size:18px">close</span>';
    del.disabled = r.turns.length <= 2;
    del.style.opacity = r.turns.length <= 2 ? 0.35 : 1;
    del.addEventListener('click', () => {
      if (r.turns.length <= 2) { snack('A rule needs at least 2 states.'); return; }
      r.turns.splice(i, 1); r.colors.splice(i, 1);
      applyRulesToSim(); doReset(); refreshRulesUI(); buildPaintDots(); saveSoon(); updateHashSoon();
    });
    row.appendChild(idx); row.appendChild(col); row.appendChild(turnWrap); row.appendChild(del);
    list.appendChild(row);
  });
  buildPaintDots();
  // preset select match
  const presets = S.mode === '2d' ? PRESETS_2D : PRESETS_3D;
  const sel = $('presetSelect');
  sel.innerHTML = '';
  const cur = r.turns.join('');
  let matched = -1;
  presets.forEach((p, i) => {
    const o = document.createElement('option');
    o.value = String(i); o.textContent = p.name;
    sel.appendChild(o);
    if (p.rule === cur) matched = i;
  });
  const oc = document.createElement('option');
  oc.value = 'custom'; oc.textContent = matched >= 0 ? '— Custom —' : 'Custom rule';
  sel.appendChild(oc);
  sel.value = matched >= 0 ? String(matched) : 'custom';
  const desc = matched >= 0 ? presets[matched].desc : 'Custom rule with ' + r.turns.length + ' states. Edit colors and turns freely.';
  $('presetDesc').textContent = desc;
}
function buildPaintDots() {
  const r = currentRules();
  const box = $('paintStates');
  box.innerHTML = '';
  r.turns.forEach((t, i) => {
    const d = document.createElement('button');
    d.className = 'm2-paint-dot' + (S.paintState === i ? ' m2-paint-dot--sel' : '');
    d.style.background = r.colors[i];
    d.textContent = i;
    d.title = 'Paint state ' + i + ' (' + t + ')';
    d.addEventListener('click', () => {
      S.paintState = i;
      $('toolSelect').value = 'paint';
      S.tool = 'paint';
      buildPaintDots();
    });
    box.appendChild(d);
  });
}

/* ---------------- transport / stats ---------------- */
function setRunning(v) {
  S.running = v;
  $('playIcon').textContent = v ? 'pause' : 'play_arrow';
  $('playLabel').textContent = v ? 'Pause' : 'Run';
  $('fabPlayIcon').textContent = v ? 'pause' : 'play_arrow';
  $('fabPlayIcon3').textContent = v ? 'pause' : 'play_arrow';
  for (const id of ['playIcon', 'fabPlayIcon', 'fabPlayIcon3']) {
    const el = $(id);
    el.classList.remove('m2-pop');
    void el.offsetWidth;
    el.classList.add('m2-pop');
  }
}
function doReset() {
  if (S.mode === '2d') { sim2d.reset(); renderer2d.dirty = true; renderer2d._w = 0; fitView2D(); }
  else { sim3d.reset(); if (render3d.ready) render3d.rebuildAll(); }
  syncAntStats();
  updateStats(true);
}
function syncAntStats() {
  const n = S.mode === '2d' ? sim2d.ants.length : sim3d.bees.length;
  $('statAnts').textContent = n;
}

/* perf tracking */
let lastT = performance.now(), fpsEMA = 60, spsEMA = 0, lastSteps = 0, lastStatDOM = 0;
function updateStats(force = false) {
  const now = performance.now();
  if (!force && now - lastStatDOM < 250) return;
  lastStatDOM = now;
  const steps = S.mode === '2d' ? sim2d.steps : sim3d.steps;
  const alive = S.mode === '2d' ? sim2d.alive : sim3d.alive;
  $('statSteps').textContent = fmtInt(steps);
  $('statAlive').textContent = fmtInt(alive);
  $('statFps').textContent = Math.round(fpsEMA);
  $('spsVal').textContent = fmtInt(spsEMA) + ' steps/s';
  $('perfText').textContent = fmtInt(spsEMA) + ' steps/s';
  if (S.mode === '2d') {
    const a = sim2d.ants[0];
    if (a) $('hudPos').textContent = 'ant (' + a.x + ', ' + a.y + ') → ' + Sim2D.DIR_NAME[a.dir] + ' · ' + fmtInt(steps) + ' steps';
  } else {
    const b = sim3d.bees[0];
    if (b) $('hudBee').textContent = 'bee (' + b.x + ', ' + b.y + ', ' + b.z + ') · ' + fmtInt(steps) + ' steps · ' + fmtInt(alive) + ' voxels';
  }
}

/* ---------------- main loop ---------------- */
function tick(now) {
  requestAnimationFrame(tick);
  const dt = now - lastT;
  lastT = now;
  if (dt > 0) fpsEMA = fpsEMA * 0.92 + (1000 / Math.max(dt, 0.01)) * 0.08;

  if (S.running) {
    const t0 = performance.now();
    let batches = 0;
    const maxBatches = S.turbo ? 60 : 1;
    let done = 0;
    do {
      if (S.mode === '2d') {
        if (S.follow && sim2d.ants[0]) {
          const a = sim2d.ants[0];
          renderer2d.cam.x += (a.x + 0.5 - renderer2d.cam.x) * 0.25;
          renderer2d.cam.y += (a.y + 0.5 - renderer2d.cam.y) * 0.25;
        }
        sim2d.run(S.stepsPerFrame, S.wrap2d);
        renderer2d.dirty = true;
      } else if (render3d.ready) {
        sim3d.run(S.stepsPerFrame, S.wrap3d);
        render3d.syncDirty();
      }
      done += S.stepsPerFrame * (S.mode === '2d' ? sim2d.ants.length : Math.max(1, sim3d.bees.length));
      batches++;
      if (!S.turbo) break;
    } while (performance.now() - t0 < 12 && batches < maxBatches);

    const el = Math.max(performance.now() - t0, 0.5);
    const inst = (done / el) * 1000;
    spsEMA = spsEMA === 0 ? inst : spsEMA * 0.8 + inst * 0.2;
  }

  if (S.mode === '2d') {
    if (S.fx.trail) sim2d.updateTrail(Math.min(dt, 100) / 1000);
    renderer2d.draw(sim2d);
    drawOverlay2D();
  } else {
    render3d.frame(Math.min(dt, 100) / 1000);
  }
  updateStats();
}

/* ---------------- mode switch ---------------- */
async function setMode(m) {
  S.mode = m;
  const is2 = m === '2d';
  $('tab2D').classList.toggle('m2-tab--active', is2);
  $('tab3D').classList.toggle('m2-tab--active', !is2);
  $('tab2D').setAttribute('aria-selected', is2);
  $('tab3D').setAttribute('aria-selected', !is2);
  $('wrap2D').hidden = !is2;
  $('wrap3D').hidden = is2;
  $('card3D').hidden = is2;
  $('fx2d').hidden = !is2;
  $('fx3d').hidden = is2;
  $('fogSlider').value = S.fogDensity;
  $('fogVal').textContent = (+S.fogDensity).toFixed(3);
  // grid size options per mode
  const gs = $('gridSize');
  const cur = is2 ? S.size2d : S.size3d;
  gs.innerHTML = '';
  (is2 ? [128, 256, 512, 1024] : [32, 64, 128]).forEach((n) => {
    const o = document.createElement('option');
    o.value = String(n); o.textContent = is2 ? (n + ' × ' + n) : (n + '³ cube');
    if (n === cur) o.selected = true;
    gs.appendChild(o);
  });
  $('chkWrap').checked = is2 ? S.wrap2d : S.wrap3d;
  refreshRulesUI();
  syncAntStats();
  resizeCanvases();
  if (!is2) {
    render3d.resize();
    await render3d.ensure();
    render3d.resize();
    render3d.rebuildAll();
  } else {
    fitView2D();
  }
  updateStats(true);
  saveSoon();
}

/* ---------------- persistence / share ---------------- */
let saveT = 0;
function saveSoon() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try {
      localStorage.setItem('ant-bee-v1', JSON.stringify({
        mode: S.mode, stepsPerFrame: S.stepsPerFrame, turbo: S.turbo,
        wrap2d: S.wrap2d, wrap3d: S.wrap3d, showGrid: S.showGrid, follow: S.follow,
        tool: S.tool, paintState: S.paintState, size2d: S.size2d, size3d: S.size3d,
        rules2d: S.rules2d, rules3d: S.rules3d, dark: document.body.classList.contains('dark'),
        fx: S.fx, beeLight: S.beeLight, fogDensity: S.fogDensity,
        trailTime: S.trailTime, voxelOpacity: S.voxelOpacity,
        bloom: S.bloom, bloomStrength: S.bloomStrength, cellGlow3d: S.cellGlow3d,
        cellGlowTime: S.cellGlowTime, cellFlash: S.cellFlash,
        bloomThreshold: S.bloomThreshold, bloomRadius: S.bloomRadius,
        glowStrength2d: S.glowStrength2d, glowSpread: S.glowSpread,
        antLight: S.antLight, antRadius: S.antRadius,
        glowColor: S.glowColor, trailFlash: S.trailFlash, glowThr2d: S.glowThr2d,
        voxelScale: S.voxelScale,
      }));
    } catch (e) { /* private mode */ }
  }, 300);
}
function restore() {
  try {
    const raw = localStorage.getItem('ant-bee-v1');
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.rules2d?.turns?.length >= 2) S.rules2d = d.rules2d;
    if (d.rules3d?.turns?.length >= 2) S.rules3d = d.rules3d;
    Object.assign(S, {
      stepsPerFrame: d.stepsPerFrame ?? S.stepsPerFrame,
      turbo: !!d.turbo, wrap2d: !!d.wrap2d, wrap3d: d.wrap3d ?? true,
      showGrid: d.showGrid ?? true, follow: !!d.follow,
      tool: d.tool ?? 'paint', paintState: d.paintState ?? 1,
      size2d: d.size2d ?? 256, size3d: d.size3d ?? 64,
      beeLight: d.beeLight ?? true, fogDensity: d.fogDensity ?? 0.011,
      trailTime: d.trailTime ?? 1.2, voxelOpacity: d.voxelOpacity ?? 0.85,
      bloom: d.bloom ?? true, bloomStrength: d.bloomStrength ?? 0.85, cellGlow3d: d.cellGlow3d ?? true,
      cellGlowTime: d.cellGlowTime ?? 1.1, cellFlash: d.cellFlash ?? 1.0,
      bloomThreshold: d.bloomThreshold ?? 0.6, bloomRadius: d.bloomRadius ?? 0.6,
      glowStrength2d: d.glowStrength2d ?? 1.0, glowSpread: d.glowSpread ?? 1,
      antLight: d.antLight ?? true, antRadius: d.antRadius ?? 12,
      glowColor: d.glowColor ?? '#FF9E50', trailFlash: d.trailFlash ?? 1.0, glowThr2d: d.glowThr2d ?? 0.0,
      voxelScale: d.voxelScale ?? 0.95,
    });
    if (d.fx) S.fx = { glow: d.fx.glow ?? true, vig: d.fx.vig ?? true, trail: d.fx.trail ?? true };
    if (d.dark) document.body.classList.add('dark');
    return d.mode;
  } catch (e) { return null; }
}
let hashT = 0;
function updateHashSoon() {
  clearTimeout(hashT);
  hashT = setTimeout(() => {
    const r = currentRules();
    const p = new URLSearchParams();
    p.set('m', S.mode);
    p.set('r', r.turns.join(''));
    p.set('c', r.colors.map((c) => c.replace('#', '')).join('.'));
    p.set('s', String(S.stepsPerFrame));
    p.set('g', String(S.mode === '2d' ? S.size2d : S.size3d));
    history.replaceState(null, '', '#' + p.toString());
  }, 400);
}
function parseHash() {
  if (!location.hash || location.hash.length < 3) return null;
  try {
    const p = new URLSearchParams(location.hash.slice(1));
    const m = p.get('m'), r = p.get('r');
    if (!r) return null;
    const mode = m === '3d' ? '3d' : '2d';
    const turns = r.toUpperCase().split('').filter((c) => (mode === '2d' ? TURNS_2D : TURNS_3D).includes(c));
    if (turns.length < 2 || turns.length > 16) return null;
    const cols = (p.get('c') || '').split('.').map((x) => '#' + x.toUpperCase()).filter((x) => /^#[0-9A-F]{6}$/.test(x));
    while (cols.length < turns.length) cols.push(genColor(cols.length));
    const s = parseInt(p.get('s') || '10000', 10);
    const g = parseInt(p.get('g') || '0', 10);
    return { mode, turns, cols: cols.slice(0, turns.length), steps: clamp(s || 10000, 1, 2000000), grid: g };
  } catch (e) { return null; }
}

/* ---------------- PNG / export ---------------- */
function download(url, name) {
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}
function exportPNG() {
  if (S.mode === '2d') {
    const gl = $('gl'), ov = $('overlay2d');
    const t = document.createElement('canvas');
    t.width = gl.width; t.height = gl.height;
    const ctx = t.getContext('2d');
    ctx.drawImage(gl, 0, 0);
    ctx.drawImage(ov, 0, 0, t.width, t.height);
    download(t.toDataURL('image/png'), 'langton-ant-2d.png');
    snack('PNG snapshot saved');
  } else {
    if (!render3d.ready) { snack('3D not ready yet'); return; }
    render3d.frame();
    download(render3d.renderer.domElement.toDataURL('image/png'), 'langton-bee-3d.png');
    snack('PNG snapshot saved');
  }
}

/* ---------------- wiring ---------------- */
function wireUI() {
  $('tab2D').addEventListener('click', () => setMode('2d'));
  $('tab3D').addEventListener('click', () => setMode('3d'));

  const togglePlay = () => setRunning(!S.running);
  $('btnPlay').addEventListener('click', togglePlay);
  $('fabPlay').addEventListener('click', togglePlay);
  $('fabPlay3').addEventListener('click', togglePlay);
  const stepOnce = () => {
    setRunning(false);
    if (S.mode === '2d') { sim2d.run(S.stepsPerFrame, S.wrap2d); renderer2d.dirty = true; spsEMA = 0; }
    else if (render3d.ready) { sim3d.run(S.stepsPerFrame, S.wrap3d); render3d.syncDirty(); }
    updateStats(true);
  };
  $('btnStep').addEventListener('click', stepOnce);
  $('fabStep').addEventListener('click', stepOnce);
  $('btnReset').addEventListener('click', () => { doReset(); snack('World reset — single agent at center'); });

  // speed slider log 1..1M
  const slider = $('speedSlider');
  const syncSpeed = () => {
    S.stepsPerFrame = Math.max(1, Math.round(10 ** parseFloat(slider.value)));
    $('speedVal').textContent = fmtInt(S.stepsPerFrame);
    saveSoon(); updateHashSoon();
  };
  slider.value = Math.log10(S.stepsPerFrame).toFixed(2);
  $('speedVal').textContent = fmtInt(S.stepsPerFrame);
  slider.addEventListener('input', syncSpeed);

  $('chkTurbo').addEventListener('change', (e) => { S.turbo = e.target.checked; saveSoon(); });
  $('chkGlow').addEventListener('change', (e) => { S.fx.glow = e.target.checked; saveSoon(); });
  const syncGlowColorUI = () => {
    const c = (S.glowColor || '#FF9E50').toUpperCase();
    if ($('glowColor2d')) { $('glowColor2d').value = c; $('glowColor2dHex').textContent = c; }
    if ($('glowColor3d')) { $('glowColor3d').value = c; $('glowColor3dHex').textContent = c; }
  };
  const onGlowColor = (e) => {
    S.glowColor = e.target.value.toUpperCase();
    syncGlowTint();
    syncGlowColorUI();
    if (render3d.ready) render3d.refreshHot();
    saveSoon();
  };
  $('glowColor2d').addEventListener('input', onGlowColor);
  $('glowColor3d').addEventListener('input', onGlowColor);
  $('glowThrSlider').addEventListener('input', (e) => {
    S.glowThr2d = parseFloat(e.target.value);
    $('glowThrVal').textContent = S.glowThr2d.toFixed(2);
    saveSoon();
  });
  $('trailFlashSlider').addEventListener('input', (e) => {
    S.trailFlash = parseFloat(e.target.value);
    $('trailFlashVal').textContent = S.trailFlash.toFixed(2);
    saveSoon();
  });
  $('glowStrSlider').addEventListener('input', (e) => {
    S.glowStrength2d = parseFloat(e.target.value);
    $('glowStrVal').textContent = S.glowStrength2d.toFixed(2);
    saveSoon();
  });
  $('glowSpreadSlider').addEventListener('input', (e) => {
    S.glowSpread = parseInt(e.target.value, 10);
    $('glowSpreadVal').textContent = S.glowSpread + (S.glowSpread > 1 ? ' cells' : ' cell');
    saveSoon();
  });
  $('chkAntLight').addEventListener('change', (e) => { S.antLight = e.target.checked; saveSoon(); });
  $('antRadiusSlider').addEventListener('input', (e) => {
    S.antRadius = parseInt(e.target.value, 10);
    $('antRadiusVal').textContent = S.antRadius + ' cells';
    saveSoon();
  });
  $('chkVig').addEventListener('change', (e) => { S.fx.vig = e.target.checked; saveSoon(); });
  $('chkBeeLight').addEventListener('change', (e) => { S.beeLight = e.target.checked; saveSoon(); });
  $('chkTrail').addEventListener('change', (e) => {
    S.fx.trail = e.target.checked;
    if (!S.fx.trail) sim2d.clearTrail();
    saveSoon();
  });
  $('trailSlider').addEventListener('input', (e) => {
    S.trailTime = parseFloat(e.target.value);
    $('trailVal').textContent = S.trailTime.toFixed(1) + 's';
    saveSoon();
  });
  $('opSlider').addEventListener('input', (e) => {
    S.voxelOpacity = parseFloat(e.target.value);
    $('opVal').textContent = S.voxelOpacity.toFixed(2);
    if (render3d.ready) render3d.applyVoxelOpacity();
    saveSoon();
  });
  $('chkBloom').addEventListener('change', (e) => { S.bloom = e.target.checked; saveSoon(); });
  $('bloomSlider').addEventListener('input', (e) => {
    S.bloomStrength = parseFloat(e.target.value);
    $('bloomVal').textContent = S.bloomStrength.toFixed(2);
    if (render3d.ready && render3d.bloomPass) render3d.bloomPass.strength = S.bloomStrength;
    saveSoon();
  });
  $('bloomThrSlider').addEventListener('input', (e) => {
    S.bloomThreshold = parseFloat(e.target.value);
    $('bloomThrVal').textContent = S.bloomThreshold.toFixed(2);
    if (render3d.ready && render3d.bloomPass) render3d.bloomPass.threshold = S.bloomThreshold;
    saveSoon();
  });
  $('bloomRadSlider').addEventListener('input', (e) => {
    S.bloomRadius = parseFloat(e.target.value);
    $('bloomRadVal').textContent = S.bloomRadius.toFixed(2);
    if (render3d.ready && render3d.bloomPass) render3d.bloomPass.radius = S.bloomRadius;
    saveSoon();
  });
  $('flashSlider').addEventListener('input', (e) => {
    S.cellFlash = parseFloat(e.target.value);
    $('flashVal').textContent = S.cellFlash.toFixed(2);
    if (render3d._uGlowBoost) render3d._uGlowBoost.value = 1.1 * S.cellFlash;
    saveSoon();
  });
  $('chkCellGlow').addEventListener('change', (e) => {
    S.cellGlow3d = e.target.checked;
    if (!S.cellGlow3d && render3d.ready && render3d.voxelMesh) {
      // finalize all glowing voxels to their base size/color instantly
      for (const cell of [...render3d.young.keys()]) render3d.finalizeYoung(cell);
    }
    saveSoon();
  });
  $('glowTimeSlider').addEventListener('input', (e) => {
    S.cellGlowTime = parseFloat(e.target.value);
    $('glowTimeVal').textContent = S.cellGlowTime.toFixed(1) + 's';
    saveSoon();
  });
  $('fogSlider').addEventListener('input', (e) => {
    S.fogDensity = parseFloat(e.target.value);
    $('fogVal').textContent = S.fogDensity.toFixed(3);
    if (render3d.ready && render3d.scene.fog) render3d.scene.fog.density = S.fogDensity;
    saveSoon();
  });
  $('chkGrid').addEventListener('change', (e) => { S.showGrid = e.target.checked; saveSoon(); });
  $('chkFollow').addEventListener('change', (e) => { S.follow = e.target.checked; saveSoon(); });
  $('chkTrails').addEventListener('change', (e) => { S.showAnt = e.target.checked; saveSoon(); });
  $('chkWrap').addEventListener('change', (e) => {
    if (S.mode === '2d') S.wrap2d = e.target.checked;
    else S.wrap3d = e.target.checked;
    snack(e.target.checked ? 'Wrap-around edges ON (torus)' : 'Wrap OFF — ' + (S.mode === '2d' ? 'infinite auto-centering' : 'bees bounce off walls'));
    saveSoon();
  });
  $('toolSelect').addEventListener('change', (e) => { S.tool = e.target.value; saveSoon(); });
  $('gridSize').addEventListener('change', (e) => {
    const n = parseInt(e.target.value, 10);
    if (S.mode === '2d') {
      S.size2d = n;
      sim2d = new Sim2D(n);
      applyRulesToSim();
      renderer2d._w = 0; renderer2d.dirty = true;
      fitView2D(); syncAntStats(); updateStats(true);
      snack('2D grid rebuilt: ' + n + ' × ' + n);
    } else {
      S.size3d = n;
      S.fogDensity = Math.min(0.03, 0.7 / n);
      $('fogSlider').value = S.fogDensity;
      $('fogVal').textContent = S.fogDensity.toFixed(3);
      sim3d = new Sim3D(n);
      applyRulesToSim();
      if (render3d.ready) render3d.rebuildAll();
      syncAntStats(); updateStats(true);
      snack('3D cube rebuilt: ' + n + '³');
    }
    saveSoon(); updateHashSoon();
  });

  $('presetSelect').addEventListener('change', (e) => {
    if (e.target.value === 'custom') return;
    const presets = S.mode === '2d' ? PRESETS_2D : PRESETS_3D;
    const p = presets[parseInt(e.target.value, 10)];
    if (!p) return;
    const r = currentRules();
    r.turns = p.rule.split('');
    r.colors = (p.colors && p.colors.length === p.rule.length) ? p.colors.slice()
      : p.rule.split('').map((_, i) => i === 0 ? (S.mode === '2d' ? '#101014' : '#121218') : genColor(i));
    S.paintState = 1 % r.turns.length;
    applyRulesToSim(); doReset(); refreshRulesUI(); saveSoon(); updateHashSoon();
    snack('Preset loaded: ' + p.name);
  });
  $('ruleText').addEventListener('change', () => {
    const allowed = allowedTurns();
    const raw = $('ruleText').value.toUpperCase().replace(/[^A-Z]/g, '');
    const turns = raw.split('').filter((c) => allowed.includes(c));
    if (turns.length < 2) { $('ruleError').textContent = 'Need at least 2 turns (' + allowed.join(' ') + ').'; return; }
    if (turns.length > 16) { $('ruleError').textContent = 'Maximum 16 states.'; return; }
    $('ruleError').textContent = '';
    const r = currentRules();
    r.turns = turns;
    ensureColors(r);
    S.paintState = 1 % turns.length;
    applyRulesToSim(); doReset(); refreshRulesUI(); saveSoon(); updateHashSoon();
  });
  $('btnAddState').addEventListener('click', () => {
    const r = currentRules();
    if (r.turns.length >= 16) { snack('Maximum 16 states'); return; }
    const allowed = allowedTurns();
    r.turns.push(allowed[r.turns.length % allowed.length]);
    r.colors.push(genColor(r.colors.length));
    applyRulesToSim(); doReset(); refreshRulesUI(); saveSoon(); updateHashSoon();
  });

  $('btnClear').addEventListener('click', () => {
    if (S.mode === '2d') { sim2d.clearCells(); renderer2d.dirty = true; }
    else { sim3d.clearCells(); if (render3d.ready) render3d.rebuildAll(); }
    updateStats(true);
    snack('Cells cleared (agents kept)');
  });
  $('btnCenter').addEventListener('click', () => {
    if (S.mode === '2d') {
      renderer2d.cam.x = sim2d.W / 2; renderer2d.cam.y = sim2d.H / 2;
    } else if (render3d.ready) {
      render3d.camera.position.set(sim3d.N * 0.9, sim3d.N * 0.7, sim3d.N * 0.9);
      render3d.controls.target.set(0, 0, 0);
    }
  });
  $('fabZoomIn').addEventListener('click', () => { renderer2d.cam.zoom = clamp(renderer2d.cam.zoom * 1.3, 0.5, 300); });
  $('fabZoomOut').addEventListener('click', () => { renderer2d.cam.zoom = clamp(renderer2d.cam.zoom / 1.3, 0.5, 300); });
  const fit = () => fitView2D();
  $('fabFit').addEventListener('click', fit);
  $('fabResetCam').addEventListener('click', () => $('btnCenter').click());
  $('btnPng').addEventListener('click', exportPNG);
  $('btnShare').addEventListener('click', async () => {
    updateHashSoon();
    await new Promise((r) => setTimeout(r, 450));
    try {
      await navigator.clipboard.writeText(location.href);
      snack('Share link copied to clipboard');
    } catch (e) {
      prompt('Copy this link:', location.href);
    }
  });
  $('btnExport').addEventListener('click', () => {
    const data = { app: 'ant-and-bee', version: 1, S };
    download(URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), 'ant-bee-rules.json');
    snack('Rules exported as JSON');
  });
  $('btnImport').addEventListener('click', () => $('fileImport').click());
  $('fileImport').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(rd.result);
        const s = d.S || d;
        if (s.rules2d?.turns?.length >= 2) S.rules2d = s.rules2d;
        if (s.rules3d?.turns?.length >= 2) S.rules3d = s.rules3d;
        applyRulesToSim(); refreshRulesUI(); updateHashSoon();
        snack('Rules imported');
      } catch (err) { snack('Import failed: not valid JSON'); }
    };
    rd.readAsText(f);
    e.target.value = '';
  });

  // 3D view
  $('voxelScale').addEventListener('input', (e) => {
    S.voxelScale = parseFloat(e.target.value);
    $('voxelScaleVal').textContent = S.voxelScale.toFixed(2);
    if (render3d.ready) render3d.applyVoxelScale();
    saveSoon();
  });
  $('chkSpin').addEventListener('change', (e) => { S.spin = e.target.checked; });
  $('chkWireframe').addEventListener('change', (e) => {
    if (render3d.ready && render3d.groundGrid) render3d.groundGrid.visible = e.target.checked;
  });

  // drawer / theme / help
  $('btnDrawer').addEventListener('click', () => $('drawer').classList.toggle('hidden'));
  $('btnTheme').addEventListener('click', (e) => {
    document.body.classList.toggle('dark');
    const dark = document.body.classList.contains('dark');
    e.currentTarget.querySelector('.material-icons').textContent = dark ? 'light_mode' : 'dark_mode';
    saveSoon();
  });
  const openHelp = () => { $('helpDialog').hidden = false; $('scrim').hidden = false; };
  const closeHelp = () => { $('helpDialog').hidden = true; $('scrim').hidden = true; };
  $('btnHelp').addEventListener('click', openHelp);
  $('btnCloseHelp').addEventListener('click', closeHelp);
  $('scrim').addEventListener('click', closeHelp);

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type === 'text') return;
    if (e.code === 'Space') { e.preventDefault(); setRunning(!S.running); }
    else if (e.key === 's' || e.key === 'S') stepOnce();
    else if (e.key === 'r' || e.key === 'R') doReset();
    else if (e.key === 'f' || e.key === 'F') { if (S.mode === '2d') fitView2D(); }
    else if (e.key === 'h' || e.key === 'H') $('drawer').classList.toggle('hidden');
    else if (e.key === '1') setMode('2d');
    else if (e.key === '2') setMode('3d');
    else if (e.key === '+' || e.key === '=') renderer2d.cam.zoom = clamp(renderer2d.cam.zoom * 1.2, 0.5, 300);
    else if (e.key === '-') renderer2d.cam.zoom = clamp(renderer2d.cam.zoom / 1.2, 0.5, 300);
    else if (e.key === 'Escape') closeHelp();
  });
  window.addEventListener('resize', resizeCanvases);
}

/* ---------------- boot ---------------- */
async function boot() {
  const savedMode = restore();
  const h = parseHash();
  if (h) {
    if (h.mode === '2d') { S.rules2d = { turns: h.turns, colors: h.cols }; S.size2d = h.grid || S.size2d; }
    else { S.rules3d = { turns: h.turns, colors: h.cols }; S.size3d = h.grid || S.size3d; }
    S.stepsPerFrame = h.steps;
    sim2d = new Sim2D(S.size2d);
    sim3d = new Sim3D(S.size3d);
  }
  if (!renderer2d.init($('gl'))) return;
  wireUI();
  wireCanvas2D();
  wireCanvas3D();

  // sync controls from state
  $('speedSlider').value = Math.log10(S.stepsPerFrame).toFixed(2);
  $('speedVal').textContent = fmtInt(S.stepsPerFrame);
  $('chkTurbo').checked = S.turbo;
  $('chkGrid').checked = S.showGrid;
  $('chkFollow').checked = S.follow;
  $('chkTrails').checked = S.showAnt;
  $('chkGlow').checked = S.fx.glow;
  $('chkVig').checked = S.fx.vig;
  $('chkTrail').checked = S.fx.trail;
  $('trailSlider').value = S.trailTime;
  $('trailVal').textContent = (+S.trailTime).toFixed(1) + 's';
  $('opSlider').value = S.voxelOpacity;
  $('voxelScale').value = S.voxelScale;
  $('voxelScaleVal').textContent = (+S.voxelScale).toFixed(2);
  $('opVal').textContent = (+S.voxelOpacity).toFixed(2);
  $('chkBloom').checked = S.bloom;
  $('bloomSlider').value = S.bloomStrength;
  $('bloomVal').textContent = (+S.bloomStrength).toFixed(2);
  $('bloomThrSlider').value = S.bloomThreshold;
  $('bloomThrVal').textContent = (+S.bloomThreshold).toFixed(2);
  $('bloomRadSlider').value = S.bloomRadius;
  $('bloomRadVal').textContent = (+S.bloomRadius).toFixed(2);
  $('flashSlider').value = S.cellFlash;
  $('flashVal').textContent = (+S.cellFlash).toFixed(2);
  $('chkCellGlow').checked = S.cellGlow3d;
  $('glowTimeSlider').value = S.cellGlowTime;
  $('glowTimeVal').textContent = (+S.cellGlowTime).toFixed(1) + 's';
  $('chkAntLight').checked = S.antLight;
  $('antRadiusSlider').value = S.antRadius;
  $('antRadiusVal').textContent = S.antRadius + ' cells';
  $('glowStrSlider').value = S.glowStrength2d;
  $('glowStrVal').textContent = (+S.glowStrength2d).toFixed(2);
  $('glowSpreadSlider').value = S.glowSpread;
  $('glowSpreadVal').textContent = S.glowSpread + (S.glowSpread > 1 ? ' cells' : ' cell');
  $('glowThrSlider').value = S.glowThr2d;
  $('glowThrVal').textContent = (+S.glowThr2d).toFixed(2);
  $('trailFlashSlider').value = S.trailFlash;
  $('trailFlashVal').textContent = (+S.trailFlash).toFixed(2);
  { const c = (S.glowColor || '#FF9E50').toUpperCase();
    $('glowColor2d').value = c; $('glowColor3d').value = c;
    $('glowColor2dHex').textContent = c; $('glowColor3dHex').textContent = c; }
  $('chkBeeLight').checked = S.beeLight;
  $('fogSlider').value = S.fogDensity;
  $('fogVal').textContent = (+S.fogDensity).toFixed(3);
  $('toolSelect').value = S.tool;
  if (document.body.classList.contains('dark'))
    $('btnTheme').querySelector('.material-icons').textContent = 'light_mode';

  sim2d = new Sim2D(S.size2d);
  sim3d = new Sim3D(S.size3d);
  syncGlowTint();
  applyRulesToSim2Both();
  resizeCanvases();
  const startMode = h?.mode ?? (savedMode === '3d' ? '3d' : '2d');
  await setMode(startMode);
  if (S.mode === '2d') { applyRulesToSim(); refreshRulesUI(); fitView2D(); }
  syncAntStats();
  updateStats(true);
  requestAnimationFrame((t) => { lastT = t; requestAnimationFrame(tick); });
  // Material ripple on all tactile controls
  document.addEventListener('pointerdown', (e) => {
    const t = e.target.closest && e.target.closest('.m2-btn,.m2-fab,.m2-mini-fab,.m2-tab,.m2-paint-dot');
    if (!t) return;
    const r = t.getBoundingClientRect();
    if (r.width === 0) return;
    const s = document.createElement('span');
    s.className = 'm2-ripple';
    const d = Math.max(r.width, r.height);
    s.style.width = s.style.height = d + 'px';
    s.style.left = (e.clientX - r.left - d / 2) + 'px';
    s.style.top = (e.clientY - r.top - d / 2) + 'px';
    t.appendChild(s);
    setTimeout(() => s.remove(), 600);
  });

  if (!h) setTimeout(() => snack('Auto-running the classic LR highway — open Rules to remix it'), 600);
  else setTimeout(() => snack('Loaded shared rule: ' + currentRules().turns.join('')), 600);
  setRunning(true);
  // debug hook for automated browser diagnostics (harmless in production)
  window.__ab = { S, sim2: () => sim2d, sim3: () => sim3d, r2: renderer2d, r3: render3d };
}
function applyRulesToSim2Both() {
  sim2d.setRules(S.rules2d.turns, S.rules2d.colors);
  sim3d.setRules(S.rules3d.turns, S.rules3d.colors);
}

boot();
