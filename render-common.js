// @ts-check

// ── Sky image loading ───────────────────────────────────────────
// Extracts pixel data from the hidden <img> and stores it in
// environment._sky (defined in environment.js).

function extractSkyPixels() {
  const img = document.getElementById('skyImg');
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  const id = cx.getImageData(0, 0, c.width, c.height);
  environment._sky.imageData = id.data;
  environment._sky.width = c.width;
  environment._sky.height = c.height;
}

const skyImg = document.getElementById('skyImg');
if (skyImg.complete) extractSkyPixels();
else skyImg.onload = extractSkyPixels;

/** Blit sky image into the software backbuffer. */
function drawSkyBackground() {
  const sky = environment._sky;
  if (!sky.imageData) return;
  for (let y = 0; y < HEIGHT; y++) {
    const sy = (y / HEIGHT * sky.height) | 0;
    for (let x = 0; x < WIDTH; x++) {
      const sx = (x / WIDTH * sky.width) | 0;
      const si = (sy * sky.width + sx) * 4;
      const di = (y * WIDTH + x) * 4;
      backBuf[di]     = sky.imageData[si];
      backBuf[di + 1] = sky.imageData[si + 1];
      backBuf[di + 2] = sky.imageData[si + 2];
      backBuf[di + 3] = 255;
    }
  }
}
