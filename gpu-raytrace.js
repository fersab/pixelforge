// @ts-check

// ── WebGL2 GPU Raytracer ───────────────────────────────────────
// Moves all per-pixel ray math to a fragment shader.
// CPU handles BVH construction and WebGL setup.
// Renders directly to a visible WebGL canvas.

/** @type {WebGL2RenderingContext} */
let gl;
let gpuProgram;
let vertTex, triTex, colorTex, normTex, bvhTex, skyTex;
const uLocs = {};
const TEX_WIDTH = 128;
const TEX_HEIGHT = 128; // 16384 texels — generous headroom for dynamic metaball meshes
const BVH_TEX_WIDTH = 256;
const BVH_TEX_HEIGHT = 256; // 65536 texels — enough for ~32k BVH nodes

// Pre-allocated packing buffers (reused each frame)
const maxTexels = TEX_WIDTH * TEX_HEIGHT;
const vertData = new Float32Array(maxTexels * 4);
const triData = new Float32Array(maxTexels * 4);
const colorData = new Float32Array(maxTexels * 4);
const normData = new Float32Array(maxTexels * 4);

const maxBvhTexels = BVH_TEX_WIDTH * BVH_TEX_HEIGHT;
const bvhData = new Float32Array(maxBvhTexels * 4);

// Pack BVH nodes into texture data (GPU-specific).
// Each node = 2 texels:
//   texel 0: [bmin.x, bmin.y, bmin.z, child/triIdx]
//   texel 1: [bmax.x, bmax.y, bmax.z, child/triIdx]
// For inner nodes: texel0.w = left child node index, texel1.w = right child node index
// For leaf nodes: texel0.w = -1 (sentinel), texel1.w = triangle index (encoded as float)
// The shader distinguishes leaf vs inner by checking texel0.w < 0
function packBVHNodes(nodes, offset) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const base = (offset + i * 2) * 4;
    // Texel 0: bmin + left/sentinel
    bvhData[base]     = n.bmin[0];
    bvhData[base + 1] = n.bmin[1];
    bvhData[base + 2] = n.bmin[2];
    bvhData[base + 3] = n.triIdx >= 0 ? -1.0 : n.left;
    // Texel 1: bmax + right/triIdx
    bvhData[base + 4] = n.bmax[0];
    bvhData[base + 5] = n.bmax[1];
    bvhData[base + 6] = n.bmax[2];
    bvhData[base + 7] = n.triIdx >= 0 ? n.triIdx : n.right;
  }
  return nodes.length * 2; // texels used
}

// ── WebGL helpers ──────────────────────────────────────────────

function compileShader(type, src) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    return null;
  }
  return shader;
}

function linkProgram(vs, fs) {
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(prog));
    return null;
  }
  return prog;
}

function createFloat32Texture(w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

// ── Initialization ─────────────────────────────────────────────

/** Replace the 2D canvas with a WebGL2 canvas and init the GL context. */
function initWebGLCanvas() {
  const oldCanvas = document.getElementById('screen');
  const newCanvas = document.createElement('canvas');
  newCanvas.id = 'screen';
  newCanvas.width = WIDTH;
  newCanvas.height = HEIGHT;
  oldCanvas.parentNode.replaceChild(newCanvas, oldCanvas);
  gl = newCanvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: false });
}

/** Compile the vertex and fragment shaders, link into a program. */
function initShaderProgram() {
  const texWShift = Math.log2(TEX_WIDTH) | 0;
  const bvhWShift = Math.log2(BVH_TEX_WIDTH) | 0;
  // GLSL needs floats for float constants, ints for int constants
  const toGLSLFloat = v => Number.isInteger(v) ? v + '.0' : String(v);
  const fragSrc = FRAG_SRC.replace(/SCREEN_W/g, WIDTH.toString())
                           .replace(/SCREEN_H/g, HEIGHT.toString())
                           .replace(/TEX_W_SHIFT/g, texWShift.toString())
                           .replace(/TEX_W\b/g, TEX_WIDTH.toString())
                           .replace(/BVH_W_SHIFT/g, bvhWShift.toString())
                           .replace(/BVH_W\b/g, BVH_TEX_WIDTH.toString())
                           .replace(/__RT_EPSILON__/g, toGLSLFloat(RT_EPSILON))
                           .replace(/__RT_SHADOW_BIAS__/g, toGLSLFloat(RT_SHADOW_BIAS))
                           .replace(/__RT_SPECULAR_EXP__/g, toGLSLFloat(RT_SPECULAR_EXP))
                           .replace(/__RT_SPECULAR_STR__/g, toGLSLFloat(RT_SPECULAR_STR))
                           .replace(/__RT_LIGHT_RADIUS__/g, toGLSLFloat(RT_LIGHT_RADIUS))
                           .replace(/__RT_AO_SAMPLES__/g, RT_AO_SAMPLES.toString())
                           .replace(/__RT_AO_RADIUS__/g, toGLSLFloat(RT_AO_RADIUS))
                           .replace(/__RT_AO_STRENGTH__/g, toGLSLFloat(RT_AO_STRENGTH))
                           .replace(/__RT_MAX_BOUNCES__/g, RT_MAX_BOUNCES.toString());
  const vs = compileShader(gl.VERTEX_SHADER, VERT_SRC);
  const fs = compileShader(gl.FRAGMENT_SHADER, fragSrc);
  if (!vs || !fs) return false;
  gpuProgram = linkProgram(vs, fs);
  return !!gpuProgram;
}

