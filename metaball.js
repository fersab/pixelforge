// @ts-check

// ── Metaball System ──────────────────────────────────────────────
// Evaluates an implicit field from multiple spherical charges,
// then extracts a triangle mesh via marching cubes.
// Output: { vertices: [[x,y,z],...], triangles: [[i,j,k],...], normals: [[nx,ny,nz],...] }

// ── Marching Cubes Lookup Tables ─────────────────────────────────
// EDGE_TABLE[cubeIndex] = bitmask of which of the 12 edges are crossed
const EDGE_TABLE = [
  0x000,0x109,0x203,0x30a,0x406,0x50f,0x605,0x70c,0x80c,0x905,0xa0f,0xb06,0xc0a,0xd03,0xe09,0xf00,
  0x190,0x099,0x393,0x29a,0x596,0x49f,0x795,0x69c,0x99c,0x895,0xb9f,0xa96,0xd9a,0xc93,0xf99,0xe90,
  0x230,0x339,0x033,0x13a,0x636,0x73f,0x435,0x53c,0xa3c,0xb35,0x83f,0x936,0xe3a,0xf33,0xc39,0xd30,
  0x3a0,0x2a9,0x1a3,0x0aa,0x7a6,0x6af,0x5a5,0x4ac,0xbac,0xaa5,0x9af,0x8a6,0xfaa,0xea3,0xda9,0xca0,
  0x460,0x569,0x663,0x76a,0x066,0x16f,0x265,0x36c,0xc6c,0xd65,0xe6f,0xf66,0x86a,0x963,0xa69,0xb60,
  0x5f0,0x4f9,0x7f3,0x6fa,0x1f6,0x0ff,0x3f5,0x2fc,0xdfc,0xcf5,0xfff,0xef6,0x9fa,0x8f3,0xbf9,0xaf0,
  0x650,0x759,0x453,0x55a,0x256,0x35f,0x055,0x15c,0xe5c,0xf55,0xc5f,0xd56,0xa5a,0xb53,0x859,0x950,
  0x7c0,0x6c9,0x5c3,0x4ca,0x3c6,0x2cf,0x1c5,0x0cc,0xfcc,0xec5,0xdcf,0xcc6,0xbca,0xac3,0x9c9,0x8c0,
  0x8c0,0x9c9,0xac3,0xbca,0xcc6,0xdcf,0xec5,0xfcc,0x0cc,0x1c5,0x2cf,0x3c6,0x4ca,0x5c3,0x6c9,0x7c0,
  0x950,0x859,0xb53,0xa5a,0xd56,0xc5f,0xf55,0xe5c,0x15c,0x055,0x35f,0x256,0x55a,0x453,0x759,0x650,
  0xaf0,0xbf9,0x8f3,0x9fa,0xef6,0xfff,0xcf5,0xdfc,0x2fc,0x3f5,0x0ff,0x1f6,0x6fa,0x7f3,0x4f9,0x5f0,
  0xb60,0xa69,0x963,0x86a,0xf66,0xe6f,0xd65,0xc6c,0x36c,0x265,0x16f,0x066,0x76a,0x663,0x569,0x460,
  0xca0,0xda9,0xea3,0xfaa,0x8a6,0x9af,0xaa5,0xbac,0x4ac,0x5a5,0x6af,0x7a6,0x0aa,0x1a3,0x2a9,0x3a0,
  0xd30,0xc39,0xf33,0xe3a,0x936,0x83f,0xb35,0xa3c,0x53c,0x435,0x73f,0x636,0x13a,0x033,0x339,0x230,
  0xe90,0xf99,0xc93,0xd9a,0xa96,0xb9f,0x895,0x99c,0x69c,0x795,0x49f,0x596,0x29a,0x393,0x099,0x190,
  0xf00,0xe09,0xd03,0xc0a,0xb06,0xa0f,0x905,0x80c,0x70c,0x605,0x50f,0x406,0x30a,0x203,0x109,0x000
];

