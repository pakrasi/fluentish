/* Explore › 3D: the camera. Pure maths (no DOM, no WebGL), tested in node (tests/unit/palace.test.mjs).

   The rig orbits a target on the ground: s = {x, z, ty, d, yaw, pitch}. pitch 90° looks straight down with north (−z,
   the Atlas's up) at the top of the screen, which is the 2D map; the 3D view tilts to about 42° and turns −24°.
   Matrices are column-major Float32Array(16), as WebGL takes them. */

export const PLAN_PITCH = Math.PI / 2 - 1e-4;

/** Vertical field of view: 40° on a portrait stage, 30° on a landscape one. @param {number} w @param {number} h */
export const fovOf = (w, h) => ((w < h ? 40 : 30) * Math.PI) / 180;

/**
 * The camera's position and basis for a rig state.
 * @param {{x: number, z: number, ty: number, d: number, yaw: number, pitch: number}} s
 */
export function pose(s) {
  const cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
  const off = [Math.sin(s.yaw) * cp * s.d, sp * s.d, Math.cos(s.yaw) * cp * s.d];
  const eye = [s.x + off[0], s.ty + off[1], s.z + off[2]];
  const back = [off[0] / s.d, off[1] / s.d, off[2] / s.d];          // camera +z (points away from the target)
  const right = [Math.cos(s.yaw), 0, -Math.sin(s.yaw)];
  const up = cross(back, right);
  return { eye, right, up, back };
}

/** @param {number[]} a @param {number[]} b */
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * View, projection and their product for a rig state on a w × h stage.
 * @param {{x: number, z: number, ty: number, d: number, yaw: number, pitch: number}} s @param {number} w @param {number} h
 */
export function matrices(s, w, h) {
  const { eye, right, up, back } = pose(s);
  const view = new Float32Array([
    right[0], up[0], back[0], 0,
    right[1], up[1], back[1], 0,
    right[2], up[2], back[2], 0,
    -(right[0] * eye[0] + right[1] * eye[1] + right[2] * eye[2]), -(up[0] * eye[0] + up[1] * eye[1] + up[2] * eye[2]), -(back[0] * eye[0] + back[1] * eye[1] + back[2] * eye[2]), 1,
  ]);
  const fov = fovOf(w, h), aspect = w / Math.max(1, h);
  const near = Math.max(2, s.d * 0.02), far = s.d * 12 + 8000;
  const f = 1 / Math.tan(fov / 2);
  const proj = new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
  const vp = mul(proj, view);
  // pixels per world unit at distance 1 (the on-screen size of anything is L × ppu / distance)
  const ppu = h / 2 / Math.tan(fov / 2);
  return { view, proj, vp, eye, ppu, fov, near, far };
}

/** a × b, column-major. @param {Float32Array} a @param {Float32Array} b */
export function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let v = 0; for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = v;
  }
  return o;
}

/**
 * A world point on screen: CSS pixels from the stage's top left, and its clip w (≤ 0: behind the camera).
 * @param {Float32Array} vp @param {number} x @param {number} y @param {number} z @param {number} w @param {number} h
 */
export function project(vp, x, y, z, w, h) {
  const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12], cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13], cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
  if (cw <= 1e-6) return { x: NaN, y: NaN, w: cw };
  return { x: ((cx / cw + 1) / 2) * w, y: ((1 - cy / cw) / 2) * h, w: cw };
}

/**
 * The point on the horizontal plane at height y0 under a screen point (CSS px), or null when the ray misses it.
 * @param {{x: number, z: number, ty: number, d: number, yaw: number, pitch: number}} s @param {number} sx @param {number} sy @param {number} w @param {number} h @param {number} [y0]
 */
export function ground(s, sx, sy, w, h, y0 = 0) {
  const { eye, right, up, back } = pose(s);
  const t = Math.tan(fovOf(w, h) / 2), aspect = w / Math.max(1, h);
  const nx = (sx / w) * 2 - 1, ny = 1 - (sy / h) * 2;
  const dir = [0, 1, 2].map(k => right[k] * nx * t * aspect + up[k] * ny * t - back[k]);
  if (Math.abs(dir[1]) < 1e-9) return null;
  const k = (y0 - eye[1]) / dir[1];
  if (k <= 0) return null;
  return { x: eye[0] + dir[0] * k, z: eye[2] + dir[2] * k };
}

/**
 * Frame a set of world points: the target and distance that put all of them inside the stage's free rectangle (CSS
 * px: left, top, right, bottom insets), centred in it, at the given pitch and yaw. Iterates on the projected box, so
 * perspective and tall buildings are accounted for (the prototype's overview cut the map's right edge on a phone).
 * @param {number[][]} pts [x, y, z] points
 * @param {{yaw: number, pitch: number, ty?: number}} o
 * @param {number} w @param {number} h
 * @param {{left?: number, top?: number, right?: number, bottom?: number}} [ins]
 * @param {{dMin?: number, dMax?: number, fill?: number}} [lim] fill: share of the free rectangle to use (0.94)
 */
export function frame(pts, o, w, h, ins = {}, lim = {}) {
  const L = ins.left || 0, T = ins.top || 0, R = ins.right || 0, B = ins.bottom || 0;
  const fw = Math.max(40, w - L - R), fh = Math.max(40, h - T - B), fill = lim.fill || 0.94;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
  const s = { x: (x0 + x1) / 2, z: (z0 + z1) / 2, ty: o.ty || 0, d: 0, yaw: o.yaw, pitch: o.pitch };
  const fov = fovOf(w, h);
  s.d = Math.max(lim.dMin || 1, (Math.max(x1 - x0, z1 - z0, 1) / 2) / Math.tan(fov / 2) * 1.2);
  for (let it = 0; it < 8; it++) {
    const { vp } = matrices(s, w, h);
    let a = Infinity, b = -Infinity, c = Infinity, e = -Infinity, behind = false;
    for (const p of pts) {
      const q = project(vp, p[0], p[1], p[2], w, h);
      if (!(q.w > 0)) { behind = true; continue; }
      a = Math.min(a, q.x); b = Math.max(b, q.x); c = Math.min(c, q.y); e = Math.max(e, q.y);
    }
    if (behind || !Number.isFinite(a)) { s.d *= 1.6; continue; }
    // shift so the box's middle sits at the free rectangle's middle (move the target along the ground)
    const mx = (a + b) / 2, my = (c + e) / 2, fx = L + fw / 2, fy = T + fh / 2;
    const g0 = ground(s, mx, my, w, h, s.ty), g1 = ground(s, fx, fy, w, h, s.ty);
    if (g0 && g1) { s.x += g0.x - g1.x; s.z += g0.z - g1.z; }
    const k = Math.max((b - a) / (fw * fill), (e - c) / (fh * fill));
    s.d = Math.min(lim.dMax || Infinity, Math.max(lim.dMin || 1, s.d * (it < 6 ? k : Math.max(1, k))));
    if (Math.abs(k - 1) < 0.01 && Math.abs(mx - fx) < 1 && Math.abs(my - fy) < 1) break;
  }
  return s;
}
