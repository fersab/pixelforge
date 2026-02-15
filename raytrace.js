// @ts-check

// Deterministic PRNG for jittering shadow/AO rays per pixel.
// Linear congruential generator (glibc constants: a=1103515245, c=12345).
let _shadowSeed = 0;
function fastRand() {
  _shadowSeed = (_shadowSeed * 1103515245 + 12345) & 0x7fffffff;
  return _shadowSeed / 0x7fffffff;
}

// ── Shadow & AO ────────────────────────────────────────────────

/** Test if any geometry in the scene occludes a ray within maxDist. */
function sceneAnyHit(ox, oy, oz, dx, dy, dz, scene, maxDist, skipObj) {
  for (let oi = 0; oi < scene.length; oi++) {
    if (oi === skipObj) continue;
    const obj = scene[oi];
    if (bvhAnyHit(ox, oy, oz, dx, dy, dz, obj.bvhNodes, obj.worldVerts, obj.triangles, maxDist)) return true;
  }
  if (skipObj !== ENV_OBJ_IDX && envAnyHit(ox, oy, oz, dx, dy, dz, maxDist)) return true;
  return false;
}

/** Soft shadow test: returns 0 (fully lit) to 1 (fully shadowed). */
function shadowTest(ox, oy, oz, scene, origObjIdx) {
  let blocked = 0;
  for (let s = 0; s < RT_SHADOW_SAMPLES; s++) {
    const jx = (fastRand() - 0.5) * RT_LIGHT_RADIUS;
    const jy = (fastRand() - 0.5) * RT_LIGHT_RADIUS;
    const jz = (fastRand() - 0.5) * RT_LIGHT_RADIUS;
    const sdx = lightDir[0] + jx, sdy = lightDir[1] + jy, sdz = lightDir[2] + jz;
    if (sceneAnyHit(ox, oy, oz, sdx, sdy, sdz, scene, Infinity, origObjIdx)) blocked++;
  }
  return blocked / RT_SHADOW_SAMPLES;
}

/** Generate a random unit direction in the hemisphere around a normal. */
function sampleHemisphere(nx, ny, nz) {
  const rx = fastRand() * 2 - 1;
  const ry = fastRand() * 2 - 1;
  const rz = fastRand() * 2 - 1;
  const rlen = Math.sqrt(rx * rx + ry * ry + rz * rz);
  if (rlen < 0.01) return null;
  const d = normalize([rx, ry, rz]);
  if (d[0] * nx + d[1] * ny + d[2] * nz < 0) { d[0] = -d[0]; d[1] = -d[1]; d[2] = -d[2]; }
  return d;
}

/** Ambient occlusion: returns 0 (fully open) to 1 (fully occluded). */
function aoTest(ox, oy, oz, nx, ny, nz, scene, origObjIdx) {
  let occluded = 0;
  for (let s = 0; s < RT_AO_SAMPLES; s++) {
    const dir = sampleHemisphere(nx, ny, nz);
    if (!dir) continue;
    if (sceneAnyHit(ox, oy, oz, dir[0], dir[1], dir[2], scene, RT_AO_RADIUS, origObjIdx)) occluded++;
  }
  return occluded / RT_AO_SAMPLES;
}

// ── Normal interpolation ───────────────────────────────────────

/** Interpolate the surface normal at a hit point using barycentric coords. */
function interpolateNormal(tri, hit, worldVertexNormals, worldFaceNormals, triIdx) {
  if (worldVertexNormals) {
    const n0 = worldVertexNormals[tri[0]];
    const n1 = worldVertexNormals[tri[1]];
    const n2 = worldVertexNormals[tri[2]];
    const w = 1 - hit.u - hit.v;
    return normalize([
      w * n0[0] + hit.u * n1[0] + hit.v * n2[0],
      w * n0[1] + hit.u * n1[1] + hit.v * n2[1],
      w * n0[2] + hit.u * n1[2] + hit.v * n2[2],
    ]);
  }
  const fn = worldFaceNormals[triIdx];
  return [fn[0], fn[1], fn[2]];
}

/** Test a ray against one object's triangles. Returns { t, triIdx, hit } or null. */
function intersectObject(ox, oy, oz, dx, dy, dz, obj, maxT) {
  return bvhClosestHit(ox, oy, oz, dx, dy, dz, obj.bvhNodes, obj.worldVerts, obj.triangles, maxT);
}

// ── Scene intersection ─────────────────────────────────────────

/**
 * Find closest intersection of ray with scene + environment.
 * skipObj: object index to skip, or ENV_OBJ_IDX to skip environment.
 */