// TRI_TABLE[cubeIndex] = list of edge indices forming triangles (up to 5 tris, -1 terminated)
const TRI_TABLE = [
  [-1],
  [0,8,3,-1],
  [0,1,9,-1],
  [1,8,3,9,8,1,-1],
  [1,2,10,-1],
  [0,8,3,1,2,10,-1],
  [9,2,10,0,2,9,-1],
  [2,8,3,2,10,8,10,9,8,-1],
  [3,11,2,-1],
  [0,11,2,8,11,0,-1],
  [1,9,0,2,3,11,-1],
  [1,11,2,1,9,11,9,8,11,-1],
  [3,10,1,11,10,3,-1],
  [0,10,1,0,8,10,8,11,10,-1],
  [3,9,0,3,11,9,11,10,9,-1],
  [9,8,10,10,8,11,-1],
  [4,7,8,-1],
  [4,3,0,7,3,4,-1],
  [0,1,9,8,4,7,-1],
  [4,1,9,4,7,1,7,3,1,-1],
  [1,2,10,8,4,7,-1],
  [3,4,7,3,0,4,1,2,10,-1],
  [9,2,10,9,0,2,8,4,7,-1],
  [2,10,9,2,9,7,2,7,3,7,9,4,-1],
  [8,4,7,3,11,2,-1],
  [11,4,7,11,2,4,2,0,4,-1],
  [9,0,1,8,4,7,2,3,11,-1],
  [4,7,11,9,4,11,9,11,2,9,2,1,-1],
  [3,10,1,3,11,10,7,8,4,-1],
  [1,11,10,1,4,11,1,0,4,7,11,4,-1],
  [4,7,8,9,0,11,9,11,10,11,0,3,-1],
  [4,7,11,4,11,9,9,11,10,-1],
  [9,5,4,-1],
  [9,5,4,0,8,3,-1],
  [0,5,4,1,5,0,-1],
  [8,5,4,8,3,5,3,1,5,-1],
  [1,2,10,9,5,4,-1],
  [3,0,8,1,2,10,4,9,5,-1],
  [5,2,10,5,4,2,4,0,2,-1],
  [2,10,5,3,2,5,3,5,4,3,4,8,-1],
  [9,5,4,2,3,11,-1],
  [0,11,2,0,8,11,4,9,5,-1],
  [0,5,4,0,1,5,2,3,11,-1],
  [2,1,5,2,5,8,2,8,11,4,8,5,-1],
  [10,3,11,10,1,3,9,5,4,-1],
  [4,9,5,0,8,1,8,10,1,8,11,10,-1],
  [5,4,0,5,0,11,5,11,10,11,0,3,-1],
  [5,4,8,5,8,10,10,8,11,-1],
  [9,7,8,5,7,9,-1],
  [9,3,0,9,5,3,5,7,3,-1],
  [0,7,8,0,1,7,1,5,7,-1],
  [1,5,3,3,5,7,-1],
  [9,7,8,9,5,7,10,1,2,-1],
  [10,1,2,9,5,0,5,3,0,5,7,3,-1],
  [8,0,2,8,2,5,8,5,7,10,5,2,-1],
  [2,10,5,2,5,3,3,5,7,-1],
  [7,9,5,7,8,9,3,11,2,-1],
  [9,5,7,9,7,2,9,2,0,2,7,11,-1],
  [2,3,11,0,1,8,1,7,8,1,5,7,-1],
  [11,2,1,11,1,7,7,1,5,-1],
  [9,5,8,8,5,7,10,1,3,10,3,11,-1],
  [5,7,0,5,0,9,7,11,0,1,0,10,11,10,0,-1],
  [11,10,0,11,0,3,10,5,0,8,0,7,5,7,0,-1],
  [11,10,5,7,11,5,-1],
  [10,6,5,-1],
  [0,8,3,5,10,6,-1],
  [9,0,1,5,10,6,-1],
  [1,8,3,1,9,8,5,10,6,-1],
  [1,6,5,2,6,1,-1],
  [1,6,5,1,2,6,3,0,8,-1],
  [9,6,5,9,0,6,0,2,6,-1],
  [5,9,8,5,8,2,5,2,6,3,2,8,-1],
  [2,3,11,10,6,5,-1],
  [11,0,8,11,2,0,10,6,5,-1],
  [0,1,9,2,3,11,5,10,6,-1],
  [5,10,6,1,9,2,9,11,2,9,8,11,-1],
  [6,3,11,6,5,3,5,1,3,-1],
  [0,8,11,0,11,5,0,5,1,5,11,6,-1],
  [3,11,6,0,3,6,0,6,5,0,5,9,-1],
  [6,5,9,6,9,11,11,9,8,-1],
  [5,10,6,4,7,8,-1],
  [4,3,0,4,7,3,6,5,10,-1],
  [1,9,0,5,10,6,8,4,7,-1],
  [10,6,5,1,9,7,1,7,3,7,9,4,-1],
  [6,1,2,6,5,1,4,7,8,-1],
  [1,2,5,5,2,6,3,0,4,3,4,7,-1],
  [8,4,7,9,0,5,0,6,5,0,2,6,-1],
  [7,3,9,7,9,4,3,2,9,5,9,6,2,6,9,-1],
  [3,11,2,7,8,4,10,6,5,-1],
  [5,10,6,4,7,2,4,2,0,2,7,11,-1],
  [0,1,9,4,7,8,2,3,11,5,10,6,-1],
  [9,2,1,9,11,2,9,4,11,7,11,4,5,10,6,-1],
  [8,4,7,3,11,5,3,5,1,5,11,6,-1],
  [5,1,11,5,11,6,1,0,11,7,11,4,0,4,11,-1],
  [0,5,9,0,6,5,0,3,6,11,6,3,8,4,7,-1],
  [6,5,9,6,9,11,4,7,9,7,11,9,-1],
  [10,4,9,6,4,10,-1],
  [4,10,6,4,9,10,0,8,3,-1],
  [10,0,1,10,6,0,6,4,0,-1],
  [8,3,1,8,1,6,8,6,4,6,1,10,-1],
  [1,4,9,1,2,4,2,6,4,-1],
  [3,0,8,1,2,9,2,4,9,2,6,4,-1],
  [0,2,4,4,2,6,-1],
  [8,3,2,8,2,4,4,2,6,-1],
  [10,4,9,10,6,4,11,2,3,-1],
  [0,8,2,2,8,11,4,9,10,4,10,6,-1],
  [3,11,2,0,1,6,0,6,4,6,1,10,-1],
  [6,4,1,6,1,10,4,8,1,2,1,11,8,11,1,-1],
  [9,6,4,9,3,6,9,1,3,11,6,3,-1],
  [8,11,1,8,1,0,11,6,1,9,1,4,6,4,1,-1],
  [3,11,6,3,6,0,0,6,4,-1],
  [6,4,8,11,6,8,-1],
  [7,10,6,7,8,10,8,9,10,-1],
  [0,7,3,0,10,7,0,9,10,6,7,10,-1],
  [10,6,7,1,10,7,1,7,8,1,8,0,-1],
  [10,6,7,10,7,1,1,7,3,-1],
  [1,2,6,1,6,8,1,8,9,8,6,7,-1],
  [2,6,9,2,9,1,6,7,9,0,9,3,7,3,9,-1],
  [7,8,0,7,0,6,6,0,2,-1],
  [7,3,2,6,7,2,-1],
  [2,3,11,10,6,8,10,8,9,8,6,7,-1],
  [2,0,7,2,7,11,0,9,7,6,7,10,9,10,7,-1],
  [1,8,0,1,7,8,1,10,7,6,7,10,2,3,11,-1],
  [11,2,1,11,1,7,10,6,1,6,7,1,-1],
  [8,9,6,8,6,7,9,1,6,11,6,3,1,3,6,-1],
  [0,9,1,11,6,7,-1],
  [7,8,0,7,0,6,3,11,0,11,6,0,-1],
  [7,11,6,-1],
  [7,6,11,-1],
  [3,0,8,11,7,6,-1],
  [0,1,9,11,7,6,-1],
  [8,1,9,8,3,1,11,7,6,-1],
  [10,1,2,6,11,7,-1],
  [1,2,10,3,0,8,6,11,7,-1],
  [2,9,0,2,10,9,6,11,7,-1],
  [6,11,7,2,10,3,10,8,3,10,9,8,-1],
  [7,2,3,6,2,7,-1],
  [7,0,8,7,6,0,6,2,0,-1],
  [2,7,6,2,3,7,0,1,9,-1],
  [1,6,2,1,8,6,1,9,8,8,7,6,-1],
  [10,7,6,10,1,7,1,3,7,-1],
  [10,7,6,1,7,10,1,8,7,1,0,8,-1],
  [0,3,7,0,7,10,0,10,9,6,10,7,-1],
  [7,6,10,7,10,8,8,10,9,-1],
  [6,8,4,11,8,6,-1],
  [3,6,11,3,0,6,0,4,6,-1],
  [8,6,11,8,4,6,9,0,1,-1],
  [9,4,6,9,6,3,9,3,1,11,3,6,-1],
  [6,8,4,6,11,8,2,10,1,-1],
  [1,2,10,3,0,11,0,6,11,0,4,6,-1],
  [4,11,8,4,6,11,0,2,9,2,10,9,-1],
  [10,9,3,10,3,2,9,4,3,11,3,6,4,6,3,-1],
  [8,2,3,8,4,2,4,6,2,-1],
  [0,4,2,4,6,2,-1],
  [1,9,0,2,3,4,2,4,6,4,3,8,-1],
  [1,9,4,1,4,2,2,4,6,-1],
  [8,1,3,8,6,1,8,4,6,6,10,1,-1],
  [10,1,0,10,0,6,6,0,4,-1],
  [4,6,3,4,3,8,6,10,3,0,3,9,10,9,3,-1],
  [10,9,4,6,10,4,-1],
  [4,9,5,7,6,11,-1],
  [0,8,3,4,9,5,11,7,6,-1],
  [5,0,1,5,4,0,7,6,11,-1],
  [11,7,6,8,3,4,3,5,4,3,1,5,-1],
  [9,5,4,10,1,2,7,6,11,-1],
  [6,11,7,1,2,10,0,8,3,4,9,5,-1],
  [7,6,11,5,4,10,4,2,10,4,0,2,-1],
  [3,4,8,3,5,4,3,2,5,10,5,2,11,7,6,-1],
  [7,2,3,7,6,2,5,4,9,-1],
  [9,5,4,0,8,6,0,6,2,6,8,7,-1],
  [3,6,2,3,7,6,1,5,0,5,4,0,-1],
  [6,2,8,6,8,7,2,1,8,4,8,5,1,5,8,-1],
  [9,5,4,10,1,6,1,7,6,1,3,7,-1],
  [1,6,10,1,7,6,1,0,7,8,7,0,9,5,4,-1],
  [4,0,10,4,10,5,0,3,10,6,10,7,3,7,10,-1],
  [7,6,10,7,10,8,5,4,10,4,8,10,-1],
  [6,9,5,6,11,9,11,8,9,-1],
  [3,6,11,0,6,3,0,5,6,0,9,5,-1],
  [0,11,8,0,5,11,0,1,5,5,6,11,-1],
  [6,11,3,6,3,5,5,3,1,-1],
  [1,2,10,9,5,11,9,11,8,11,5,6,-1],
  [0,11,3,0,6,11,0,9,6,5,6,9,1,2,10,-1],
  [11,8,5,11,5,6,8,0,5,10,5,2,0,2,5,-1],
  [6,11,3,6,3,5,2,10,3,10,5,3,-1],
  [5,8,9,5,2,8,5,6,2,3,8,2,-1],
  [9,5,6,9,6,0,0,6,2,-1],
  [1,5,8,1,8,0,5,6,8,3,8,2,6,2,8,-1],
  [1,5,6,2,1,6,-1],
  [1,3,6,1,6,10,3,8,6,5,6,9,8,9,6,-1],
  [10,1,0,10,0,6,9,5,0,5,6,0,-1],
  [0,3,8,5,6,10,-1],
  [10,5,6,-1],
  [11,5,10,7,5,11,-1],
  [11,5,10,11,7,5,8,3,0,-1],
  [5,11,7,5,10,11,1,9,0,-1],
  [10,7,5,10,11,7,9,8,1,8,3,1,-1],
  [11,1,2,11,7,1,7,5,1,-1],
  [0,8,3,1,2,7,1,7,5,7,2,11,-1],
  [9,7,5,9,2,7,9,0,2,2,11,7,-1],
  [7,5,2,7,2,11,5,9,2,3,2,8,9,8,2,-1],
  [2,5,10,2,3,5,3,7,5,-1],
  [8,2,0,8,5,2,8,7,5,10,2,5,-1],
  [9,0,1,5,10,3,5,3,7,3,10,2,-1],
  [9,8,2,9,2,1,8,7,2,10,2,5,7,5,2,-1],
  [1,3,5,3,7,5,-1],
  [0,8,7,0,7,1,1,7,5,-1],
  [9,0,3,9,3,5,5,3,7,-1],
  [9,8,7,5,9,7,-1],
  [5,8,4,5,10,8,10,11,8,-1],
  [5,0,4,5,11,0,5,10,11,11,3,0,-1],
  [0,1,9,8,4,10,8,10,11,10,4,5,-1],
  [10,11,4,10,4,5,11,3,4,9,4,1,3,1,4,-1],
  [2,5,1,2,8,5,2,11,8,4,5,8,-1],
  [0,4,11,0,11,3,4,5,11,2,11,1,5,1,11,-1],
  [0,2,5,0,5,9,2,11,5,4,5,8,11,8,5,-1],
  [9,4,5,2,11,3,-1],
  [2,5,10,3,5,2,3,4,5,3,8,4,-1],
  [5,10,2,5,2,4,4,2,0,-1],
  [3,10,2,3,5,10,3,8,5,4,5,8,0,1,9,-1],
  [5,10,2,5,2,4,1,9,2,9,4,2,-1],
  [8,4,5,8,5,3,3,5,1,-1],
  [0,4,5,1,0,5,-1],
  [8,4,5,8,5,3,9,0,5,0,3,5,-1],
  [9,4,5,-1],
  [4,11,7,4,9,11,9,10,11,-1],
  [0,8,3,4,9,7,9,11,7,9,10,11,-1],
  [1,10,11,1,11,4,1,4,0,7,4,11,-1],
  [3,1,4,3,4,8,1,10,4,7,4,11,10,11,4,-1],
  [4,11,7,9,11,4,9,2,11,9,1,2,-1],
  [9,7,4,9,11,7,9,1,11,2,11,1,0,8,3,-1],
  [11,7,4,11,4,2,2,4,0,-1],
  [11,7,4,11,4,2,8,3,4,3,2,4,-1],
  [2,9,10,2,7,9,2,3,7,7,4,9,-1],
  [9,10,7,9,7,4,10,2,7,8,7,0,2,0,7,-1],
  [3,7,10,3,10,2,7,4,10,1,10,0,4,0,10,-1],
  [1,10,2,8,7,4,-1],
  [4,9,1,4,1,7,7,1,3,-1],
  [4,9,1,4,1,7,0,8,1,8,7,1,-1],
  [4,0,3,7,4,3,-1],
  [4,8,7,-1],
  [9,10,8,10,11,8,-1],
  [3,0,9,3,9,11,11,9,10,-1],
  [0,1,10,0,10,8,8,10,11,-1],
  [3,1,10,11,3,10,-1],
  [1,2,11,1,11,9,9,11,8,-1],
  [3,0,9,3,9,11,1,2,9,2,11,9,-1],
  [0,2,11,8,0,11,-1],
  [3,2,11,-1],
  [2,3,8,2,8,10,10,8,9,-1],
  [9,10,2,0,9,2,-1],
  [2,3,8,2,8,10,0,1,8,1,10,8,-1],
  [1,10,2,-1],
  [1,3,8,9,1,8,-1],
  [0,9,1,-1],
  [0,3,8,-1],
  [-1]
];

