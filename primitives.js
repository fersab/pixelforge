// @ts-check

const WIDTH = 800;
const HEIGHT = 420;

// ── Shared vector utilities ────────────────────────────────────
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(v) {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len === 0) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

// ── Shared camera & lighting globals ───────────────────────────
const camZ = -500;
const fov = 500;
const lightDir = normalize([-0.5, -0.5, -1]);
const ambient = 0.4;

let rotX = 0;
let rotY = 0;
let rotZ = 0;

/** @type {HTMLCanvasElement} */
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');

// double buffering
const frontData = ctx.createImageData(WIDTH, HEIGHT);
const backBuf = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
const zBuf = new Float32Array(WIDTH * HEIGHT);

/**
 * @param {number} x
 * @param {number} y
 * @param {number} z - depth (smaller = closer)
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} a
 */
function putpixel(x, y, z, r, g, b, a) {
  x = x | 0;
  y = y | 0;
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  const zi = y * WIDTH + x;
  if (z >= zBuf[zi]) return;
  const i = zi << 2;

  if (a >= 255) {
    zBuf[zi] = z;
    backBuf[i]     = r & 0xff;
    backBuf[i + 1] = g & 0xff;
    backBuf[i + 2] = b & 0xff;
    backBuf[i + 3] = 255;
  } else {
    // semi-transparent: blend over existing, don't claim depth
    const sa = (a & 0xff) / 255;
    const da = 1 - sa;
    backBuf[i]     = (r * sa + backBuf[i]     * da) & 0xff;
    backBuf[i + 1] = (g * sa + backBuf[i + 1] * da) & 0xff;
    backBuf[i + 2] = (b * sa + backBuf[i + 2] * da) & 0xff;
    backBuf[i + 3] = Math.min(255, backBuf[i + 3] + a) & 0xff;
  }
}

/** Fill a horizontal span with per-pixel Phong lighting. */
function fillSpan(y, xL, zL, nxL, nyL, nzL, xR, zR, nxR, nyR, nzR, r, g, b, a) {
  const xStart = Math.ceil(xL);
  const xEnd = Math.floor(xR);
  const span = xR - xL;
  const halfW = WIDTH / 2;
  const halfH = HEIGHT / 2;
  for (let x = xStart; x <= xEnd; x++) {
    const t = span > 0 ? (x - xL) / span : 0;
    const z = zL + t * (zR - zL);

    // interpolate and re-normalize the normal
    let nx = nxL + t * (nxR - nxL);
    let ny = nyL + t * (nyR - nyL);
    let nz = nzL + t * (nzR - nzL);
    const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nlen > 0) { nx /= nlen; ny /= nlen; nz /= nlen; }

    // diffuse
    const diff = Math.max(0, nx * lightDir[0] + ny * lightDir[1] + nz * lightDir[2]);
    const brightness = ambient + diff;

    // Blinn-Phong specular: half-vector between light and view
    const vlen = Math.sqrt((x - halfW) * (x - halfW) + (y - halfH) * (y - halfH) + fov * fov);
    const hx = lightDir[0] + (halfW - x) / vlen;
    const hy = lightDir[1] + (halfH - y) / vlen;
    const hz = lightDir[2] + (-fov) / vlen;
    const hlen = Math.sqrt(hx * hx + hy * hy + hz * hz);
    const ndoth = hlen > 0 ? Math.max(0, (nx * hx + ny * hy + nz * hz) / hlen) : 0;
    const spec = Math.pow(ndoth, RT_SPECULAR_EXP) * RT_SPECULAR_STR;

    putpixel(x, y, z,
      Math.min(255, r * brightness + spec * 255),
      Math.min(255, g * brightness + spec * 255),
      Math.min(255, b * brightness + spec * 255), a);
  }
}

/** Get the min and max Y of a polygon, clamped to screen bounds. */
function polyYBounds(pts) {
  let ymin = HEIGHT, ymax = 0;
  for (let i = 0; i < pts.length; i++) {
    const y = pts[i][1] | 0;
    if (y < ymin) ymin = y;
    if (y > ymax) ymax = y;
  }
  return [Math.max(0, ymin), Math.min(HEIGHT - 1, ymax)];
}

/**
 * Find where a scanline at y crosses the polygon edges.
 * Returns sorted array of [x, z, nx, ny, nz] intersection points.
 */
function scanlineHits(pts, y) {
  const hits = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const y0 = pts[i][1], y1 = pts[j][1];

    if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
      const t = (y - y0) / (y1 - y0);
      hits.push([
        pts[i][0] + t * (pts[j][0] - pts[i][0]),  // interpolated x
        pts[i][2] + t * (pts[j][2] - pts[i][2]),   // interpolated z
        pts[i][3] + t * (pts[j][3] - pts[i][3]),   // interpolated nx
        pts[i][4] + t * (pts[j][4] - pts[i][4]),   // interpolated ny
        pts[i][5] + t * (pts[j][5] - pts[i][5]),   // interpolated nz
      ]);
    }
  }
  hits.sort((a, b) => a[0] - b[0]);
  return hits;
}

/**
 * Scanline-fill a 2D polygon. Points are [x, y, z, nx, ny, nz].
 * Walks each scanline top to bottom, finds edge crossings,
 * and fills horizontal spans with per-pixel Phong lighting.
 */
function fillpoly(pts, r, g, b, a) {
  if (pts.length < 3) return;

  const [ymin, ymax] = polyYBounds(pts);

  for (let y = ymin; y <= ymax; y++) {
    const hits = scanlineHits(pts, y);
    for (let i = 0; i < hits.length - 1; i += 2) {
      fillSpan(y,
        hits[i][0], hits[i][1], hits[i][2], hits[i][3], hits[i][4],
        hits[i+1][0], hits[i+1][1], hits[i+1][2], hits[i+1][3], hits[i+1][4],
        r, g, b, a);
    }
  }
}

function clear() {
  backBuf.fill(0);
  zBuf.fill(Infinity);
}

function flip() {
  frontData.data.set(backBuf);
  ctx.putImageData(frontData, 0, 0);
}
