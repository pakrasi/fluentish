/* Explore › 3D: the shaders (GLSL ES 3.00). Every layer reads the item-state texture (domain/palace.js), so all the
   animation (the rise, colours, letters, the neighbours' bob, the glow) is evaluated here from one time uniform.
   Encodings are the Atlas's (DESIGN.md, Explore): ink is the scale, shape the second channel, height a third that only
   adds to them; colours arrive as uniforms resolved from the app's tokens. */
import { PLINTH, FLOOR, INSET, DEPTH_UP, DEPTH_DN, TEX_W, TYPE_FROM, TYPE_TO, FLOOR_PX } from '../../../domain/palace.js';

const f = (/** @type {number} */ x) => (Number.isInteger(x) ? `${x}.0` : String(x));

/* ---------------------------------------------------------------- shared (vertex) */
export const COMMON = /* glsl */`
uniform sampler2D uItems; uniform float uTime; uniform mat4 uVP; uniform vec3 uEye; uniform float uPx;
uniform float uRise; uniform float uExag; uniform vec4 uPulse[8]; uniform vec4 uLens;
const float PLINTH = ${f(PLINTH)}; const float FLOOR = ${f(FLOOR)};
vec4 itemT(int i, int j) { int k = i * 4 + j; return texelFetch(uItems, ivec2(k % ${TEX_W}, k / ${TEX_W}), 0); }
float spr(float t, float k, float c) {
  if (t <= 0.0) return 0.0;
  float w0 = sqrt(k), z = c / (2.0 * w0), wd = w0 * sqrt(max(1.0 - z * z, 1e-4));
  return 1.0 - exp(-z * w0 * t) * (cos(wd * t) + (z * w0 / wd) * sin(wd * t));
}
float backOut(float x) { x = clamp(x, 0.0, 1.0); return 1.0 + 2.2 * pow(x - 1.0, 3.0) + 1.2 * pow(x - 1.0, 2.0); }
float riseOf(vec4 C) { return uRise >= 0.999 ? 1.0 : backOut(clamp(uRise * 1.8 - C.x, 0.0, 1.0)); }
float floorsNow(vec4 B) { return mix(B.x, B.y, spr(uTime - B.z, 380.0, 18.0)); }
float pulseAt(vec2 xz) {                      // neighbours within 260 units bob once when a word nearby is learned
  float h = 0.0;
  for (int k = 0; k < 8; k++) {
    vec4 p = uPulse[k]; float r = distance(xz, p.xy), t = uTime - p.z - r / 260.0;
    if (t > 0.0 && t < 1.2 && r < 260.0 && r > 1.0) h += 3.2 * sin(t * 14.0) * exp(-t * 4.5) * (1.0 - r / 260.0);
  }
  return h;
}
float lensAt(vec2 c) {                        // the street opens: buildings between the eye and the word in focus sink
  if (uLens.z < 0.001) return 1.0;
  vec2 cam = uEye.xz, dir = normalize(uLens.xy - cam + vec2(1e-4));
  float along = dot(c - cam, dir), tgt = dot(uLens.xy - cam, dir), lat = abs(dot(c - cam, vec2(-dir.y, dir.x)));
  float inC = (1.0 - smoothstep(60.0, 110.0, lat)) * step(along, tgt - 8.0) * (1.0 - smoothstep(220.0, 340.0, tgt - along));
  return mix(1.0, 0.12, inC * uLens.z);
}
float heightOf(int item) {
  vec4 B = itemT(item, 1), C = itemT(item, 2);
  return lensAt(C.zw) * max(floorsNow(B) * FLOOR + pulseAt(C.zw) * step(0.5, B.y), 0.0) * riseOf(C) * uExag;
}
float stateNow(vec4 A) { float t = clamp((uTime - A.z) / 0.5, 0.0, 1.0); return t < 1.0 ? mix(A.x, A.y, t) : A.y; }
`;

/* fog, focus (district entry) and selection, shared by the fragment shaders */
const FRAG = /* glsl */`
uniform vec2 uFog; uniform vec3 uCanvas; uniform float uFocus; uniform float uFocusK; uniform float uTime;
vec3 fogged(vec3 c, float dist) { return mix(c, uCanvas, smoothstep(uFog.x, uFog.y, dist) * 0.92); }
// district entry: the other districts fade toward the canvas, to 38 %
float focusDim(float g) { return uFocus < 0.0 || abs(g - uFocus) < 0.5 ? 0.0 : 0.62 * uFocusK; }
`;

