/**
 * Generates the extension's PNG icon set procedurally. Run with `npm run icons`.
 *
 * Why generate instead of committing art: a PNG is an opaque blob in a diff.
 * Keeping the mark as shape math means anyone can retune the colour or the
 * glyph and regenerate, and a reviewer can see exactly what changed.
 *
 * Node built-ins only (zlib for deflate) — no image library, no build step.
 */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "icons");
const SIZES = [16, 32, 48, 128];
const SUBSAMPLES = 3; // 3x3 supersampling per pixel is our only antialiasing

const INDIGO = [79, 70, 229]; // gradient start
const VIOLET = [124, 58, 237]; // gradient end
const WHITE = [255, 255, 255];
const MINT = [52, 211, 153]; // the "filled successfully" check

// Shapes are defined in a normalised 0..1 space, so identical math renders a
// crisp 16px favicon and a 128px store icon.

/** Signed distance to a rounded rect. Negative inside, positive outside. */
function roundedRectSD(x, y, cx, cy, halfW, halfH, r) {
  const dx = Math.abs(x - cx) - (halfW - r);
  const dy = Math.abs(y - cy) - (halfH - r);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}

/** Signed distance to a circle. */
function circleSD(x, y, cx, cy, r) {
  return Math.hypot(x - cx, y - cy) - r;
}

/** Signed distance to a round-capped line segment. The check is two of these. */
function segmentSD(x, y, ax, ay, bx, by, halfThickness) {
  const abx = bx - ax, aby = by - ay;
  const apx = x - ax, apy = y - ay;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenSq));
  return Math.hypot(apx - abx * t, apy - aby * t) - halfThickness;
}

/** Paint `src` over `dst` at `alpha`. Mutates dst. */
function over(dst, src, alpha) {
  if (alpha > 0) {
    const a = Math.min(1, alpha);
    for (let i = 0; i < 3; i++) dst[i] += (src[i] - dst[i]) * a;
  }
  return dst;
}

/**
 * Colour of one sample point, as [r, g, b, alpha0to1].
 *
 * The mark: a rounded indigo-to-violet tile holding three white "form field"
 * bars, with a mint check badge in the lower right meaning the form is done.
 */
function sampleMark(x, y) {
  // Edge ramp width in normalised units, so it stays about one pixel wide at
  // every output size.
  const AA = 0.006;
  const cover = (sd) => Math.max(0, Math.min(1, 0.5 - sd / AA));

  const tileAlpha = cover(roundedRectSD(x, y, 0.5, 0.5, 0.5, 0.5, 0.22));
  if (tileAlpha <= 0) return [0, 0, 0, 0];

  // Diagonal gradient across the tile.
  const t = Math.max(0, Math.min(1, (x + y) / 2));
  const grad = () => INDIGO.map((c, i) => c + (VIOLET[i] - c) * t);
  const rgb = grad();

  // Three form-field bars of decreasing width, like real inputs on a form.
  for (const [cy, halfW] of [[0.32, 0.24], [0.48, 0.24], [0.64, 0.13]]) {
    over(rgb, WHITE, cover(roundedRectSD(x, y, 0.26 + halfW, cy, halfW, 0.052, 0.052)));
  }

  // Check badge. The gradient-coloured ring is drawn first to punch a gap in
  // the bars, so the badge reads as a layer sitting above them.
  const [bx, by, br] = [0.72, 0.71, 0.235];
  over(rgb, grad(), cover(circleSD(x, y, bx, by, br + 0.055)));
  over(rgb, MINT, cover(circleSD(x, y, bx, by, br)));
  over(rgb, WHITE, cover(Math.min(
    segmentSD(x, y, 0.615, 0.715, 0.695, 0.795, 0.045),
    segmentSD(x, y, 0.695, 0.795, 0.835, 0.625, 0.045)
  )));

  return [rgb[0], rgb[1], rgb[2], tileAlpha];
}

/** Render the mark at `size` squared into raw RGBA bytes. */
function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SUBSAMPLES);
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SUBSAMPLES; sy++) {
        for (let sx = 0; sx < SUBSAMPLES; sx++) {
          const [sr, sg, sb, sa] = sampleMark(
            (pxi * SUBSAMPLES + sx + 0.5) * step,
            (py * SUBSAMPLES + sy + 0.5) * step
          );
          // Premultiply so partially transparent edge samples average right.
          r += sr * sa; g += sg * sa; b += sb * sa; a += sa;
        }
      }
      const i = (py * size + pxi) * 4;
      // Un-premultiply back to straight alpha, which is what PNG stores.
      px[i] = a > 0 ? Math.round(Math.min(255, r / a)) : 0;
      px[i + 1] = a > 0 ? Math.round(Math.min(255, g / a)) : 0;
      px[i + 2] = a > 0 ? Math.round(Math.min(255, b / a)) : 0;
      px[i + 3] = Math.round((a / (SUBSAMPLES * SUBSAMPLES)) * 255);
    }
  }
  return px;
}

// --- Minimal PNG encoder ---------------------------------------------------

const CRC_TABLE = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encode raw RGBA bytes as an 8-bit truecolour-with-alpha PNG. */
function encodePng(size, rgba) {
  const stride = size * 4 + 1; // each PNG scanline is prefixed with a filter byte
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter 0 (None); these images are tiny, zlib copes
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type 6 = RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  writeFileSync(resolve(OUT_DIR, `icon-${size}.png`), encodePng(size, render(size)));
  console.log(`wrote icons/icon-${size}.png`);
}