// ── Edge vertex indices: which two corners each of the 12 edges connects ──
const EDGE_CORNERS = [
  [0,1],[1,2],[2,3],[3,0], // bottom face edges (y=0)
  [4,5],[5,6],[6,7],[7,4], // top face edges (y=1)
  [0,4],[1,5],[2,6],[3,7]  // vertical edges
];

// Corner offsets in (x,y,z) for the 8 corners of a unit cube
const CORNER_OFFSETS = [
  [0,0,0],[1,0,0],[1,0,1],[0,0,1],
  [0,1,0],[1,1,0],[1,1,1],[0,1,1]
];

// ── Field Evaluation ─────────────────────────────────────────────

/** Sample the scalar field f(p) = Σ(r² / dist²) on a 3D grid. */
function evaluateField(balls, gridMin, cellSize, res) {
  const n = res + 1; // number of grid points per axis
  const field = new Float32Array(n * n * n);
  for (let iz = 0; iz < n; iz++) {
    const pz = gridMin[2] + iz * cellSize;
    for (let iy = 0; iy < n; iy++) {
      const py = gridMin[1] + iy * cellSize;
      for (let ix = 0; ix < n; ix++) {
        const px = gridMin[0] + ix * cellSize;
        let val = 0;
        for (let b = 0; b < balls.length; b++) {
          const dx = px - balls[b].x;
          const dy = py - balls[b].y;
          const dz = pz - balls[b].z;
          const dist2 = dx * dx + dy * dy + dz * dz;
          const r = balls[b].radius;
          val += (r * r) / (dist2 + 0.0001); // tiny epsilon to avoid div/0
        }
        field[(iz * n + iy) * n + ix] = val;
      }
    }
  }
  return field;
}