/* ---------------------------------------------------------------- plinths: the Atlas discs; the ring is their rim */
export const PLINTH_VS = /* glsl */`
uniform mat4 uVP; uniform vec3 uEye;
in vec3 aPos; in vec3 aNor; in vec4 aG; in vec4 aF;
out vec3 vP; out vec3 vN; out vec4 vF; out float vR; out float vDist; out float vG;
void main() {
  vec3 p = vec3(aPos.x * aG.z + aG.x, aPos.y * ${f(PLINTH)}, aPos.z * aG.z + aG.y);
  vP = vec3(aPos.x * aG.z, p.y, aPos.z * aG.z); vN = aNor; vF = aF; vR = aG.z; vG = aG.w;
  vDist = distance(p, uEye); gl_Position = uVP * vec4(p, 1.0);
}`;
export const PLINTH_FS = /* glsl */`
uniform vec3 uTop; uniform vec3 uSide; uniform vec3 uInk; uniform vec3 uInk3; uniform vec3 uBox; uniform vec3 uAcc; uniform vec3 uL; uniform float uSelG;
${FRAG}
in vec3 vP; in vec3 vN; in vec4 vF; in float vR; in float vDist; in float vG;
out vec4 o;
vec4 arc(float a, float pa) {                 // the ring's four states from 12 o'clock, a gap between them
  vec3 c = a < vF.x ? uInk : a < vF.y ? uInk3 : uBox;
  float al = 1.0;
  if (a >= vF.z) { al = step(0.5, fract(a * vR * 1.2)) * 0.9; }      // not seen: dotted
  float gap = min(min(abs(a - vF.x), abs(a - vF.y)), min(abs(a - vF.z), min(a, 1.0 - a)));
  if (gap / max(pa, 1e-5) < 1.25) al = 0.0;
  return vec4(c, al);
}
void main() {
  float a = fract(atan(vP.x, -vP.z) / 6.2831853 + 1.0), pa = fwidth(a);
  vec3 col;
  bool sel = abs(vG - uSelG) < 0.5;
  if (vN.y > 0.5) {
    float rho = length(vP.xz), px = fwidth(rho);
    col = uTop;
    float band = 1.0 - smoothstep(2.6 * px, 3.4 * px, vR - rho);      // the ring, about 3 px wide at any zoom
    vec4 c = arc(a, pa); col = mix(col, c.rgb, band * c.a);
    float edge = 1.0 - smoothstep(0.0, px * 1.2, vR - rho); col = mix(col, uInk, edge * 0.15);
    if (sel) { float s = 1.0 - smoothstep(px * 0.75, px * 1.5, abs(vR - rho - 5.0 * px)); col = mix(col, uAcc, s); }
  } else {
    float ndl = clamp(dot(normalize(vN), uL) * 0.5 + 0.5, 0.0, 1.0);
    vec4 c = arc(a, pa);
    col = mix(uSide * (0.82 + 0.18 * ndl), c.rgb, c.a * 0.9 * step(1.2, vP.y) * step(vP.y, ${f(PLINTH)} - 1.2));
  }
  col = mix(col, uCanvas, focusDim(vG));
  o = vec4(fogged(col, vDist), 1.0);
}`;

