// @ts-check

// Checkerboard floor: a large plane made of tiles
const FLOOR_Y = 120;
const FLOOR_TILE = 80;
const FLOOR_HALF = 6; // tiles in each direction from center
const FLOOR_Z_OFFSET = 100; // world z offset

// Triangle mesh (used by software rasterizer)
const floorMesh = (function() {
  const vertices = [];
  const triangles = [];
  const colors = [];

  for (let iz = -FLOOR_HALF; iz < FLOOR_HALF; iz++) {
    for (let ix = -FLOOR_HALF; ix < FLOOR_HALF; ix++) {
      const x0 = ix * FLOOR_TILE;
      const x1 = (ix + 1) * FLOOR_TILE;
      const z0 = iz * FLOOR_TILE;
      const z1 = (iz + 1) * FLOOR_TILE;

      const vi = vertices.length;
      vertices.push([x0, FLOOR_Y, z0]);
      vertices.push([x1, FLOOR_Y, z0]);
      vertices.push([x1, FLOOR_Y, z1]);
      vertices.push([x0, FLOOR_Y, z1]);

      triangles.push([vi, vi + 1, vi + 2]);
      triangles.push([vi, vi + 2, vi + 3]);

      const isWhite = (ix + iz) & 1;
      const col = isWhite ? [200, 200, 200] : [180, 30, 30];
      colors.push(col);
      colors.push(col);
    }
  }

  return { vertices, triangles, colors };
})();

// Analytical floor data now lives in environment.js (environment.floor)
