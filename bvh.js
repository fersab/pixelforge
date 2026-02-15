// @ts-check

// ── BVH (Bounding Volume Hierarchy) ──────────────────────────────
// Shared acceleration structure used by both CPU and GPU raytracers.
// Construction builds a flat array of nodes; traversal functions
// walk the tree to find ray-triangle intersections efficiently.

// ── Ray-primitive intersection ───────────────────────────────────

/**
 * Möller–Trumbore ray-triangle intersection (double-sided).
 * Returns { t, u, v } if hit, null if miss.
 */
function rayTriangleIntersect(ox, oy, oz, dx, dy, dz, v0, v1, v2) {
  const e1x = v1[0] - v0[0], e1y = v1[1] - v0[1], e1z = v1[2] - v0[2];
  const e2x = v2[0] - v0[0], e2y = v2[1] - v0[1], e2z = v2[2] - v0[2];

  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;

  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < RT_EPSILON) return null;

  const invDet = 1.0 / det;

  const tx = ox - v0[0], ty = oy - v0[1], tz = oz - v0[2];
  const u = (tx * px + ty * py + tz * pz) * invDet;
  if (u < 0 || u > 1) return null;

  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;

  const v = (dx * qx + dy * qy + dz * qz) * invDet;
  if (v < 0 || u + v > 1) return null;

  const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
  if (t < RT_EPSILON) return null;

  return { t, u, v };
}

/** Ray-AABB intersection using slab method. */
function rayAABBIntersect(ox, oy, oz, dx, dy, dz, bmin, bmax) {
  const invDx = 1.0 / dx, invDy = 1.0 / dy, invDz = 1.0 / dz;

  let tmin = (bmin[0] - ox) * invDx;
  let tmax = (bmax[0] - ox) * invDx;
  if (tmin > tmax) { const tmp = tmin; tmin = tmax; tmax = tmp; }

  let tymin = (bmin[1] - oy) * invDy;
  let tymax = (bmax[1] - oy) * invDy;
  if (tymin > tymax) { const tmp = tymin; tymin = tymax; tymax = tmp; }

  if (tmin > tymax || tymin > tmax) return false;
  if (tymin > tmin) tmin = tymin;
  if (tymax < tmax) tmax = tymax;

  let tzmin = (bmin[2] - oz) * invDz;
  let tzmax = (bmax[2] - oz) * invDz;
  if (tzmin > tzmax) { const tmp = tzmin; tzmin = tzmax; tzmax = tmp; }

  return tmin <= tzmax && tzmin <= tmax;
}

// ── Construction ─────────────────────────────────────────────────

/** Compute the AABB enclosing a range of triangles in triInfos. */
function computeTriangleAABB(worldVerts, triangles, triInfos, start, end) {
  let bminx = Infinity, bminy = Infinity, bminz = Infinity;
  let bmaxx = -Infinity, bmaxy = -Infinity, bmaxz = -Infinity;
  for (let i = start; i < end; i++) {
    const tri = triangles[triInfos[i].idx];
    const v0 = worldVerts[tri[0]], v1 = worldVerts[tri[1]], v2 = worldVerts[tri[2]];
    if (v0[0] < bminx) bminx = v0[0]; if (v0[0] > bmaxx) bmaxx = v0[0];
    if (v0[1] < bminy) bminy = v0[1]; if (v0[1] > bmaxy) bmaxy = v0[1];
    if (v0[2] < bminz) bminz = v0[2]; if (v0[2] > bmaxz) bmaxz = v0[2];
    if (v1[0] < bminx) bminx = v1[0]; if (v1[0] > bmaxx) bmaxx = v1[0];
    if (v1[1] < bminy) bminy = v1[1]; if (v1[1] > bmaxy) bmaxy = v1[1];
    if (v1[2] < bminz) bminz = v1[2]; if (v1[2] > bmaxz) bmaxz = v1[2];
    if (v2[0] < bminx) bminx = v2[0]; if (v2[0] > bmaxx) bmaxx = v2[0];
    if (v2[1] < bminy) bminy = v2[1]; if (v2[1] > bmaxy) bmaxy = v2[1];
    if (v2[2] < bminz) bminz = v2[2]; if (v2[2] > bmaxz) bmaxz = v2[2];
  }
  return { bmin: [bminx, bminy, bminz], bmax: [bmaxx, bmaxy, bmaxz] };
}

