// @ts-check

const renderMode = localStorage.getItem('renderMode') || 'gpu-raytrace';

// Set the correct radio button on load
const radio = document.getElementById('rm-' + (renderMode === 'gpu-raytrace' ? 'gpu' : renderMode));
if (radio) radio.checked = true;

// Apply button — save selection and reload
document.getElementById('applyBtn').addEventListener('click', function() {
  const selected = document.querySelector('input[name="renderMode"]:checked').value;
  localStorage.setItem('renderMode', selected);
  location.reload();
});

// Sphere — smooth shaded (commented out, replaced by metaballs)
// const sphereColors = sphereMesh.triangles.map(() => [180, 190, 200]);
// const sphereNormals = computeVertexNormals(sphereMesh.vertices, sphereMesh.triangles);

// Metaball definitions — local-space animated centers
// Orbits are wide enough relative to radii so blobs visibly separate and merge
const metaballDefs = [
  { x: t => Math.sin(t) * 70,         y: t => Math.cos(t * 0.7) * 50,        z: t => Math.sin(t * 0.5) * 40,  radius: 40 },
  { x: t => -Math.sin(t * 0.6) * 65,  y: t => Math.sin(t * 1.1) * 45,        z: t => Math.cos(t * 0.4) * 50,  radius: 35 },
  { x: t => Math.cos(t * 0.9) * 55,   y: t => -30 + Math.sin(t * 0.5) * 35,  z: t => Math.sin(t * 0.7) * 45,  radius: 30 },
];

// Cube — flat shaded
const cubeColors = cubeMesh.triangles.map(() => [200, 80, 80]);
const cubeFaceNormals = computeFaceNormals(cubeMesh.vertices, cubeMesh.triangles);

// Checkerboard floor — flat shaded (for rasterizer only)
const floorFaceNormals = computeFaceNormals(floorMesh.vertices, floorMesh.triangles);

const sceneObjects = [
  {
    // Metaballs — vertices/triangles/normals/colors updated each frame in draw()
    vertices: [[0,0,0]], triangles: [], colors: [], vertexNormals: [], faceNormals: null,
    x: t => Math.sin(t * 0.6) * 150, y: t => -10 + Math.sin(t * 0.8) * 40, z: t => 100 + Math.sin(t * 0.4) * 200,
    rx: () => 0, ry: t => t * 0.3, rz: () => 0,
    reflectivity: 0.2,
  },
  {
    vertices: cubeMesh.vertices, triangles: cubeMesh.triangles,
    colors: cubeColors, vertexNormals: null, faceNormals: cubeFaceNormals,
    x: t => 180 + Math.sin(t * 0.5) * 120, y: t => 20 + Math.sin(t * 0.9) * 30, z: t => 300 + Math.cos(t * 0.3) * 400,
    rx: t => t * 0.5, ry: t => t * 0.7, rz: t => t * 0.3,
    reflectivity: 0.2,
  },
];

function draw(time) {
  const t = time * 0.001;

  // Regenerate metaball mesh each frame
  const balls = metaballDefs.map(b => ({ x: b.x(t), y: b.y(t), z: b.z(t), radius: b.radius }));
  const mbMesh = generateMetaballMesh(balls, METABALL_GRID_RES, METABALL_THRESHOLD);
  const mb = sceneObjects[0];
  mb.vertices = mbMesh.vertices;
  mb.triangles = mbMesh.triangles;
  mb.vertexNormals = mbMesh.normals;
  // Reuse color array if triangle count hasn't changed (same constant color every frame)
  if (!mb.colors || mb.colors.length !== mbMesh.triangles.length) {
    mb.colors = mbMesh.triangles.map(() => [180, 190, 200]);
  }

  if (renderMode === 'gpu-raytrace') {
    gpuRaytraceScene(t, sceneObjects);
  } else if (renderMode === 'raytrace') {
    raytraceScene(t, sceneObjects);
  } else {
    rotX = 0;
    rotY = t * 0.3;
    rotZ = 0;
    drawObject(mb.vertices, mb.triangles, mb.colors, 255, Math.sin(t * 0.6) * 150, -10 + Math.sin(t * 0.8) * 40, 100 + Math.sin(t * 0.4) * 200, mb.vertexNormals);

    rotX = t * 0.5;
    rotY = t * 0.7;
    rotZ = t * 0.3;
    drawObject(cubeMesh.vertices, cubeMesh.triangles, cubeColors, 255, 80 + Math.sin(t * 0.5) * 60, 20 + Math.sin(t * 0.9) * 30, 200 + Math.cos(t * 0.3) * 100, null, cubeFaceNormals);

    rotX = 0;
    rotY = 0;
    rotZ = 0;
    drawObject(floorMesh.vertices, floorMesh.triangles, floorMesh.colors, 255, 0, 0, FLOOR_Z_OFFSET, null, floorFaceNormals);
  }
}

// ── FPS counter ───────────────────────────────────────────────
const fpsEl = document.getElementById('fps');
let fpsFrames = 0;
let fpsWindowStart = 0;

function mainLoop(time) {
  if (renderMode !== 'gpu-raytrace') {
    clear();
    if (renderMode === 'rasterize') drawSkyBackground();
  }
  draw(time);
  if (renderMode !== 'gpu-raytrace') flip();

  // Update FPS display once per second
  fpsFrames++;
  if (!fpsWindowStart) fpsWindowStart = time;
  const elapsed = time - fpsWindowStart;
  if (elapsed >= 1000) {
    fpsEl.textContent = ((fpsFrames * 1000 / elapsed) | 0) + ' fps';
    fpsFrames = 0;
    fpsWindowStart = time;
  }

  requestAnimationFrame(mainLoop);
}

if (renderMode === 'gpu-raytrace') initGPU();
requestAnimationFrame(mainLoop);