/* ---------------------------------------------------------------- word blocks */
export const BLOCK_VS = /* glsl */`
${COMMON}
in vec3 aPos; in vec3 aNor; in float aI;
out vec3 vL; out vec3 vN; out vec3 vS; out vec4 vA; out vec4 vB; out float vDist; out float vPx; out float vG; out float vItem; out float vSt;
void main() {
  int item = int(aI + 0.5);
  vec4 D = itemT(item, 3);
  if (D.w < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec4 A = itemT(item, 0), B = itemT(item, 1), C = itemT(item, 2);
  vec4 fb = vec4(D.x - ${f(INSET)}, D.y - ${f(DEPTH_UP)}, D.z + ${f(INSET * 2)}, ${f(DEPTH_UP + DEPTH_DN)});
  float hh = max(heightOf(item), 0.05);
  vec3 p = vec3(fb.x + aPos.x * fb.z, PLINTH + 0.06 + aPos.y * hh, fb.y + aPos.z * fb.w);
  vL = aPos * vec3(fb.z, hh, fb.w); vN = aNor; vS = vec3(fb.z, hh, fb.w); vA = A; vB = B; vG = C.y; vItem = aI;
  vSt = stateNow(A);
  vDist = distance(p, uEye); vPx = uPx / max(vDist, 1.0);
  gl_Position = uVP * vec4(p, 1.0);
}`;
export const BLOCK_FS = /* glsl */`
uniform vec3 uRoof; uniform vec3 uPl; uniform vec3 uLit; uniform vec3 uDark; uniform vec3 uInk; uniform vec3 uInk3; uniform vec3 uBox; uniform float uBoxA;
uniform vec3 uNew; uniform float uNewA; uniform vec3 uAcc; uniform vec3 uGlow; uniform vec3 uL; uniform float uSel; uniform float uRise; uniform float uNight;
${FRAG}
in vec3 vL; in vec3 vN; in vec3 vS; in vec4 vA; in vec4 vB; in float vDist; in float vPx; in float vG; in float vItem; in float vSt;
out vec4 o;
float edgeDist(vec3 n) {                     // distance (world units) to the border of this face
  vec2 q = abs(n.y) > 0.5 ? vL.xz : (abs(n.x) > 0.5 ? vL.zy : vL.xy);
  vec2 s = abs(n.y) > 0.5 ? vS.xz : (abs(n.x) > 0.5 ? vS.zy : vS.xy);
  return min(min(q.x, s.x - q.x), min(q.y, s.y - q.y));
}
void main() {
  vec3 n = normalize(vN);
  float st = vSt;
  bool sel = abs(vItem - uSel) < 0.5;
  bool today = vA.w > 0.5;
  float px1 = 1.0 / max(vPx, 1e-4);           // one pixel in world units
  float e = edgeDist(n);
  float typePx = 16.0 * vPx;
  float barA = 1.0 - smoothstep(${f(TYPE_FROM)}, ${f(TYPE_TO)}, typePx);   // far zoom: the word as a bar of its exact width
  float bar3d = 1.0 - uRise * (uNight > 0.5 ? 0.96 : 0.9);   // in 3D the height carries the state; bars stay in the plan
  float scaff = 1.0 - smoothstep(0.6, 1.4, st);
  float flat_ = 1.0 - smoothstep(0.0, 0.6, st);
  // scaffolds stay quiet far away (at night light edges on graphite read as noise, so quieter still)
  float scK = mix(uNight > 0.5 ? 0.08 : 0.3, 1.0, smoothstep(4.0, 12.0, typePx));
  float learnT = uTime - vB.w;
  bool learning = vB.w > -50.0 && learnT < 2.0;
  vec3 col;
  if (n.y > 0.5) {
    col = flat_ > 0.5 || scaff > 0.5 ? uPl : uRoof;
    if (uNight > 0.5 && st > 2.5) col = mix(col, uInk, 0.075);        // night: known roofs glow faintly
    vec2 b0 = vec2(${f(INSET)}, 7.0), b1 = vec2(vS.x - ${f(INSET)}, 14.5);
    vec2 q = max(b0 - vL.xz, vL.xz - b1); float bd = max(q.x, q.y);
    float inBar = 1.0 - smoothstep(-px1 * 0.5, px1 * 0.5, bd);
    vec3 bc = st < 0.5 ? uNew : st < 1.5 ? uBox : st < 2.5 ? uInk3 : uInk;
    float ba = st < 0.5 ? uNewA * 1.6 : st < 1.5 ? 0.0 : 1.0;
    float outline = st < 1.5 && st > 0.5 ? (1.0 - smoothstep(px1 * 0.4, px1 * 1.4, abs(bd + px1 * 0.5))) * uBoxA : 0.0;
    float keep = (today || sel) ? 1.0 : bar3d;
    if (today || sel) { bc = uAcc; ba = 1.0; outline = 0.0; }
    col = mix(col, bc, keep * barA * (inBar * ba + outline));
    float ew = (sel ? 2.2 : 1.1) * px1;
    float edge = 1.0 - smoothstep(ew * 0.5, ew, e);
    col = mix(col, uInk, edge * 0.16 * (1.0 - flat_) * (1.0 - scaff));
    if (sel) col = mix(col, uAcc, edge);
    if (today || sel) {                       // a hairline under the type, as in the Atlas; thicker when selected
      float uw = sel ? 1.4 : 0.7;
      float ul = 1.0 - smoothstep(px1 * uw * 0.6, px1 * uw, abs(vL.z - ${f(DEPTH_UP)} - 3.5));
      col = mix(col, uAcc, ul * step(${f(INSET)}, vL.x) * step(vL.x, vS.x - ${f(INSET)}) * (1.0 - barA));
    }
    float g = clamp(learnT / 1.3, 0.0, 1.0);
    if (vB.w > -50.0 && g < 1.0) col = mix(col, uGlow, (1.0 - g) * (1.0 - g) * 0.9);
    if (flat_ > 0.5 && barA * bar3d < 0.01 && !sel) discard;          // not seen: only the printed type, close up
    if (scaff > 0.5) {
      float s = 1.0 - smoothstep(px1 * 0.6, px1 * 1.3, e);
      if (barA < 0.01 && s < 0.01 && !sel) discard;
      col = mix(col, learning ? uAcc : uBox, s * min(1.0, uBoxA * 1.5) * scK);
    }
  } else if (n.y < -0.5) { discard; } else {
    if (flat_ > 0.5 || vS.y < 0.3) discard;
    float ndl = clamp(dot(n, uL), 0.0, 1.0);
    col = mix(uDark, uLit, ndl);
    col *= mix(0.84, 1.0, smoothstep(0.0, 10.0, vL.y));
    float fl = abs(fract(vL.y / ${f(FLOOR)} + 0.5) - 0.5) * ${f(FLOOR)};
    float showF = smoothstep(${f(FLOOR_PX)} * 0.7, ${f(FLOOR_PX)}, ${f(FLOOR)} * vPx);   // floor lines once a floor is 3 px
    col = mix(col, uInk, (1.0 - smoothstep(px1 * 0.4, px1 * 1.1, fl)) * step(1.0, vL.y) * step(vL.y, vS.y - 1.0) * 0.09 * showF);
    if (today) col = mix(col, uAcc, step(vS.y - 1.6, vL.y) * 0.9);
    if (sel) col = mix(col, uAcc, (1.0 - smoothstep(px1, px1 * 2.0, e)) * 0.9);
    float g = clamp(learnT / 1.3, 0.0, 1.0);
    if (vB.w > -50.0 && g < 1.0) {
      col = mix(col, uGlow, (1.0 - g) * (1.0 - g) * 0.7);
      col = mix(col, uAcc, (1.0 - smoothstep(0.0, 2.2, vS.y - vL.y)) * (1.0 - smoothstep(0.25, 0.9, learnT)));   // a cobalt line rides up
    }
    if (scaff > 0.5) {                        // the scaffold: edges only
      float s = 1.0 - smoothstep(px1 * 0.6, px1 * 1.3, e);
      if (s < 0.01) discard;
      col = mix(uPl, learning ? uAcc : uBox, s * (learning ? 1.0 : min(1.0, uBoxA * 1.5) * scK));
    }
  }
  col = mix(col, uCanvas, focusDim(vG));
  o = vec4(fogged(col, vDist), 1.0);
}`;

