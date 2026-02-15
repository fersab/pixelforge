# From Pixels to Raytracing — A 3D Rendering Engine Built with Claude Code in Pure ES6+

## From the First Pixel to BVH-Accelerated GPU Raytracing — No Libraries, No Frameworks

🔗 [github.com/fersab/pixelforge](https://github.com/fersab/pixelforge)

This is the story of building a complete 3D rendering engine in the browser using nothing but plain JavaScript and a single `<canvas>` element. No Three.js. No WebGPU abstractions. Just math, pixels, and a progression from the simplest possible drawing primitive all the way to a GPU-accelerated raytracer with soft shadows, ambient occlusion, and Fresnel reflections.

The engine supports three rendering modes, switchable at runtime:

1. **Software Rasterizer** — scanline triangle fill with per-pixel Phong shading
2. **CPU Raytracer** — recursive raytracing with BVH acceleration
3. **GPU Raytracer** — the entire raytracing pipeline running in a WebGL2 fragment shader

All three render the same animated scene: animated metaballs (blobby shapes that merge and split organically) and a red cube floating above a checkerboard floor, lit by a directional light against a sky backdrop. The metaball mesh is regenerated every frame using marching cubes.

### Techniques & Algorithms Used

**Rendering Pipeline** — Double-buffered software framebuffer, z-buffer depth testing, alpha blending, scanline triangle rasterization, perspective projection (pinhole camera)

**Shading & Lighting** — Per-pixel Phong shading, Blinn-Phong specular highlights, smooth vertex normal interpolation (barycentric), flat face normals, Fresnel reflections (Schlick's approximation), recursive ray bouncing (3 deep), soft shadows (16 jittered samples), ambient occlusion (8 hemisphere samples), 2×2 supersampling antialiasing (togglable), shadow bias, deterministic per-pixel PRNG

**Geometry** — Marching cubes isosurface extraction, metaball scalar field evaluation (f = Σ r²/d²), Laplacian mesh smoothing with isosurface projection, analytical gradient normals, edge-based vertex deduplication, per-frame mesh regeneration, procedural mesh generation, analytical infinite floor plane, Euler rotation with cached trigonometry

**Acceleration** — Bounding Volume Hierarchy (BVH) with median split, slab method ray-AABB intersection, Möller-Trumbore ray-triangle intersection, iterative stack-based BVH traversal, any-hit early termination

**GPU Raytracing** — Full-screen triangle trick, data texture packing (RGBA32F), BVH serialization to texture, iterative reflection with weight accumulation, stratified sampling (4×4 shadow grid), GLSL constant injection, texelFetch with bit-shift indexing, 2×2 supersampling AA

**Environment** — Sky texture sampling (direction-based lookup), analytical checkerboard pattern

### Contents

1. [The Framebuffer — Putting a Pixel on Screen](#chapter-1-the-framebuffer--putting-a-pixel-on-screen)
2. [Filling Triangles — The Scanline Rasterizer](#chapter-2-filling-triangles--the-scanline-rasterizer)
3. [3D Transforms — From Model Space to Screen](#chapter-3-3d-transforms--from-model-space-to-screen)
4. [Meshes — Metaballs, Cubes, and Floors](#chapter-4-meshes--metaballs-cubes-and-floors)
5. [The Environment System](#chapter-5-the-environment-system)
6. [The CPU Raytracer](#chapter-6-the-cpu-raytracer)
7. [BVH — Making It Fast](#chapter-7-bvh--making-it-fast)
8. [The GPU Raytracer — Raytracing in a Fragment Shader](#chapter-8-the-gpu-raytracer--raytracing-in-a-fragment-shader)
9. [The Scene — Animation and Control](#chapter-9-the-scene--animation-and-control)
10. [Architecture — How It All Fits Together](#chapter-10-architecture--how-it-all-fits-together)

---

## Chapter 1: The Framebuffer — Putting a Pixel on Screen

Everything starts with a pixel.

The canvas is 800×420 pixels. Behind it sits a manual double-buffering system: a `Uint8ClampedArray` back buffer and a `Float32Array` depth buffer, both sized for every pixel on screen.

```
const backBuf = new Uint8ClampedArray(800 * 420 * 4);  // RGBA
const zBuf = new Float32Array(800 * 420);               // depth
```

The `putpixel(x, y, z, r, g, b, a)` function is the lowest-level drawing operation. It does integer conversion with bitwise OR (`x | 0`), bounds checking, depth testing against the z-buffer, and alpha blending for semi-transparent pixels. Opaque pixels claim depth; transparent ones blend over without updating the z-buffer.

Every frame, `clear()` zeros the color buffer and fills the depth buffer with `Infinity`. After all drawing is done, `flip()` copies the back buffer to the canvas with `putImageData`. This double-buffering prevents tearing — you never see a half-drawn frame.

---

## Chapter 2: Filling Triangles — The Scanline Rasterizer

A single pixel is useless without the ability to fill shapes. The rasterizer works on triangles — the universal primitive of 3D graphics.

The approach is classic **scanline fill**:

1. **`polyYBounds`** finds the vertical extent of a triangle (clamped to screen bounds)
2. **`scanlineHits`** walks each edge of the triangle, finding where a horizontal scanline crosses it. At each crossing, it interpolates not just x and z, but also the surface normal (nx, ny, nz) — this is critical for smooth shading later.
3. **`fillpoly`** iterates scanlines top-to-bottom. For each scanline, it pairs up the edge crossings left-to-right and fills the spans between them.
4. **`fillSpan`** is where the real shading happens. For each pixel in a span, it:
   - Linearly interpolates z (depth) and the surface normal across the span
   - Re-normalizes the interpolated normal (interpolation distorts length)
   - Computes **diffuse lighting**: `max(0, normal · lightDirection)`
   - Computes **Blinn-Phong specular**: calculates the half-vector between light and view directions, then raises `(normal · halfVector)` to a power of 64 for a tight specular highlight

This means every single pixel gets its own lighting calculation — not just every vertex or every triangle. The result is smooth specular highlights that slide across surfaces as objects rotate.

---

## Chapter 3: 3D Transforms — From Model Space to Screen

Mesh data is defined in local "model space" — centered at the origin. To render it on screen, each vertex goes through a pipeline:

1. **Rotation**: Euler angles (Y -> X -> Z order) using cached sin/cos values. The function `rotationCache()` computes the six trig values once per object, then `rotateVec()` applies the three rotations in sequence. This avoids redundant `Math.cos` / `Math.sin` calls for every vertex.

2. **Translation**: After rotation, vertices are offset to their world position.

3. **Perspective projection**: The classic pinhole camera formula. A vertex at world position (wx, wy, wz) projects to screen coordinates:
   ```
   screenX = (fov * wx / cz) + halfWidth
   screenY = (fov * wy / cz) + halfHeight
   ```
   where `cz` is the depth from the camera. The camera sits at z = -500, looking down the positive Z axis. Vertices behind the camera (cz <= 0) are culled.

4. **Normal rotation**: Surface normals are rotated by the same matrix as vertices. For smooth-shaded objects (like the metaballs), each vertex has its own normal. For flat-shaded objects (like the cube), each face has one normal shared by all three vertices.

`drawObject()` drives this pipeline: project all vertices, rotate their normals, attach normals to projected points as extra components `[x, y, z, nx, ny, nz]`, then call `fillpoly` for each triangle.

---

## Chapter 4: Meshes — Metaballs, Cubes, and Floors

All geometry is procedurally generated as arrays of vertices and triangle index lists.

**The Metaballs** are the scene's organic, animated centerpiece. Three blobs orbit each other in local space, merging and splitting as they move. Each frame, the scalar field `f(p) = Σ(r² / dist²)` is sampled on a 3D grid (resolution 48), and **marching cubes** extracts an isosurface as an indexed triangle mesh (~5000–10000 triangles depending on overlap). Vertices are deduplicated via an edge-based hash map, then the mesh undergoes **Laplacian smoothing with isosurface projection** — each vertex relaxes toward its neighbor average, then a Newton step along the field gradient snaps it back onto the exact isosurface (f = threshold). Two iterations eliminate grid-aligned triangle artifacts. Smooth normals are computed analytically from the field gradient `∇f = Σ -2r²(p - center) / dist⁴` — this eliminates the grid-discretization banding that plagues mesh-derived normals. The mesh is fed into the same rendering pipeline as any other object — no renderer changes needed.

**The Cube** is a subdivided cube: each face is a 3x3 grid of quads (4x4 grid of vertices), split into triangles. 56 vertices, 108 triangles. It uses flat face normals for sharp edges.

**The Floor** is a 12x12 checkerboard grid. 288 triangles. Color alternates between red and white tiles based on `(ix + iz) & 1`. For the rasterizer, it's real geometry. For the raytracers, it's an analytical plane (no triangles needed — just math).

*Note: The UV-sphere code (`sphere.js`) is still loaded for reference but not used in the active scene. It was replaced by the metaball system.*

---

## Chapter 5: The Environment System

The raytracers need to intersect rays with the floor and sample the sky — but this shouldn't be hardcoded into the ray tracing logic. The environment system provides a clean abstraction:

- **`envIntersect(ray)`** — intersect a ray with the floor plane. Returns hit distance, surface color (checkerboard pattern computed analytically from hit coordinates), surface normal (ny = -1, pointing upward toward the camera since Y increases downward in screen space), and reflectivity.

- **`envAnyHit(ray, maxDist)`** — binary occlusion test for shadows. Same ray-plane math, but returns immediately on hit without computing color.

- **`envColor(direction)`** — what color does a ray see when it misses everything? Samples the sky texture using the ray direction as a lookup coordinate. Falls back to a simple vertical gradient if the sky image hasn't loaded yet.

The sky image is loaded from a hidden `<img>` element, extracted to pixel data via an offscreen canvas (`extractSkyPixels`), and stored for both CPU sampling and GPU texture upload.

The sentinel value `ENV_OBJ_IDX = -2` marks environment hits so the raytracer can distinguish them from mesh object hits and avoid self-intersection bugs.

---

## Chapter 6: The CPU Raytracer

This is where the rendering gets physically-motivated. Instead of projecting triangles onto the screen, we shoot a ray from the camera through each pixel and simulate how light interacts with the scene.

### Ray Generation

For each pixel, compute a ray direction from the camera (at z = -500) through the pixel's position on the image plane:
```
dx = (px - halfWidth) / length
dy = (py - halfHeight) / length
dz = fov / length
```
where `length` normalizes the direction vector.

### Scene Intersection

`sceneIntersect()` finds the closest thing a ray hits. It tests every mesh object (via BVH, discussed later) and the environment, tracking the nearest hit. When a triangle is hit, the surface normal is interpolated from vertex normals using barycentric coordinates (`w = 1 - u - v`):
```
normal = w * n0 + u * n1 + v * n2
```
If the normal faces away from the ray (backface), it's flipped. This makes all triangles double-sided.

### Shading: Putting It All Together

At each hit point, the raytracer computes:

**1. Soft Shadows (16 samples)**

Hard shadows (a single shadow ray) produce unrealistic razor-sharp edges. Soft shadows simulate an area light by firing 16 rays toward the light direction, each with random jitter within a small radius (0.15 units). The shadow factor is the fraction of rays that were blocked:
```
shadow = blockedRays / 16
```
The jitter uses a deterministic PRNG (linear congruential generator) seeded per-pixel: `seed = py * WIDTH + px`. This means the noise pattern is spatially varied but temporally stable — the same pixel always gets the same shadow samples, preventing flickering. When 2×2 supersampling AA is enabled, each sub-sample gets a unique PRNG seed to decorrelate noise across the four sub-pixel rays.

**2. Ambient Occlusion (8 hemisphere samples)**

AO approximates how much a surface point is "enclosed" by nearby geometry. The raytracer fires 8 random rays into the hemisphere above the surface normal. Each ray that hits something within 40 units counts as occluded:
```
ao = occludedRays / 8
```
The hemisphere sampling generates a random unit vector in [-1,1]^3, normalizes it, then flips it to be on the same side as the surface normal.

**3. Blinn-Phong Specular**

The half-vector between the view direction and light direction:
```
h = normalize(viewDir + lightDir)
specular = lit * strength * pow(max(0, dot(normal, h)), 64)
```
The exponent of 64 gives a tight, focused specular highlight. The strength of 0.5 keeps it from overwhelming the surface color.

**4. Final Color Assembly**

Everything combines into the final pixel color:
```
brightness = min(1, ambient * aoFactor + diffuse)
color = surfaceColor * brightness + specular * white
```
where `aoFactor = 1 - ao * 0.6` darkens occluded areas, and `diffuse = (1 - shadow) * max(0, dot(normal, light))`.

### Fresnel Reflections

Reflective surfaces (metaballs have 0.2, the cube has 0.2) use **Schlick's approximation** of the Fresnel equations:
```
f1 = 1 - cosTheta
fresnel = reflectivity + (1 - reflectivity) * f1^5
```
At head-on angles, you see mostly the surface color. At glancing angles, you see mostly the reflection. This is physically accurate — it's why puddles reflect the sky when viewed at a low angle.

The reflected ray is traced recursively (up to `RT_MAX_BOUNCES` deep), and the result is blended:
```
finalColor = surfaceColor * (1 - fresnel) + reflectedColor * fresnel
```

### The Shadow Bias Problem

A classic gotcha: when you trace a shadow ray from a hit point, floating-point imprecision can cause the ray to immediately re-intersect the same surface it's sitting on, creating "shadow acne" — random dark speckles everywhere.

The fix is to offset the ray origin slightly along the surface normal before tracing shadow or AO rays:
```
biasedPosition = hitPoint + normal * 0.5
```
This tiny push (0.5 units along the normal) is enough to clear the surface without visibly shifting the shadow position.

### Supersampling Antialiasing (2×2)

Without AA, each pixel fires a single primary ray through its center, producing hard stair-step edges on silhouettes and moiré on the checkerboard floor. With 2×2 supersampling enabled, each pixel fires 4 primary rays at sub-pixel offsets (±0.25 from pixel center) and averages the results. This smooths silhouette edges, shadow boundaries, and distant checkerboard patterns.

Both the CPU and GPU raytracers share the same `RT_AA_GRID` constant (1 = off, 2 = 2×2). When AA is off, the loop runs once per pixel with zero overhead. The toggle is controlled via a checkbox in the UI and persisted in `localStorage`.

---

## Chapter 7: BVH — Making It Fast

Without acceleration, the CPU raytracer tests every ray against every triangle in every object. With metaballs (~5000–10000 triangles) and a cube (108 triangles), that's ~5000–10000 ray-triangle tests per ray, times 336,000 pixels, times 25 rays per pixel (1 primary + 16 shadow + 8 AO). That's roughly **42–84 billion** intersection tests per frame. Unacceptable.

### The Bounding Volume Hierarchy

A BVH is a binary tree where each node wraps a group of triangles in an axis-aligned bounding box (AABB). If a ray doesn't hit the box, it can skip all the triangles inside — potentially eliminating half the scene in a single test.

**Construction** (`buildBVH`):
1. Compute the centroid of each triangle
2. Find the axis-aligned bounding box of all triangles in the current set
3. If only one triangle remains, create a leaf node storing its index
4. Otherwise, find the longest axis of the bounding box (x, y, or z)
5. Sort triangles by their centroid along that axis
6. Split at the median into two halves
7. Recurse on each half

The result is a flat array of nodes:
```
{ bmin: [x,y,z], bmax: [x,y,z], left: nodeIdx, right: nodeIdx, triIdx: -1 }  // inner
{ bmin: [x,y,z], bmax: [x,y,z], left: -1, right: -1, triIdx: triangleIdx }   // leaf
```

**Traversal** uses an explicit stack (pre-allocated `Int32Array(64)` to avoid garbage collection):
```
push root onto stack
while stack is not empty:
    pop node
    if ray misses node's AABB: skip
    if leaf: test ray against triangle
    if inner: push both children
```

The `bvhTraverse()` function implements this core loop with a callback pattern. Two thin wrappers provide the actual query types:

- **`bvhClosestHit`**: the callback tracks the nearest hit, never early-exits (needs to find the absolute closest)
- **`bvhAnyHit`**: the callback returns `true` on the first hit (for shadow and AO queries — we only need to know if *anything* is in the way)

### Ray-Primitive Intersections

**Ray-Triangle** uses the **Moller-Trumbore algorithm**: compute edge vectors, then use cross products and dot products to simultaneously test if the ray intersects the triangle's plane AND if the intersection point is inside the triangle (via barycentric coordinates u, v). Returns null on miss, or `{t, u, v}` on hit. The barycentric coordinates are later used for normal interpolation.

**Ray-AABB** uses the **slab method**: for each axis, compute where the ray enters and exits the box. The ray hits the box if and only if the latest entry is before the earliest exit. Handles negative ray directions by swapping min/max when needed.

### Shared BVH — One Build, Two Consumers

The BVH is built once per object per frame in `transformMesh()` (inside `raytrace-common.js`), which also extracts the root node's AABB as the object's overall bounding box. Both the CPU and GPU raytracers consume the same pre-built `bvhNodes` array — no redundant construction.

---

## Chapter 8: The GPU Raytracer — Raytracing in a Fragment Shader

WebGL2 doesn't have compute shaders. But it does have fragment shaders — programs that run once per pixel. By drawing a single full-screen triangle and making the fragment shader do all the ray tracing, we effectively turn the GPU into a massively parallel ray tracer.

### The Full-Screen Triangle Trick

The vertex shader generates a triangle that covers the entire screen from just the vertex ID — no vertex buffer needed:
```glsl
float x = float((gl_VertexID & 1) << 2) - 1.0;
float y = float((gl_VertexID & 2) << 1) - 1.0;
gl_Position = vec4(x, y, 0.0, 1.0);
```
Three vertices produce a triangle that covers all of clip space. The fragment shader then runs for every pixel.

### Data Textures — The GPU's Memory

GPUs don't have general-purpose memory in WebGL2. The workaround is to pack all scene data into floating-point textures:

- **Vertex texture** (128×128, RGBA32F): each texel stores one vertex as `[x, y, z, 0]`
- **Triangle texture**: each texel stores vertex indices as `[i0, i1, i2, 0]`
- **Color texture**: each texel stores triangle color as `[r, g, b, 0]`
- **Normal texture**: each texel stores a normal as `[nx, ny, nz, 0]`
- **BVH texture** (256×256, RGBA32F): each BVH node takes 2 texels:
  - Texel 0: `[bmin.x, bmin.y, bmin.z, leftChildIdx or -1 for leaf]`
  - Texel 1: `[bmax.x, bmax.y, bmax.z, rightChildIdx or triIdx]`

The shader reads from these textures using `texelFetch` with computed integer indices. Bit-shifting converts a flat index to 2D texture coordinates:
```glsl
vec4 fetchTexel(sampler2D tex, int idx) {
    return texelFetch(tex, ivec2(idx & (TEX_W - 1), idx >> TEX_W_SHIFT), 0);
}
```

### The GLSL Raytracer

The fragment shader is a complete reimplementation of the CPU raytracer:

- Same Moller-Trumbore ray-triangle test
- Same slab-method AABB test
- Same BVH traversal with explicit stack (GLSL doesn't support recursion, so the stack is a fixed-size array with a 2048-iteration safety limit)
- Same soft shadows (16 samples in a 4x4 stratified jitter grid — slightly better noise distribution than the CPU version's uniform random)
- Same AO (8 stratified hemisphere samples)
- Same Fresnel reflections — but **iterative instead of recursive** (GLSL has no recursion). The loop accumulates reflected color with a weight that decreases each bounce:
  ```glsl
  accum += accumWeight * (1.0 - fresnel) * localColor;
  accumWeight *= fresnel;
  if (accumWeight < 0.01) break;  // early termination
  ```
- Same 2×2 supersampling AA (when enabled) — the `main()` function loops over a sub-pixel grid, each sample with a unique PRNG seed, and averages the results

### Constant Injection

All rendering constants (epsilon values, specular parameters, shadow sample counts, max bounce depth) are defined once in JavaScript (`raytrace-common.js`) and injected into the GLSL source via string replacement before compilation:
```javascript
fragSrc = FRAG_SRC.replace(/__RT_EPSILON__/g, toGLSLFloat(RT_EPSILON))
                  .replace(/__RT_SHADOW_BIAS__/g, toGLSLFloat(RT_SHADOW_BIAS))
                  // ...
                  .replace(/__RT_MAX_BOUNCES__/g, RT_MAX_BOUNCES.toString())
                  .replace(/__RT_AA_GRID__/g, RT_AA_GRID.toString());
```
This ensures CPU and GPU paths use identical parameters. `RT_AA_GRID` is declared as `let` (not `const`) so `main.js` can override it from the UI checkbox before the shader compiles.

### Per-Frame Upload

Every frame:
1. JavaScript builds the scene (transforms meshes, builds BVHs)
2. Packs all vertex/triangle/normal/BVH data into `Float32Array` buffers
3. Uploads to GPU textures via `texSubImage2D`
4. Sets all uniforms (camera, lighting, per-object offsets, environment parameters)
5. Calls `gl.drawArrays(gl.TRIANGLES, 0, 3)` — one draw call for the full-screen triangle

The GPU then processes all 336,000 pixels in parallel.

---

## Chapter 9: The Scene — Animation and Control

The scene is defined declaratively in `main.js`. Each object specifies its geometry, shading data, and animation as functions of time:

```javascript
const sceneObjects = [
  {
    // Metaballs — vertices/triangles/normals/colors updated each frame
    vertices: [[0,0,0]], triangles: [], colors: [], vertexNormals: [], faceNormals: null,
    x: t => Math.sin(t * 0.6) * 150,       // orbiting motion
    y: t => -10 + Math.sin(t * 0.8) * 40,   // bobbing
    z: t => 100 + Math.sin(t * 0.4) * 200,  // depth oscillation
    rx: () => 0, ry: t => t * 0.3, rz: () => 0,  // slow Y spin
    reflectivity: 0.2,
  },
  {
    vertices: cubeMesh.vertices, triangles: cubeMesh.triangles,
    colors: cubeColors, vertexNormals: null, faceNormals: cubeFaceNormals,
    x: t => 180 + Math.sin(t * 0.5) * 120,
    y: t => 20 + Math.sin(t * 0.9) * 30,
    z: t => 300 + Math.cos(t * 0.3) * 400,
    rx: t => t * 0.5, ry: t => t * 0.7, rz: t => t * 0.3,  // tumbling
    reflectivity: 0.2,
  },
];
```

The metaball entry starts with placeholder geometry — its vertices, triangles, normals, and colors are regenerated every frame in the `draw()` function. Three metaball centers orbit in local space with wide enough amplitudes that the blobs visibly separate and merge:

```javascript
const metaballDefs = [
  { x: t => Math.sin(t) * 70,         y: t => Math.cos(t * 0.7) * 50,        z: t => ..., radius: 40 },
  { x: t => -Math.sin(t * 0.6) * 65,  y: t => Math.sin(t * 1.1) * 45,        z: t => ..., radius: 35 },
  { x: t => Math.cos(t * 0.9) * 55,   y: t => -30 + Math.sin(t * 0.5) * 35,  z: t => ..., radius: 30 },
];
```

Each frame, `generateMetaballMesh()` produces the mesh with analytical gradient normals, and the color array is cached (it's the same constant color every frame, so it's only reallocated when the triangle count changes).

Position and rotation are functions of time `t` (seconds), creating smooth sinusoidal animation. The `requestAnimationFrame` loop drives rendering.

Mode switching is handled by radio buttons, and a checkbox toggles 2×2 supersampling AA (off by default). Clicking "Apply" saves both the render mode and AA state to `localStorage` and reloads the page — necessary because the GPU shader's AA grid size is baked in at compile time. The GPU mode replaces the 2D canvas with a WebGL2 canvas at initialization.

---

## Chapter 10: Architecture — How It All Fits Together

The codebase is 14 JavaScript files loaded in a specific dependency order:

```
primitives.js          -> Canvas, framebuffer, pixel ops, vector utilities (cross, normalize)
  software-render.js   -> 3D transforms, normal computation, rasterization bridge
    sphere.js          -> Procedural sphere mesh (362 verts, 720 tris) — loaded but unused
    metaball.js        -> Marching cubes metaball mesh generator + smoothing
    cube.js            -> Procedural cube mesh (56 verts, 108 tris)
    floor.js           -> Procedural checkerboard (288 tris + constants)
      environment.js   -> Floor plane + sky abstraction for raytracers
        render-common.js    -> Sky image loading and background blitting
          raytrace-common.js -> All shared constants (RT_*, metaball grid), world-space transforms
            bvh.js           -> All ray-intersection and BVH code (shared)
              shader-source.js  -> GLSL vertex + fragment shader strings
                raytrace.js     -> CPU raytracer (shadows, AO, reflection)
                  gpu-raytrace.js -> WebGL2 setup, texture packing, render
                    main.js       -> Scene definition, animation loop, mode switching
```

Each file has a single clear responsibility. Shared code lives as high up the chain as possible:

- **`primitives.js`**: `cross()`, `normalize()`, camera/lighting globals, rotation state
- **`metaball.js`**: marching cubes field evaluation, mesh extraction, vertex deduplication, Laplacian smoothing with isosurface projection, analytical gradient normals — self-contained, no project dependencies
- **`bvh.js`**: all ray-intersection math and BVH construction/traversal — the single source of truth for both CPU and GPU paths
- **`raytrace-common.js`**: all rendering constants (shadow, AO, specular, bounce depth, AA grid, metaball grid), mesh transformation — consumed by all three renderers
- **`environment.js`**: floor and sky abstraction — no raytracing code knows what's in the environment

---

## The Techniques, Summarized

| Technique | Where | What It Does |
|-----------|-------|-------------|
| Double-buffered framebuffer | primitives.js | Tear-free rendering |
| Z-buffer depth testing | primitives.js | Correct occlusion |
| Alpha blending | primitives.js | Transparency support |
| Scanline triangle rasterization | primitives.js | Fill triangles on screen |
| Per-pixel Phong shading | primitives.js | Smooth lighting in rasterizer |
| Blinn-Phong specular | primitives.js, raytrace.js, shader | Shiny highlights |
| Euler rotation with cached trig | software-render.js | Efficient 3D transforms |
| Perspective projection | software-render.js | 3D to 2D |
| Smooth vertex normals | software-render.js | Smooth shading on curved surfaces |
| Flat face normals | software-render.js | Sharp cube edges |
| Metaball field evaluation | metaball.js | Scalar field f(p) = Σ(r²/dist²) |
| Marching cubes mesh extraction | metaball.js | Isosurface triangulation from scalar field |
| Edge-based vertex deduplication | metaball.js | Indexed mesh from marching cubes |
| Analytical gradient normals | metaball.js | Smooth normals from field ∇f, eliminates grid banding |
| Laplacian smoothing + isosurface projection | metaball.js | Eliminates grid-aligned artifacts, Newton step along ∇f |
| Per-frame mesh regeneration | main.js | Dynamic metaball animation (METABALL_GRID_RES³ cells/frame) |
| UV-sphere generation | sphere.js | Procedural sphere mesh (unused, kept for reference) |
| Subdivided cube generation | cube.js | Procedural cube mesh |
| Checkerboard floor generation | floor.js | Procedural ground plane |
| Analytical floor plane | environment.js | Infinite-resolution floor for raytracer |
| Sky texture sampling | environment.js, render-common.js | HDR-like environment lighting |
| Moller-Trumbore intersection | bvh.js | Fast ray-triangle test |
| Slab method AABB intersection | bvh.js | Fast ray-box test |
| BVH construction (median split) | bvh.js | Spatial acceleration structure |
| Iterative BVH traversal | bvh.js | Stack-based tree walk |
| Any-hit early termination | bvh.js | Fast shadow/occlusion queries |
| Soft shadows (16 jittered samples) | raytrace.js, shader | Realistic penumbras |
| Ambient occlusion (8 hemisphere samples) | raytrace.js, shader | Contact shadows and crevice darkening |
| Fresnel reflection (Schlick) | raytrace.js, shader | Angle-dependent reflectivity |
| Recursive ray bouncing (RT_MAX_BOUNCES deep) | raytrace.js, shader | Mirror reflections |
| Shadow bias | raytrace.js, shader | Prevent self-intersection artifacts |
| Deterministic per-pixel PRNG | raytrace.js, shader | Stable noise for stochastic sampling |
| 2×2 supersampling AA | raytrace.js, shader | Sub-pixel averaging for smooth edges (togglable) |
| Full-screen triangle trick | shader-source.js | GPU pixel-parallel execution |
| Data texture packing (RGBA32F) | gpu-raytrace.js | Scene data on GPU without compute shaders |
| BVH texture serialization | gpu-raytrace.js | Acceleration structure on GPU |
| GLSL constant injection | gpu-raytrace.js | Shared constants across CPU/GPU (all RT_* values) |
| Iterative reflection (weight accumulation) | shader-source.js | Reflection without recursion on GPU |
| Stratified sampling (shadows + AO) | shader-source.js | Lower-variance noise on GPU |
| Declarative animated scene | main.js | Position/rotation as functions of time |

---

## What We Built

Starting from a single `putpixel` call and an empty canvas, we built:

- A **software 3D rasterizer** with z-buffering, scanline fill, and per-pixel Phong shading
- A **CPU raytracer** with physically-motivated lighting: soft shadows, ambient occlusion, and Fresnel reflections
- A **GPU raytracer** that reimplements the full pipeline in GLSL, running on the GPU at real-time framerates
- A **BVH acceleration structure** shared between both raytracers, reducing intersection complexity from O(n) to O(log n)
- A clean **modular architecture** where each file owns a single responsibility and both rendering backends share construction, constants, and intersection code

All in ~2900 lines of vanilla JavaScript — no build system, no bundler, no dependencies. Just `<script>` tags and math.