/** Build a BVH tree for a set of triangles. Returns flat array of nodes. */
function buildBVH(worldVerts, triangles) {
  const triCount = triangles.length;
  const triInfos = new Array(triCount);
  for (let i = 0; i < triCount; i++) {
    const tri = triangles[i];
    const v0 = worldVerts[tri[0]], v1 = worldVerts[tri[1]], v2 = worldVerts[tri[2]];
    triInfos[i] = {
      idx: i,
      cx: (v0[0] + v1[0] + v2[0]) / 3,
      cy: (v0[1] + v1[1] + v2[1]) / 3,
      cz: (v0[2] + v1[2] + v2[2]) / 3,
    };
  }

  const nodes = [];

  function buildNode(start, end) {
    const nodeIdx = nodes.length;
    nodes.push(null);

    const { bmin, bmax } = computeTriangleAABB(worldVerts, triangles, triInfos, start, end);

    if (end - start === 1) {
      nodes[nodeIdx] = { bmin, bmax, left: -1, right: -1, triIdx: triInfos[start].idx };
      return nodeIdx;
    }

    // Split along longest axis at median centroid
    const dx = bmax[0] - bmin[0], dy = bmax[1] - bmin[1], dz = bmax[2] - bmin[2];
    const key = dx >= dy && dx >= dz ? 'cx' : (dy >= dz ? 'cy' : 'cz');
    const sub = triInfos.slice(start, end).sort((a, b) => a[key] - b[key]);
    for (let i = 0; i < sub.length; i++) triInfos[start + i] = sub[i];

    const mid = start + ((end - start) >> 1);
    const left = buildNode(start, mid);
    const right = buildNode(mid, end);

    nodes[nodeIdx] = { bmin, bmax, left, right, triIdx: -1 };
    return nodeIdx;
  }

  if (triCount > 0) buildNode(0, triCount);
  return nodes;
}

// ── Traversal ────────────────────────────────────────────────────

// Pre-allocated stack for iterative BVH traversal (avoids per-ray allocation)
const _bvhStack = new Int32Array(64);

/**
 * Walk BVH nodes, calling onLeaf(triIdx) for each leaf whose AABB is hit.
 * onLeaf returns true to stop early (any-hit), false to continue (closest-hit).
 */
function bvhTraverse(ox, oy, oz, dx, dy, dz, nodes, onLeaf) {
  let stackPtr = 0;
  _bvhStack[stackPtr++] = 0;

  while (stackPtr > 0) {
    const node = nodes[_bvhStack[--stackPtr]];

    if (!rayAABBIntersect(ox, oy, oz, dx, dy, dz, node.bmin, node.bmax)) continue;

    if (node.triIdx >= 0) {
      if (onLeaf(node.triIdx)) return;
    } else {
      _bvhStack[stackPtr++] = node.left;
      _bvhStack[stackPtr++] = node.right;
    }
  }
}

/**
 * Find the closest triangle hit in a BVH.
 * Returns { t, triIdx, hit } or null.
 */
function bvhClosestHit(ox, oy, oz, dx, dy, dz, nodes, worldVerts, triangles, maxT) {
  if (nodes.length === 0) return null;

  let bestT = maxT, bestTriIdx = -1, bestHit = null;

  bvhTraverse(ox, oy, oz, dx, dy, dz, nodes, function(triIdx) {
    const tri = triangles[triIdx];
    const hit = rayTriangleIntersect(ox, oy, oz, dx, dy, dz,
      worldVerts[tri[0]], worldVerts[tri[1]], worldVerts[tri[2]]);
    if (hit && hit.t < bestT) {
      bestT = hit.t;
      bestTriIdx = triIdx;
      bestHit = hit;
    }
    return false; // continue — need closest
  });

  return bestTriIdx >= 0 ? { t: bestT, triIdx: bestTriIdx, hit: bestHit } : null;
}

/**
 * Test if any triangle in a BVH is hit within maxT.
 * Returns true on first hit (early exit), false if none.
 */
function bvhAnyHit(ox, oy, oz, dx, dy, dz, nodes, worldVerts, triangles, maxT) {
  if (nodes.length === 0) return false;

  let found = false;

  bvhTraverse(ox, oy, oz, dx, dy, dz, nodes, function(triIdx) {
    const tri = triangles[triIdx];
    const hit = rayTriangleIntersect(ox, oy, oz, dx, dy, dz,
      worldVerts[tri[0]], worldVerts[tri[1]], worldVerts[tri[2]]);
    if (hit && hit.t < maxT) { found = true; return true; } // early exit
    return false;
  });

  return found;
}