/* ---------------------------------------------------------------- soft contact shadows on the plinths */
export const SHADOW_VS = /* glsl */`
${COMMON}
uniform vec3 uL;
in vec3 aPos; in float aI;
out vec2 vQ; out vec2 vHalf; out float vBlur; out float vH; out float vG;
void main() {
  int item = int(aI + 0.5);
  vec4 D = itemT(item, 3), C = itemT(item, 2);
  float h = D.w < 0.5 ? 0.0 : heightOf(item); vH = h; vG = C.y;
  if (h < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 size = vec2(D.z + ${f(INSET * 2)}, ${f(DEPTH_UP + DEPTH_DN)});
  vec2 off = -uL.xz / uL.y * h * 0.42;
  float blur = 2.0 + h * 0.4; vBlur = blur;
  vec2 half_ = size * 0.5 + vec2(h * 0.08); vHalf = half_;
  vec2 c = C.zw + off;
  vec2 ext = half_ + vec2(blur * 1.5) + abs(off);
  vec2 xz = c + (aPos.xz * 2.0 - 1.0) * ext;
  vQ = xz - c;
  gl_Position = uVP * vec4(xz.x, PLINTH + 0.03, xz.y, 1.0);
}`;
export const SHADOW_FS = /* glsl */`
uniform vec3 uShadow; uniform float uStr; uniform float uRise; uniform float uExag; uniform float uFocus; uniform float uFocusK;
in vec2 vQ; in vec2 vHalf; in float vBlur; in float vH; in float vG;
out vec4 o;
void main() {
  vec2 q = abs(vQ) - vHalf; float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float a = (1.0 - smoothstep(-vBlur, vBlur, d)) * uStr * clamp(vH / 18.0, 0.0, 1.0) * uRise / max(1.0, uExag * 0.6);
  if (uFocus >= 0.0 && abs(vG - uFocus) > 0.5) a *= 1.0 - 0.6 * uFocusK;
  if (a < 0.003) discard;
  o = vec4(uShadow * a, a);
}`;

