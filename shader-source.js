// @ts-check

// ── GLSL Shader Sources ────────────────────────────────────────

const VERT_SRC = `#version 300 es
void main() {
  float x = float((gl_VertexID & 1) << 2) - 1.0;
  float y = float((gl_VertexID & 2) << 1) - 1.0;
  gl_Position = vec4(x, y, 0.0, 1.0);
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

out vec4 fragColor;

// Camera & lighting
uniform float u_camZ;
uniform float u_fov;
uniform vec3 u_lightDir;
uniform float u_ambient;

// Per-object (max 3)
uniform int u_objCount;
uniform int u_vertOffset[3];
uniform int u_triOffset[3];
uniform int u_normOffset[3];
uniform int u_triCount[3];
uniform int u_normType[3]; // 0=face, 1=vertex
uniform float u_reflectivity[3];
uniform vec3 u_bmin[3];
uniform vec3 u_bmax[3];
uniform int u_bvhOffset[3]; // texel offset into BVH texture
uniform int u_bvhNodeCount[3]; // number of BVH nodes

// Environment (floor plane)
uniform float u_envFloorY;
uniform float u_envFloorTile;
uniform vec3 u_envFloorColor0; // dark tile
uniform vec3 u_envFloorColor1; // light tile
uniform float u_envFloorMinX;
uniform float u_envFloorMaxX;
uniform float u_envFloorMinZ;
uniform float u_envFloorMaxZ;
uniform float u_envFloorOffX; // world offset for tile pattern
uniform float u_envFloorOffZ;

// Data textures
uniform sampler2D u_vertTex;
uniform sampler2D u_triTex;
uniform sampler2D u_colorTex;
uniform sampler2D u_normTex;
uniform sampler2D u_bvhTex;
uniform sampler2D u_skyTex;

// ── Constants ────────────────────────────────────────────────────
// RT_* values are injected from JavaScript (raytrace-common.js) at compile time.
const float RT_EPSILON = __RT_EPSILON__;
const float RT_SHADOW_BIAS = __RT_SHADOW_BIAS__;
const float RT_SPECULAR_EXP = __RT_SPECULAR_EXP__;
const float RT_SPECULAR_STR = __RT_SPECULAR_STR__;
const float RT_LIGHT_RADIUS = __RT_LIGHT_RADIUS__;
const int RT_AO_SAMPLES = __RT_AO_SAMPLES__;
const float RT_AO_RADIUS = __RT_AO_RADIUS__;
const float RT_AO_STRENGTH = __RT_AO_STRENGTH__;
const int RT_MAX_BOUNCES = __RT_MAX_BOUNCES__;
const float TWO_PI = 6.28318530718;
const int BVH_MAX_STACK = 32;
const int ENV_OBJ_IDX = -2; // sentinel for environment (floor) hits

// ── PRNG ───────────────────────────────────────────────────────
uint prngSeed;

float fastRand() {
  prngSeed = prngSeed * 1103515245u + 12345u;
  return float(prngSeed >> 1) / 2147483647.0;
}

// ── Texture fetch (compile-time constant width) ────────────────
vec4 fetchTexel(sampler2D tex, int idx) {
  return texelFetch(tex, ivec2(idx & (TEX_W - 1), idx >> TEX_W_SHIFT), 0);
}

vec4 fetchBVH(int idx) {
  return texelFetch(u_bvhTex, ivec2(idx & (BVH_W - 1), idx >> BVH_W_SHIFT), 0);
}

// ── Environment: miss color (sky) ────────────────────────────────
vec3 envColor(vec3 rd) {
  float halfW = float(SCREEN_W) * 0.5;
  float halfH = float(SCREEN_H) * 0.5;
  float u = (rd.x / rd.z * u_fov + halfW) / float(SCREEN_W);
  float v = (rd.y / rd.z * u_fov + halfH) / float(SCREEN_H);
  vec3 col = texture(u_skyTex, vec2(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0))).rgb;
  return col * 255.0;
}

// ── Ray-Triangle intersection (Möller–Trumbore) ───────────────
vec3 rayTriIntersect(vec3 ro, vec3 rd, vec3 v0, vec3 v1, vec3 v2) {
  vec3 e1 = v1 - v0;
  vec3 e2 = v2 - v0;
  vec3 p = cross(rd, e2);
  float det = dot(e1, p);
  if (abs(det) < RT_EPSILON) return vec3(-1.0);
  float invDet = 1.0 / det;
  vec3 tvec = ro - v0;
  float u = dot(tvec, p) * invDet;
  if (u < 0.0 || u > 1.0) return vec3(-1.0);
  vec3 q = cross(tvec, e1);
  float v = dot(rd, q) * invDet;
  if (v < 0.0 || u + v > 1.0) return vec3(-1.0);
  float t = dot(e2, q) * invDet;
  if (t < RT_EPSILON) return vec3(-1.0);
  return vec3(t, u, v);
}

// ── Ray-AABB intersection (slab method) ────────────────────────
bool rayAABBIntersect(vec3 ro, vec3 invD, vec3 bmin, vec3 bmax) {
  vec3 t0s = (bmin - ro) * invD;
  vec3 t1s = (bmax - ro) * invD;
  vec3 tmin = min(t0s, t1s);
  vec3 tmax = max(t0s, t1s);
  float tNear = max(max(tmin.x, tmin.y), tmin.z);
  float tFar = min(min(tmax.x, tmax.y), tmax.z);
  return tNear <= tFar && tFar >= 0.0;
}

// ── Environment: intersection + any-hit ─────────────────────────
// Generic interface — the raytracing code calls these without
// knowing the specifics of what's in the environment.

// Returns t of intersection, or -1.0 if miss. Sets color and normal.
float envIntersect(vec3 ro, vec3 rd, out vec3 color, out vec3 normal, out float refl) {
  if (abs(rd.y) < RT_EPSILON) return -1.0;
  float t = (u_envFloorY - ro.y) / rd.y;
  if (t < RT_EPSILON) return -1.0;

  vec3 hit = ro + rd * t;
  if (hit.x < u_envFloorMinX || hit.x > u_envFloorMaxX ||
      hit.z < u_envFloorMinZ || hit.z > u_envFloorMaxZ) return -1.0;

  int ix = int(floor((hit.x - u_envFloorOffX) / u_envFloorTile));
  int iz = int(floor((hit.z - u_envFloorOffZ) / u_envFloorTile));
  color = (((ix + iz) & 1) != 0) ? u_envFloorColor1 : u_envFloorColor0;
  normal = vec3(0.0, -1.0, 0.0);
  refl = 0.0;
  return t;
}

// Test if a ray hits any environment geometry within maxDist.
bool envAnyHit(vec3 ro, vec3 rd, float maxDist) {
  if (abs(rd.y) < RT_EPSILON) return false;
  float t = (u_envFloorY - ro.y) / rd.y;
  if (t < RT_EPSILON || t > maxDist) return false;

  vec3 hit = ro + rd * t;
  return hit.x >= u_envFloorMinX && hit.x <= u_envFloorMaxX &&
         hit.z >= u_envFloorMinZ && hit.z <= u_envFloorMaxZ;
}

// ── Scene intersection ─────────────────────────────────────────
struct HitInfo {
  float t;
  vec3 color;
  vec3 normal;
  int objIdx;
  float reflectivity;
};

// BVH-accelerated closest-hit for a single object
void bvhIntersect(vec3 ro, vec3 rd, vec3 invD, int oi,
                  int bvhOff, int vertOff, int triOff, int normOff,
                  inout float bestT, inout bool found, inout HitInfo hit) {
  // Explicit stack for BVH traversal
  int stack[BVH_MAX_STACK];
  int sp = 0;
  stack[sp++] = bvhOff; // push root (texel index)

  for (int iter = 0; iter < 2048; iter++) {
    if (sp <= 0) break;
    int nodeTexel = stack[--sp];

    // Fetch the two texels for this node
    vec4 t0 = fetchBVH(nodeTexel);
    vec4 t1 = fetchBVH(nodeTexel + 1);

    vec3 bmin = t0.xyz;
    vec3 bmax = t1.xyz;

    // AABB test
    if (!rayAABBIntersect(ro, invD, bmin, bmax)) continue;

    if (t0.w < 0.0) {
      // Leaf node: t1.w is triangle index
      int ti = int(t1.w);
      vec4 td = fetchTexel(u_triTex, triOff + ti);
      int i0 = int(td.x), i1 = int(td.y), i2 = int(td.z);

      vec3 v0 = fetchTexel(u_vertTex, vertOff + i0).xyz;
      vec3 v1 = fetchTexel(u_vertTex, vertOff + i1).xyz;
      vec3 v2 = fetchTexel(u_vertTex, vertOff + i2).xyz;

      vec3 res = rayTriIntersect(ro, rd, v0, v1, v2);
      if (res.x > 0.0 && res.x < bestT) {
        bestT = res.x;
        found = true;
        hit.t = res.x;
        hit.objIdx = oi;
        hit.reflectivity = u_reflectivity[oi];
        hit.color = fetchTexel(u_colorTex, triOff + ti).xyz;

        if (u_normType[oi] == 1) {
          vec3 n0 = fetchTexel(u_normTex, normOff + i0).xyz;
          vec3 n1 = fetchTexel(u_normTex, normOff + i1).xyz;
          vec3 n2 = fetchTexel(u_normTex, normOff + i2).xyz;
          float w = 1.0 - res.y - res.z;
          hit.normal = normalize(w * n0 + res.y * n1 + res.z * n2);
        } else {
          hit.normal = fetchTexel(u_normTex, normOff + ti).xyz;
        }
      }
    } else {
      // Inner node: push children
      int leftTexel = bvhOff + int(t0.w) * 2;
      int rightTexel = bvhOff + int(t1.w) * 2;
      // Push right first so left is popped first (closer-first heuristic not needed for correctness)
      if (sp < BVH_MAX_STACK) stack[sp++] = rightTexel;
      if (sp < BVH_MAX_STACK) stack[sp++] = leftTexel;
    }
  }
}

bool sceneIntersect(vec3 ro, vec3 rd, int skipObj, out HitInfo hit) {
  hit.t = 1e30;
  bool found = false;
  vec3 invD = 1.0 / rd;

  // Test mesh objects
  for (int oi = 0; oi < 3; oi++) {
    if (oi >= u_objCount) break;
    if (oi == skipObj) continue;
    if (!rayAABBIntersect(ro, invD, u_bmin[oi], u_bmax[oi])) continue;

    float bestT = hit.t;
    bvhIntersect(ro, rd, invD, oi,
                 u_bvhOffset[oi], u_vertOffset[oi], u_triOffset[oi], u_normOffset[oi],
                 bestT, found, hit);
    hit.t = bestT;
  }
  // Flip normal to face the ray (for double-sided triangles)
  if (found && dot(hit.normal, rd) > 0.0) hit.normal = -hit.normal;

  // Test environment
  if (skipObj != ENV_OBJ_IDX) {
    vec3 envCol, envNorm;
    float envRefl;
    float et = envIntersect(ro, rd, envCol, envNorm, envRefl);
    if (et > 0.0 && et < hit.t) {
      hit.t = et;
      hit.color = envCol;
      hit.normal = envNorm;
      hit.objIdx = ENV_OBJ_IDX;
      hit.reflectivity = envRefl;
      found = true;
    }
  }

  return found;
}

// ── BVH any-hit test (for shadow/AO — early exit) ──────────────
bool bvhAnyHit(vec3 ro, vec3 rd, vec3 invD, int bvhOff, int vertOff, int triOff, float maxDist) {
  int stack[BVH_MAX_STACK];
  int sp = 0;
  stack[sp++] = bvhOff;

  for (int iter = 0; iter < 2048; iter++) {
    if (sp <= 0) break;
    int nodeTexel = stack[--sp];

    vec4 t0 = fetchBVH(nodeTexel);
    vec4 t1 = fetchBVH(nodeTexel + 1);

    if (!rayAABBIntersect(ro, invD, t0.xyz, t1.xyz)) continue;

    if (t0.w < 0.0) {
      int ti = int(t1.w);
      vec4 td = fetchTexel(u_triTex, triOff + ti);
      vec3 v0 = fetchTexel(u_vertTex, vertOff + int(td.x)).xyz;
      vec3 v1 = fetchTexel(u_vertTex, vertOff + int(td.y)).xyz;
      vec3 v2 = fetchTexel(u_vertTex, vertOff + int(td.z)).xyz;
      vec3 res = rayTriIntersect(ro, rd, v0, v1, v2);
      if (res.x > 0.0 && res.x < maxDist) return true;
    } else {
      int leftTexel = bvhOff + int(t0.w) * 2;
      int rightTexel = bvhOff + int(t1.w) * 2;
      if (sp < BVH_MAX_STACK) stack[sp++] = rightTexel;
      if (sp < BVH_MAX_STACK) stack[sp++] = leftTexel;
    }
  }
  return false;
}

bool anyHit(vec3 ro, vec3 rd, int skipObj, float maxDist) {
  vec3 invD = 1.0 / rd;

  // Test mesh objects
  for (int oi = 0; oi < 3; oi++) {
    if (oi >= u_objCount) break;
    if (oi == skipObj) continue;
    if (!rayAABBIntersect(ro, invD, u_bmin[oi], u_bmax[oi])) continue;

    if (bvhAnyHit(ro, rd, invD, u_bvhOffset[oi], u_vertOffset[oi], u_triOffset[oi], maxDist))
      return true;
  }

  // Test environment
  if (skipObj != ENV_OBJ_IDX) {
    if (envAnyHit(ro, rd, maxDist)) return true;
  }

  return false;
}

// ── Soft shadow test (stratified jittered sampling) ─────────────
const int SHADOW_GRID = 4; // 4x4 = 16 samples
float shadowTest(vec3 pos, int origObjIdx) {
  float blocked = 0.0;
  float cellSize = RT_LIGHT_RADIUS / float(SHADOW_GRID);
  float halfGrid = float(SHADOW_GRID) * 0.5;
  for (int sy = 0; sy < SHADOW_GRID; sy++) {
    for (int sx = 0; sx < SHADOW_GRID; sx++) {
      float jx = (float(sx) - halfGrid + fastRand()) * cellSize;
      float jy = (float(sy) - halfGrid + fastRand()) * cellSize;
      float jz = (fastRand() - 0.5) * cellSize;
      vec3 sd = u_lightDir + vec3(jx, jy, jz);
      if (anyHit(pos, sd, origObjIdx, 1e30)) blocked += 1.0;
    }
  }
  return blocked / float(SHADOW_GRID * SHADOW_GRID);
}

// ── Ambient occlusion (stratified hemisphere sampling) ──────────
float aoTest(vec3 pos, vec3 normal, int origObjIdx) {
  float occluded = 0.0;
  for (int s = 0; s < RT_AO_SAMPLES; s++) {
    // Stratified: divide [0,1) into AO_SAMPLES slices for the azimuthal angle
    float phi = TWO_PI * (float(s) + fastRand()) / float(RT_AO_SAMPLES);
    float cosTheta = fastRand();
    float sinTheta = sqrt(1.0 - cosTheta * cosTheta);
    vec3 r = vec3(sinTheta * cos(phi), sinTheta * sin(phi), cosTheta);
    if (dot(r, normal) < 0.0) r = -r;

    if (anyHit(pos, r, origObjIdx, RT_AO_RADIUS)) occluded += 1.0;
  }
  return occluded / float(RT_AO_SAMPLES);
}

// ── Iterative trace ray ───────────────────────────────────────
vec3 traceRay(vec3 ro, vec3 rd) {
  vec3 accum = vec3(0.0);
  float accumWeight = 1.0;
  int skipObj = -1;

  for (int depth = 0; depth <= RT_MAX_BOUNCES; depth++) {
    HitInfo hit;
    if (!sceneIntersect(ro, rd, skipObj, hit)) {
      accum += accumWeight * envColor(rd);
      break;
    }

    // Hit position biased along normal
    vec3 pos = ro + rd * hit.t + hit.normal * RT_SHADOW_BIAS;

    float ndotl = dot(hit.normal, u_lightDir);
    float shadow = shadowTest(pos, hit.objIdx);
    float ao = aoTest(pos, hit.normal, hit.objIdx);

    float lit = 1.0 - shadow;
    float diffuse = lit * max(0.0, ndotl);
    float aoFactor = 1.0 - ao * RT_AO_STRENGTH;

    // Blinn-Phong specular
    float specular = 0.0;
    if (lit > 0.0 && ndotl > 0.0) {
      vec3 halfVec = normalize(-rd + u_lightDir);
      float ndoth = dot(hit.normal, halfVec);
      if (ndoth > 0.0) specular = lit * RT_SPECULAR_STR * pow(ndoth, RT_SPECULAR_EXP);
    }

    float br = min(1.0, u_ambient * aoFactor + diffuse);
    vec3 localColor = hit.color * br + vec3(specular * 255.0);

    // Reflection with Fresnel
    float ddn = dot(rd, hit.normal);
    if (depth < RT_MAX_BOUNCES && hit.reflectivity > 0.0 && ddn < 0.0) {
      float cosTheta = -ddn;
      float f1 = 1.0 - cosTheta;
      float f2 = f1 * f1;
      float refl = hit.reflectivity + (1.0 - hit.reflectivity) * f2 * f2 * f1;

      accum += accumWeight * (1.0 - refl) * localColor;
      accumWeight *= refl;

      // Early termination for negligible contributions
      if (accumWeight < 0.01) break;

      ro = pos;
      rd = rd - 2.0 * ddn * hit.normal;
      skipObj = hit.objIdx;
    } else {
      accum += accumWeight * localColor;
      break;
    }
  }

  return accum;
}

// ── Main ───────────────────────────────────────────────────────
// AA×AA supersampling: fire AA×AA sub-pixel rays per pixel and average
void main() {
  float px = gl_FragCoord.x - 0.5;
  float py = float(SCREEN_H) - 1.0 - gl_FragCoord.y + 0.5;

  float halfW = float(SCREEN_W) * 0.5;
  float halfH = float(SCREEN_H) * 0.5;
  vec3 ro = vec3(0.0, 0.0, u_camZ);

  vec3 colAccum = vec3(0.0);
  const int AA = __RT_AA_GRID__;
  float aaStep = 1.0 / float(AA);
  for (int ay = 0; ay < AA; ay++) {
    for (int ax = 0; ax < AA; ax++) {
      float spx = px + (float(ax) + 0.5) * aaStep - 0.5;
      float spy = py + (float(ay) + 0.5) * aaStep - 0.5;

      // Unique PRNG seed per sub-sample to decorrelate noise
      prngSeed = uint(int(py) * SCREEN_W * AA * AA + int(px) * AA * AA + ay * AA + ax);

      float rdx = spx - halfW;
      float rdy = spy - halfH;
      float len = sqrt(rdx * rdx + rdy * rdy + u_fov * u_fov);
      vec3 rd = vec3(rdx / len, rdy / len, u_fov / len);
      colAccum += traceRay(ro, rd);
    }
  }
  colAccum /= float(AA * AA);
  fragColor = vec4(clamp(colAccum / 255.0, 0.0, 1.0), 1.0);
}
`;