// ── Marching Cubes ───────────────────────────────────────────────

/** Interpolate vertex position along an edge between two field corners. */
function mcInterpolate(p1, p2, v1, v2, threshold) {
  if (Math.abs(v1 - threshold) < 0.00001) return p1;
  if (Math.abs(v2 - threshold) < 0.00001) return p2;
  if (Math.abs(v1 - v2) < 0.00001) return p1;
  const mu = (threshold - v1) / (v2 - v1);
  return [
    p1[0] + mu * (p2[0] - p1[0]),
    p1[1] + mu * (p2[1] - p1[1]),
    p1[2] + mu * (p2[2] - p1[2])
  ];
}

/** Classify one grid cell: find edge crossings and emit triangles. */
function processCell(ix, iy, iz, field, n, gridMin, cellSize, threshold, vertices, triangles, edgeVertexMap) {
  // Sample field at 8 corners, build cube index
  const cornerVals = [];
  const cornerPos = [];
  let cubeIndex = 0;
  for (let c = 0; c < 8; c++) {
    const cx = ix + CORNER_OFFSETS[c][0];
    const cy = iy + CORNER_OFFSETS[c][1];
    const cz = iz + CORNER_OFFSETS[c][2];
    cornerVals[c] = field[(cz * n + cy) * n + cx];
    cornerPos[c] = [
      gridMin[0] + cx * cellSize,
      gridMin[1] + cy * cellSize,
      gridMin[2] + cz * cellSize
    ];
    if (cornerVals[c] >= threshold) cubeIndex |= (1 << c);
  }

  const edges = EDGE_TABLE[cubeIndex];
  if (edges === 0) return;

  // For each crossed edge, compute or reuse the interpolated vertex
  const edgeVerts = new Array(12);
  for (let e = 0; e < 12; e++) {
    if (!(edges & (1 << e))) continue;
    const [c1, c2] = EDGE_CORNERS[e];
    const g1x = ix + CORNER_OFFSETS[c1][0], g1y = iy + CORNER_OFFSETS[c1][1], g1z = iz + CORNER_OFFSETS[c1][2];
    const g2x = ix + CORNER_OFFSETS[c2][0], g2y = iy + CORNER_OFFSETS[c2][1], g2z = iz + CORNER_OFFSETS[c2][2];
    // Unique edge key (consistent ordering)
    const a = (g1z * n + g1y) * n + g1x;
    const b = (g2z * n + g2y) * n + g2x;
    const key = a < b ? a * n * n * n + b : b * n * n * n + a;
    if (edgeVertexMap.has(key)) {
      edgeVerts[e] = edgeVertexMap.get(key);
    } else {
      const pos = mcInterpolate(cornerPos[c1], cornerPos[c2], cornerVals[c1], cornerVals[c2], threshold);
      const idx = vertices.length;
      vertices.push(pos);
      edgeVertexMap.set(key, idx);
      edgeVerts[e] = idx;
    }
  }

  // Emit triangles from lookup table
  const triList = TRI_TABLE[cubeIndex];
  for (let t = 0; t < triList.length; t += 3) {
    if (triList[t] === -1) break;
    triangles.push([edgeVerts[triList[t]], edgeVerts[triList[t+1]], edgeVerts[triList[t+2]]]);
  }
}