/* ---------------------------------------------------------------- type: one instanced quad per glyph */
export const TEXT_VS = /* glsl */`
${COMMON}
uniform sampler2D uGlyphs; uniform float uSel; uniform vec3 uInk[6]; uniform float uFocus; uniform float uFocusK; uniform float uArt;
in vec2 aPos; in vec4 aU; in vec2 aS;
out vec2 vUV; out vec3 vCol; out float vAlpha; out float vPx;
float h1(float n) { return fract(sin(n * 91.345 + 7.13) * 43758.5453); }
void main() {
  int item = int(aU.x + 0.5);
  vec4 D = itemT(item, 3);
  if (D.w < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec4 A = itemT(item, 0), B = itemT(item, 1), C = itemT(item, 2);
  float st = stateNow(A);
  bool ital = st < 0.5;
  bool art = aU.w >= 32767.5;
  float ci = art ? aU.w - 32768.0 : aU.w;
  int g = int((ital ? aU.z : aU.y) + 0.5);
  vec4 q = texelFetch(uGlyphs, ivec2((g * 2) % 256, (g * 2) / 256), 0);
  vec4 uv = texelFetch(uGlyphs, ivec2((g * 2 + 1) % 256, (g * 2 + 1) / 256), 0);
  float size = 16.0 * (art ? uArt : 1.0);
  float x = D.x + (ital ? aS.y : aS.x) / 10.0;
  vec2 xz = vec2(x + mix(q.x, q.z, aPos.x) * size, D.y - mix(q.y, q.w, aPos.y) * size);
  vUV = vec2(mix(uv.x, uv.z, aPos.x), mix(uv.w, uv.y, aPos.y));
  float tS = clamp((uTime - A.z) / 0.5, 0.0, 1.0);
  int s0 = int(A.x + 0.5), s1 = int(A.y + 0.5);
  vCol = mix(uInk[s0], uInk[s1], tS);
  if (art) vCol = ital ? uInk[0] : uInk[2];
  if (A.w > 0.5 || abs(aU.x - uSel) < 0.5) vCol = uInk[4];
  vec3 p = vec3(xz.x, PLINTH + 0.21 + heightOf(item), xz.y);
  float lt = uTime - B.w;
  if (B.w > -50.0 && lt < 2.0) {               // learned: the letters lift off the old roof and settle on the new one
    float u = lt - 0.05 - ci * 0.04;
    float k = smoothstep(0.0, 0.22, u) * (1.0 - clamp(spr(u - 0.26, 170.0, 20.0), 0.0, 1.2));
    p += vec3((h1(aU.x + ci) - 0.5) * 50.0, 30.0 + h1(aU.x * 1.7 + ci) * 50.0, (h1(aU.x * 2.3 + ci) - 0.5) * 36.0) * k;
    vCol = uInk[4];
  }
  float dist = distance(p, uEye);
  float px = size * uPx / max(dist, 1.0);
  vPx = px;
  float fade = uFocus < 0.0 || abs(C.y - uFocus) < 0.5 ? 1.0 : 1.0 - 0.75 * uFocusK;
  vAlpha = smoothstep(${f(TYPE_FROM)}, ${f(TYPE_TO)}, 16.0 * uPx / max(dist, 1.0)) * fade;
  if (vAlpha < 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  gl_Position = uVP * vec4(p, 1.0);
}`;
export const TEXT_FS = /* glsl */`
uniform sampler2D uSdf;
in vec2 vUV; in vec3 vCol; in float vAlpha; in float vPx;
out vec4 o;
void main() {
  float d = texture(uSdf, vUV).r;
  float w = max(fwidth(d) * 0.75, 1e-3);
  float edge = 0.75 - 0.05 * clamp((14.0 - vPx) / 8.0, 0.0, 1.0);   // a touch bolder when small
  float a = smoothstep(edge - w, edge + w, d) * vAlpha;
  if (a < 0.01) discard;
  o = vec4(vCol * a, a);
}`;