function sceneIntersect(ox, oy, oz, dx, dy, dz, scene, skipObj) {
  let closestT = Infinity;
  let result = null;

  // Test mesh objects
  for (let oi = 0; oi < scene.length; oi++) {
    if (oi === skipObj) continue;
    const obj = scene[oi];

    const objHit = intersectObject(ox, oy, oz, dx, dy, dz, obj, closestT);
    if (!objHit) continue;

    closestT = objHit.t;
    const n = interpolateNormal(obj.triangles[objHit.triIdx], objHit.hit,
      obj.worldVertexNormals, obj.worldFaceNormals, objHit.triIdx);
    if (n[0] * dx + n[1] * dy + n[2] * dz > 0) {
      n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2];
    }
    result = {
      t: closestT, color: obj.colors[objHit.triIdx],
      nx: n[0], ny: n[1], nz: n[2],
      objIdx: oi, reflectivity: obj.reflectivity,
    };
  }

  // Test environment
  if (skipObj !== ENV_OBJ_IDX) {
    const eh = envIntersect(ox, oy, oz, dx, dy, dz);
    if (eh && eh.t < closestT) {
      result = {
        t: eh.t, color: eh.color,
        nx: eh.nx, ny: eh.ny, nz: eh.nz,
        objIdx: ENV_OBJ_IDX, reflectivity: eh.reflectivity,
      };
    }
  }

  return result;
}

// ── Trace ray ──────────────────────────────────────────────────

function traceRay(ox, oy, oz, dx, dy, dz, scene, depth, skipObj) {
  const hit = sceneIntersect(ox, oy, oz, dx, dy, dz, scene, skipObj);
  if (!hit) return envColor(dx, dy, dz);

  const { t, color, nx, ny, nz, objIdx, reflectivity } = hit;

  const hx = ox + dx * t + nx * RT_SHADOW_BIAS;
  const hy = oy + dy * t + ny * RT_SHADOW_BIAS;
  const hz = oz + dz * t + nz * RT_SHADOW_BIAS;

  const shadow = shadowTest(hx, hy, hz, scene, objIdx);
  const ao = aoTest(hx, hy, hz, nx, ny, nz, scene, objIdx);

  const ndotl = nx * lightDir[0] + ny * lightDir[1] + nz * lightDir[2];
  const lit = 1 - shadow;
  const diffuse = lit * Math.max(0, ndotl);
  const aoFactor = 1 - ao * RT_AO_STRENGTH;

  let specular = 0;
  if (lit > 0 && ndotl > 0) {
    const vx = -dx, vy = -dy, vz = -dz;
    const hvx = vx + lightDir[0], hvy = vy + lightDir[1], hvz = vz + lightDir[2];
    const hlen = Math.sqrt(hvx * hvx + hvy * hvy + hvz * hvz);
    if (hlen > 0) {
      const ndoth = nx * (hvx / hlen) + ny * (hvy / hlen) + nz * (hvz / hlen);
      if (ndoth > 0) specular = lit * RT_SPECULAR_STR * Math.pow(ndoth, RT_SPECULAR_EXP);
    }
  }

  const br = Math.min(1, ambient * aoFactor + diffuse);
  let r = color[0] * br + specular * 255;
  let g = color[1] * br + specular * 255;
  let b = color[2] * br + specular * 255;

  if (depth > 0 && reflectivity > 0) {
    const ddn = dx * nx + dy * ny + dz * nz;
    if (ddn < 0) {
      const cosTheta = -ddn;
      const f1 = 1 - cosTheta;
      const f2 = f1 * f1;
      const refl = reflectivity + (1 - reflectivity) * f2 * f2 * f1;

      const rx = dx - 2 * ddn * nx;
      const ry = dy - 2 * ddn * ny;
      const rz = dz - 2 * ddn * nz;
      const ref = traceRay(hx, hy, hz, rx, ry, rz, scene, depth - 1, objIdx);
      r = r * (1 - refl) + ref[0] * refl;
      g = g * (1 - refl) + ref[1] * refl;
      b = b * (1 - refl) + ref[2] * refl;
    }
  }

  return [Math.min(255, r), Math.min(255, g), Math.min(255, b)];
}

/** Raytrace the entire scene for one frame. Supports RT_AA_GRID×RT_AA_GRID supersampling. */
function raytraceScene(t, sceneObjects) {
  const scene = buildSceneFromObjects(t, sceneObjects);

  const halfW = WIDTH * 0.5;
  const halfH = HEIGHT * 0.5;
  const aa = RT_AA_GRID;
  const aaSamples = aa * aa;
  const aaStep = 1 / aa;

  for (let py = 0; py < HEIGHT; py++) {
    for (let px = 0; px < WIDTH; px++) {
      let rr = 0, rg = 0, rb = 0;

      for (let ay = 0; ay < aa; ay++) {
        for (let ax = 0; ax < aa; ax++) {
          const spx = px + (ax + 0.5) * aaStep - 0.5;
          const spy = py + (ay + 0.5) * aaStep - 0.5;

          // Unique PRNG seed per sub-sample to decorrelate noise
          _shadowSeed = (py * aa + ay) * WIDTH * aa + (px * aa + ax);

          const rdx = spx - halfW;
          const rdy = spy - halfH;
          const len = Math.sqrt(rdx * rdx + rdy * rdy + fov * fov);
          const dx = rdx / len, dy = rdy / len, dz = fov / len;

          const col = traceRay(0, 0, camZ, dx, dy, dz, scene, RT_MAX_BOUNCES, -1);
          rr += col[0]; rg += col[1]; rb += col[2];
        }
      }

      putpixel(px, py, 1e9, rr / aaSamples, rg / aaSamples, rb / aaSamples, 255);
    }
  }
}