/** Extract an indexed triangle mesh from a scalar field using marching cubes. */
function marchingCubes(field, res, gridMin, cellSize, threshold) {
  const n = res + 1;
  const vertices = [];
  const triangles = [];
  const edgeVertexMap = new Map();

  for (let iz = 0; iz < res; iz++)
    for (let iy = 0; iy < res; iy++)
      for (let ix = 0; ix < res; ix++)
        processCell(ix, iy, iz, field, n, gridMin, cellSize, threshold, vertices, triangles, edgeVertexMap);

  return { vertices, triangles };
}

// ── Mesh Smoothing ──────────────────────────────────────────────

/** Evaluate the metaball field value and gradient at a point in a single pass. */
function evalFieldAndGradient(px, py, pz, balls) {
  let val = 0, gx = 0, gy = 0, gz = 0;
  for (let b = 0; b < balls.length; b++) {
    const dx = px - balls[b].x;
    const dy = py - balls[b].y;
    const dz = pz - balls[b].z;
    const dist2 = dx * dx + dy * dy + dz * dz + 0.0001;
    const r2 = balls[b].radius * balls[b].radius;
    val += r2 / dist2;
    const factor = -2.0 * r2 / (dist2 * dist2);
    gx += factor * dx;
    gy += factor * dy;
    gz += factor * dz;
  }
  return { val, gx, gy, gz };
}