/* ---------------------------------------------------------------- the learned moment's sparkle: ~70 motes */
export const MOTE_VS = /* glsl */`
uniform mat4 uVP; uniform float uTime; uniform float uPx; uniform vec3 uEye; uniform float uDpr;
in vec4 aP; in vec4 aV;
out float vA; out float vK;
void main() {
  float t = uTime - aP.w, life = aV.w;
  if (t < 0.0 || t > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float k = 2.6, e = (1.0 - exp(-k * t)) / k;
  vec3 p = aP.xyz + aV.xyz * e + vec3(0.0, -60.0 * t * t, 0.0);
  p.y = max(p.y, aP.y - 2.0);
  float u = t / life; vA = (1.0 - u) * (1.0 - u) * smoothstep(0.0, 0.06, t); vK = fract(aP.w * 7.31 + aV.x);
  gl_PointSize = clamp(2.6 * uPx / max(distance(p, uEye), 1.0), 2.0, 5.0) * uDpr;
  gl_Position = uVP * vec4(p, 1.0);
}`;
export const MOTE_FS = /* glsl */`
uniform vec3 uAcc; uniform vec3 uInkC;
in float vA; in float vK;
out vec4 o;
void main() { vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard;
  float a = vA * smoothstep(0.5, 0.2, d); o = vec4((vK > 0.35 ? uAcc : uInkC) * a, a); }`;

/* ---------------------------------------------------------------- rings across the plinth */
export const RING_VS = /* glsl */`
uniform mat4 uVP; uniform float uTime;
in vec3 aPos; in vec4 aP; in vec4 aR;
out vec2 vL; out float vT; out float vR;
void main() { float t = (uTime - aP.w) / aR.y; vT = t; vR = aR.x;
  if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vL = aPos.xz * aR.x; gl_Position = uVP * vec4(aP.xyz + vec3(vL.x, 0.0, vL.y), 1.0); }`;
export const RING_FS = /* glsl */`
uniform vec3 uAcc;
in vec2 vL; in float vT; in float vR;
out vec4 o;
void main() { float e = 1.0 - pow(1.0 - vT, 3.0); float r = e * vR, d = abs(length(vL) - r);
  float w = 1.5 + 5.0 * (1.0 - vT), px = fwidth(length(vL));
  float a = (1.0 - smoothstep(w - px, w + px, d)) * pow(1.0 - vT, 1.6) * 0.85;
  if (a < 0.01) discard; o = vec4(uAcc * a, a); }`;

/* ---------------------------------------------------------------- study tiles: the mark's open tile over each word to study */
export const TILE_VS = /* glsl */`
uniform mat4 uVP; uniform float uTime; uniform vec2 uRes;
in vec3 aPos; in vec4 aP; in vec4 aT;
out vec2 vL; out float vA;
float spr(float t, float k, float c) { if (t <= 0.0) return 0.0; float w0 = sqrt(k), z = c / (2.0 * w0), wd = w0 * sqrt(max(1.0 - z * z, 1e-4));
  return 1.0 - exp(-z * w0 * t) * (cos(wd * t) + (z * w0 / wd) * sin(wd * t)); }
void main() {
  float t = uTime - aP.w; float out_ = aT.y > 0.0 ? clamp((uTime - aT.y) / 0.18, 0.0, 1.0) : 0.0;
  float s = spr(t, 380.0, 18.0); vA = clamp(t / 0.12, 0.0, 1.0) * (1.0 - out_);
  if (aP.w < -50.0 || vA <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 p = aP.xyz + vec3(0.0, 26.0 + 30.0 * (1.0 - s), 0.0);
  vec4 c = uVP * vec4(p, 1.0);
  vL = aPos.xy; c.xy += aPos.xy * 9.0 * (0.6 + 0.4 * s) * 2.0 / uRes * c.w; gl_Position = c;
}`;
export const TILE_FS = /* glsl */`
uniform vec3 uAcc; uniform vec3 uSurf;
in vec2 vL; in float vA;
out vec4 o;
void main() { vec2 q = abs(vL) - vec2(0.72); float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.2;
  float px = fwidth(d); float ring = 1.0 - smoothstep(0.0, px * 1.5, abs(d) - 0.09);
  float fill = 1.0 - smoothstep(-px, px, d);
  vec3 col = mix(uSurf, uAcc, ring); float a = max(ring, fill * 0.9) * vA; if (a < 0.01) discard; o = vec4(col * a, a); }`;
