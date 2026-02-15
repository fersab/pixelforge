// @ts-check

/** Compute the outward face normal for a triangle. */
function faceNormal(v0, v1, v2) {
  return normalize(cross(
    [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]],
    [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]]
  ));
}

/** Compute smooth vertex normals by averaging face normals. */
function computeVertexNormals(vertices, triangles) {
  const normals = vertices.map(() => [0, 0, 0]);

  for (const tri of triangles) {
    const n = cross(
      [vertices[tri[1]][0] - vertices[tri[0]][0], vertices[tri[1]][1] - vertices[tri[0]][1], vertices[tri[1]][2] - vertices[tri[0]][2]],
      [vertices[tri[2]][0] - vertices[tri[0]][0], vertices[tri[2]][1] - vertices[tri[0]][1], vertices[tri[2]][2] - vertices[tri[0]][2]]
    );
    for (const idx of tri) {
      normals[idx][0] += n[0];
      normals[idx][1] += n[1];
      normals[idx][2] += n[2];
    }
  }

  for (let i = 0; i < normals.length; i++) {
    normals[i] = normalize(normals[i]);
  }
  return normals;
}

/** Compute flat face normals — one normal per triangle. */
function computeFaceNormals(vertices, triangles) {
  return triangles.map(tri =>
    faceNormal(vertices[tri[0]], vertices[tri[1]], vertices[tri[2]])
  );
}

/** Rotate a vector using precomputed sin/cos values from rotationCache(). */
function rotateVec(x, y, z, rc) {
  const x1 = x * rc.cosY + z * rc.sinY;
  const z1 = -x * rc.sinY + z * rc.cosY;
  const y1 = y * rc.cosX - z1 * rc.sinX;
  const z2 = y * rc.sinX + z1 * rc.cosX;
  return [
    x1 * rc.cosZ - y1 * rc.sinZ,
    x1 * rc.sinZ + y1 * rc.cosZ,
    z2,
  ];
}

/** Cache current rotation trig values. Call once per object. */
function rotationCache() {
  return {
    cosX: Math.cos(rotX), sinX: Math.sin(rotX),
    cosY: Math.cos(rotY), sinY: Math.sin(rotY),
    cosZ: Math.cos(rotZ), sinZ: Math.sin(rotZ),
  };
}

/** Rotate vertex around object center, translate, then perspective-project. */
function projectOffset(vx, vy, vz, ox, oy, oz, rc) {
  const [rx, ry, rz] = rotateVec(vx, vy, vz, rc);
  const wx = rx + ox, wy = ry + oy, wz = rz + oz;
  const cz = wz - camZ;
  if (cz <= 0) return null;
  return [
    (fov * wx / cz) + (WIDTH / 2),
    (fov * wy / cz) + (HEIGHT / 2),
    cz,
  ];
}

/**
 * Draw a mesh with Blinn-Phong shading. Pass vertexNormals for smooth shading
 * (normals interpolated per-pixel), or faceNormals for flat shading (constant normal per triangle).
 */
function drawObject(vertices, triangles, colors, a, x, y, z, vertexNormals, faceNormals) {
  const rc = rotationCache();

  for (let i = 0; i < triangles.length; i++) {
    const tri = triangles[i];
    const v0 = vertices[tri[0]], v1 = vertices[tri[1]], v2 = vertices[tri[2]];

    const p0 = projectOffset(v0[0], v0[1], v0[2], x, y, z, rc);
    const p1 = projectOffset(v1[0], v1[1], v1[2], x, y, z, rc);
    const p2 = projectOffset(v2[0], v2[1], v2[2], x, y, z, rc);
    if (!p0 || !p1 || !p2) continue;

    // rotate normals to world space, attach to projected points
    if (faceNormals) {
      const fn = faceNormals[i];
      const rn = rotateVec(fn[0], fn[1], fn[2], rc);
      p0.push(rn[0], rn[1], rn[2]);
      p1.push(rn[0], rn[1], rn[2]);
      p2.push(rn[0], rn[1], rn[2]);
    } else {
      const n0 = vertexNormals[tri[0]];
      const rn0 = rotateVec(n0[0], n0[1], n0[2], rc);
      p0.push(rn0[0], rn0[1], rn0[2]);
      const n1 = vertexNormals[tri[1]];
      const rn1 = rotateVec(n1[0], n1[1], n1[2], rc);
      p1.push(rn1[0], rn1[1], rn1[2]);
      const n2 = vertexNormals[tri[2]];
      const rn2 = rotateVec(n2[0], n2[1], n2[2], rc);
      p2.push(rn2[0], rn2[1], rn2[2]);
    }

    const c = colors[i];
    fillpoly([p0, p1, p2], c[0], c[1], c[2], a);
  }
}