/**
 * Laplacian smooth + isosurface projection.
 * Relaxes vertices toward neighbor average, then projects back onto the isosurface
 * along the field gradient. This eliminates grid-aligned triangle artifacts.
 */
function smoothMesh(vertices, triangles, balls, threshold, iterations) {
  // Build adjacency: for each vertex, which other vertices are neighbors
  const neighborSets = new Array(vertices.length);
  for (let i = 0; i < vertices.length; i++) neighborSets[i] = new Set();
  for (let i = 0; i < triangles.length; i++) {
    const tri = triangles[i];
    neighborSets[tri[0]].add(tri[1]); neighborSets[tri[0]].add(tri[2]);
    neighborSets[tri[1]].add(tri[0]); neighborSets[tri[1]].add(tri[2]);
    neighborSets[tri[2]].add(tri[0]); neighborSets[tri[2]].add(tri[1]);
  }

  for (let iter = 0; iter < iterations; iter++) {
    // Laplacian relaxation: move each vertex toward neighbor centroid
    for (let i = 0; i < vertices.length; i++) {
      const neighbors = neighborSets[i];
      if (neighbors.size === 0) continue;
      let ax = 0, ay = 0, az = 0;
      for (const ni of neighbors) {
        ax += vertices[ni][0];
        ay += vertices[ni][1];
        az += vertices[ni][2];
      }
      const n = neighbors.size;
      // Blend 50% toward neighbor average
      vertices[i] = [
        vertices[i][0] * 0.5 + (ax / n) * 0.5,
        vertices[i][1] * 0.5 + (ay / n) * 0.5,
        vertices[i][2] * 0.5 + (az / n) * 0.5,
      ];
    }

    // Project back onto isosurface along gradient (Newton step)
    for (let i = 0; i < vertices.length; i++) {
      const p = vertices[i];
      const fg = evalFieldAndGradient(p[0], p[1], p[2], balls);
      const gmag2 = fg.gx * fg.gx + fg.gy * fg.gy + fg.gz * fg.gz;
      if (gmag2 < 1e-10) continue;
      // Newton step: move along gradient to reach f = threshold
      const step = (fg.val - threshold) / gmag2;
      vertices[i] = [
        p[0] - fg.gx * step,
        p[1] - fg.gy * step,
        p[2] - fg.gz * step,
      ];
    }
  }
}

