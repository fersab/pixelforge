// @ts-check

// ── Shared rendering constants ──────────────────────────────────
// Used by rasterizer, CPU raytracer, and injected into GPU raytracer (GLSL).

const RT_EPSILON = 1e-6;
const RT_SHADOW_BIAS = 0.5;
const RT_SPECULAR_EXP = 64;
const RT_SPECULAR_STR = 0.5;
const RT_SHADOW_SAMPLES = 16;
const RT_LIGHT_RADIUS = 0.15;
const RT_AO_SAMPLES = 8;
const RT_AO_RADIUS = 40;
const RT_AO_STRENGTH = 0.6;
const RT_MAX_BOUNCES = 3;
let RT_AA_GRID = 2;           // NxN supersampling grid (CPU + GPU raytracers): 1 = off, 2 = 2×2 (4 samples)
const METABALL_GRID_RES = 48;
const METABALL_THRESHOLD = 1.0;

// ── Transform mesh to world space ──────────────────────────────
function transformMesh(vertices, triangles, colors, rx, ry, rz, ox, oy, oz, vertexNormals, faceNormals, reflectivity) {
  rotX = rx; rotY = ry; rotZ = rz;
  const rc = rotationCache();

  const worldVerts = vertices.map(v => {
    const r = rotateVec(v[0], v[1], v[2], rc);
    return [r[0] + ox, r[1] + oy, r[2] + oz];
  });

  const worldVertexNormals = vertexNormals
    ? vertexNormals.map(n => rotateVec(n[0], n[1], n[2], rc))
    : null;

  const worldFaceNormals = faceNormals
    ? faceNormals.map(n => rotateVec(n[0], n[1], n[2], rc))
    : null;

  const bvhNodes = buildBVH(worldVerts, triangles);
  const bmin = bvhNodes.length > 0 ? bvhNodes[0].bmin : [0, 0, 0];
  const bmax = bvhNodes.length > 0 ? bvhNodes[0].bmax : [0, 0, 0];
  return { worldVerts, triangles, colors, worldVertexNormals, worldFaceNormals, bmin, bmax, bvhNodes, reflectivity: reflectivity || 0 };
}

// ── Build transformed scene from scene object descriptors ───────
function buildSceneFromObjects(t, sceneObjects) {
  const scene = [];
  for (const obj of sceneObjects) {
    scene.push(transformMesh(
      obj.vertices, obj.triangles, obj.colors,
      obj.rx(t), obj.ry(t), obj.rz(t),
      typeof obj.x === 'function' ? obj.x(t) : obj.x,
      typeof obj.y === 'function' ? obj.y(t) : obj.y,
      typeof obj.z === 'function' ? obj.z(t) : obj.z,
      obj.vertexNormals, obj.faceNormals, obj.reflectivity
    ));
  }
  return scene;
}