/** Cache all uniform locations for the shader program. */
function cacheUniformLocations() {
  gl.useProgram(gpuProgram);
  const globals = ['camZ', 'fov', 'lightDir', 'ambient', 'objCount',
                   'vertTex', 'triTex', 'colorTex', 'normTex', 'bvhTex', 'skyTex',
                   'envFloorY', 'envFloorTile', 'envFloorColor0', 'envFloorColor1',
                   'envFloorMinX', 'envFloorMaxX', 'envFloorMinZ', 'envFloorMaxZ',
                   'envFloorOffX', 'envFloorOffZ'];
  for (const name of globals) {
    uLocs[name] = gl.getUniformLocation(gpuProgram, 'u_' + name);
  }
  const perObj = ['vertOffset', 'triOffset', 'normOffset', 'triCount',
                  'normType', 'reflectivity', 'bmin', 'bmax', 'bvhOffset', 'bvhNodeCount'];
  for (let i = 0; i < 3; i++) {
    for (const name of perObj) {
      uLocs[name + i] = gl.getUniformLocation(gpuProgram, 'u_' + name + '[' + i + ']');
    }
  }
}

/** Upload the environment sky image as a WebGL texture. */
function initSkyTexture() {
  if (!environment._sky.imageData) {
    // Image not yet decoded; retry on next frame
    requestAnimationFrame(initSkyTexture);
    return;
  }
  const sky = environment._sky;
  const imgData = new ImageData(new Uint8ClampedArray(sky.imageData), sky.width, sky.height);
  skyTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE5);
  gl.bindTexture(gl.TEXTURE_2D, skyTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imgData);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

/** Main GPU initialization: canvas, shaders, textures, uniforms. */
function initGPU() {
  initWebGLCanvas();
  if (!gl) { console.error('WebGL2 not supported'); return; }
  if (!initShaderProgram()) return;

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  vertTex = createFloat32Texture(TEX_WIDTH, TEX_HEIGHT);
  triTex = createFloat32Texture(TEX_WIDTH, TEX_HEIGHT);
  colorTex = createFloat32Texture(TEX_WIDTH, TEX_HEIGHT);
  normTex = createFloat32Texture(TEX_WIDTH, TEX_HEIGHT);
  bvhTex = createFloat32Texture(BVH_TEX_WIDTH, BVH_TEX_HEIGHT);

  cacheUniformLocations();

  gl.uniform1i(uLocs.vertTex, 0);
  gl.uniform1i(uLocs.triTex, 1);
  gl.uniform1i(uLocs.colorTex, 2);
  gl.uniform1i(uLocs.normTex, 3);
  gl.uniform1i(uLocs.bvhTex, 4);
  gl.uniform1i(uLocs.skyTex, 5);

  initSkyTexture();
  gl.viewport(0, 0, WIDTH, HEIGHT);
}

// ── Per-frame upload & render ──────────────────────────────────

/** Pack an array of vec3s into a Float32Array as RGBA texels (w=0). */
function packVec3Array(items, buf, startIdx) {
  let idx = startIdx;
  for (let i = 0; i < items.length; i++) {
    const v = items[i];
    const base = idx * 4;
    buf[base] = v[0]; buf[base + 1] = v[1]; buf[base + 2] = v[2]; buf[base + 3] = 0;
    idx++;
  }
  return idx;
}

