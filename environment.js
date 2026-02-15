// @ts-check

// ── Environment ─────────────────────────────────────────────────
// Bundles everything that isn't a scene object: ground, sky, etc.
// Exposes a generic interface so raytracing code never knows the
// specifics — it just calls envIntersect / envAnyHit / envColor.

const ENV_OBJ_IDX = -2; // sentinel for environment hits

const environment = {
  // Internal data — populated by floor.js constants and render-common.js
  _floor: {
    y: FLOOR_Y,
    tile: FLOOR_TILE,
    color0: [180, 30, 30],
    color1: [200, 200, 200],
    minX: -FLOOR_HALF * FLOOR_TILE,
    maxX: FLOOR_HALF * FLOOR_TILE,
    minZ: -FLOOR_HALF * FLOOR_TILE + FLOOR_Z_OFFSET,
    maxZ: FLOOR_HALF * FLOOR_TILE + FLOOR_Z_OFFSET,
    offX: 0,
    offZ: FLOOR_Z_OFFSET,
  },
  _sky: {
    imageData: null,
    width: 0,
    height: 0,
  },
};

// ── Generic environment interface (CPU raytracer) ───────────────
// The raytracer calls these without knowing what's in the environment.

/**
 * Test a ray against the environment.
 * Returns { t, color, nx, ny, nz, reflectivity } or null.
 */
function envIntersect(ox, oy, oz, dx, dy, dz) {
  const fl = environment._floor;
  if (Math.abs(dy) < RT_EPSILON) return null;
  const t = (fl.y - oy) / dy;
  if (t < RT_EPSILON) return null;

  const hx = ox + dx * t;
  const hz = oz + dz * t;
  if (hx < fl.minX || hx > fl.maxX ||
      hz < fl.minZ || hz > fl.maxZ) return null;

  const ix = Math.floor((hx - fl.offX) / fl.tile);
  const iz = Math.floor((hz - fl.offZ) / fl.tile);
  const color = ((ix + iz) & 1) ? fl.color1 : fl.color0;
  return { t, color, nx: 0, ny: -1, nz: 0, reflectivity: 0 };
}

/**
 * Test if a ray hits any environment geometry within maxDist.
 */
function envAnyHit(ox, oy, oz, dx, dy, dz, maxDist) {
  const fl = environment._floor;
  if (Math.abs(dy) < RT_EPSILON) return false;
  const t = (fl.y - oy) / dy;
  if (t < RT_EPSILON || t > maxDist) return false;

  const hx = ox + dx * t;
  const hz = oz + dz * t;
  return hx >= fl.minX && hx <= fl.maxX &&
         hz >= fl.minZ && hz <= fl.maxZ;
}

/**
 * Sample the environment color for a ray that missed everything.
 * Returns [r, g, b].
 */
function envColor(dx, dy, dz) {
  const sky = environment._sky;
  if (!sky.imageData) {
    const t = Math.max(0, Math.min(1, -dy * 1.5 + 0.5));
    const v = 80 + t * 175;
    return [v, v, v];
  }
  const halfW = WIDTH * 0.5;
  const halfH = HEIGHT * 0.5;
  const u = Math.max(0, Math.min(1, (dx / dz * fov + halfW) / WIDTH));
  const v = Math.max(0, Math.min(1, (dy / dz * fov + halfH) / HEIGHT));
  const px = Math.max(0, Math.min(sky.width - 1, (u * sky.width) | 0));
  const py = Math.max(0, Math.min(sky.height - 1, (v * sky.height) | 0));
  const idx = (py * sky.width + px) * 4;
  return [sky.imageData[idx], sky.imageData[idx + 1], sky.imageData[idx + 2]];
}