// ── Analytical Normals ──────────────────────────────────────────

/**
 * Compute smooth vertex normals from the analytical field gradient.
 * ∇f = Σ -2r²(p - center) / dist⁴
 * This eliminates grid-discretization banding that plagues mesh-based normals.
 */
function computeMetaballNormals(vertices, balls) {
  const normals = new Array(vertices.length);
  for (let i = 0; i < vertices.length; i++) {
    const p = vertices[i];
    const fg = evalFieldAndGradient(p[0], p[1], p[2], balls);
    const len = Math.sqrt(fg.gx * fg.gx + fg.gy * fg.gy + fg.gz * fg.gz) || 1;
    normals[i] = [-fg.gx / len, -fg.gy / len, -fg.gz / len]; // negate: gradient points inward, normals point outward
  }
  return normals;
}

// ── Public API ───────────────────────────────────────────────────

/** Generate a triangle mesh from metaball definitions. Returns { vertices, triangles, normals }. */
function generateMetaballMesh(balls, res, threshold) {
  if (!balls.length) return { vertices: [[0,0,0]], triangles: [] };

  // Compute bounding box from ball positions + radii + padding
  const padding = 1.5; // extra multiplier for field falloff
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < balls.length; i++) {
    const r = balls[i].radius * padding;
    minX = Math.min(minX, balls[i].x - r);
    minY = Math.min(minY, balls[i].y - r);
    minZ = Math.min(minZ, balls[i].z - r);
    maxX = Math.max(maxX, balls[i].x + r);
    maxY = Math.max(maxY, balls[i].y + r);
    maxZ = Math.max(maxZ, balls[i].z + r);
  }

  // Make the grid cubic (same cell size on all axes)
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const half = span * 0.5;
  const gridMin = [cx - half, cy - half, cz - half];
  const cellSize = span / res;

  const field = evaluateField(balls, gridMin, cellSize, res);
  const mesh = marchingCubes(field, res, gridMin, cellSize, threshold);
  smoothMesh(mesh.vertices, mesh.triangles, balls, threshold, 2);
  mesh.normals = computeMetaballNormals(mesh.vertices, balls);
  return mesh;
}