/** Set per-object uniforms for one scene object. */
function setObjectUniforms(oi, vOff, tOff, nOff, bvhOff, obj, bvhNodeCount) {
  gl.uniform1i(uLocs['vertOffset' + oi], vOff);
  gl.uniform1i(uLocs['triOffset' + oi], tOff);
  gl.uniform1i(uLocs['normOffset' + oi], nOff);
  gl.uniform1i(uLocs['triCount' + oi], obj.triangles.length);
  gl.uniform1i(uLocs['normType' + oi], obj.worldVertexNormals ? 1 : 0);
  gl.uniform1f(uLocs['reflectivity' + oi], obj.reflectivity);
  gl.uniform3f(uLocs['bmin' + oi], obj.bmin[0], obj.bmin[1], obj.bmin[2]);
  gl.uniform3f(uLocs['bmax' + oi], obj.bmax[0], obj.bmax[1], obj.bmax[2]);
  gl.uniform1i(uLocs['bvhOffset' + oi], bvhOff);
  gl.uniform1i(uLocs['bvhNodeCount' + oi], bvhNodeCount);
}

/** Upload a Float32Array to a texture unit via texSubImage2D. */
function uploadTexture(unit, tex, data, w, h) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, data);
}

/** Pack all scene objects into GPU data textures and set uniforms. */
function uploadSceneData(scene) {
  let vertIdx = 0, triIdx = 0, normIdx = 0, bvhTexelIdx = 0;
  for (let oi = 0; oi < scene.length; oi++) {
    const obj = scene[oi];
    const vOff = vertIdx, tOff = triIdx, nOff = normIdx, bvhOff = bvhTexelIdx;

    vertIdx = packVec3Array(obj.worldVerts, vertData, vertIdx);
    triIdx = packVec3Array(obj.triangles, triData, triIdx);
    packVec3Array(obj.colors, colorData, tOff);
    normIdx = packVec3Array(obj.worldVertexNormals || obj.worldFaceNormals, normData, normIdx);

    bvhTexelIdx += packBVHNodes(obj.bvhNodes, bvhTexelIdx);

    setObjectUniforms(oi, vOff, tOff, nOff, bvhOff, obj, obj.bvhNodes.length);
  }

  uploadTexture(0, vertTex, vertData, TEX_WIDTH, TEX_HEIGHT);
  uploadTexture(1, triTex, triData, TEX_WIDTH, TEX_HEIGHT);
  uploadTexture(2, colorTex, colorData, TEX_WIDTH, TEX_HEIGHT);
  uploadTexture(3, normTex, normData, TEX_WIDTH, TEX_HEIGHT);
  uploadTexture(4, bvhTex, bvhData, BVH_TEX_WIDTH, BVH_TEX_HEIGHT);
}

/** Transform scene to world space, upload to GPU textures, and render one frame. */
function gpuRaytraceScene(t, sceneObjects) {
  const scene = buildSceneFromObjects(t, sceneObjects);

  // Upload and render
  gl.useProgram(gpuProgram);
  uploadSceneData(scene);

  gl.uniform1f(uLocs.camZ, camZ);
  gl.uniform1f(uLocs.fov, fov);
  gl.uniform3f(uLocs.lightDir, lightDir[0], lightDir[1], lightDir[2]);
  gl.uniform1f(uLocs.ambient, ambient);
  gl.uniform1i(uLocs.objCount, scene.length);

  // Environment uniforms (floor plane from environment._floor)
  const fl = environment._floor;
  gl.uniform1f(uLocs.envFloorY, fl.y);
  gl.uniform1f(uLocs.envFloorTile, fl.tile);
  gl.uniform3f(uLocs.envFloorColor0, fl.color0[0], fl.color0[1], fl.color0[2]);
  gl.uniform3f(uLocs.envFloorColor1, fl.color1[0], fl.color1[1], fl.color1[2]);
  gl.uniform1f(uLocs.envFloorMinX, fl.minX);
  gl.uniform1f(uLocs.envFloorMaxX, fl.maxX);
  gl.uniform1f(uLocs.envFloorMinZ, fl.minZ);
  gl.uniform1f(uLocs.envFloorMaxZ, fl.maxZ);
  gl.uniform1f(uLocs.envFloorOffX, fl.offX);
  gl.uniform1f(uLocs.envFloorOffZ, fl.offZ);

  // Ensure sky texture is bound
  gl.activeTexture(gl.TEXTURE5);
  gl.bindTexture(gl.TEXTURE_2D, skyTex);

  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
