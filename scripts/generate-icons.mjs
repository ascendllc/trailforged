// One-off script to generate the favicon / app-icon set from the official
// Trail Life USA icon mark (assets/brand/TL_Icon_RGB.webp). Run with:
//   node scripts/generate-icons.mjs
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const source = path.join(root, "assets/brand/TL_Icon_RGB.webp");
const outDir = path.join(root, "public");

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

async function squareOnWhite(size, padPct = 0.08) {
  const inner = Math.round(size * (1 - padPct * 2));
  const icon = await sharp(source)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  return sharp({
    create: { width: size, height: size, channels: 4, background: WHITE },
  })
    .composite([{ input: icon, gravity: "center" }])
    .png()
    .toBuffer();
}

async function writePng(size, filename, padPct) {
  const buf = await squareOnWhite(size, padPct);
  await sharp(buf).toFile(path.join(outDir, filename));
  console.log(`wrote ${filename} (${size}x${size})`);
  return buf;
}

// Minimal ICO container embedding PNG-compressed frames (supported by all
// modern browsers and Windows since Vista) — avoids needing an extra npm dep.
function buildIco(pngBuffers) {
  const count = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * count;
  let offset = headerSize + dirSize;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  const imageBuffers = [];

  for (const { size, buffer } of pngBuffers) {
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height (0 = 256)
    entry.writeUInt8(0, 2); // color palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(buffer.length, 8); // image size
    entry.writeUInt32LE(offset, 12); // image offset
    offset += buffer.length;
    dirEntries.push(entry);
    imageBuffers.push(buffer);
  }

  return Buffer.concat([header, ...dirEntries, ...imageBuffers]);
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const meta = await sharp(source).metadata();
  console.log(`source: ${meta.width}x${meta.height}, alpha=${meta.hasAlpha}`);

  // Standalone PNG favicons
  const png16 = await writePng(16, "favicon-16x16.png", 0.04);
  const png32 = await writePng(32, "favicon-32x32.png", 0.06);
  const png48 = await writePng(48, "favicon-48x48.png", 0.06);

  // Multi-size favicon.ico (16/32/48) built from the PNGs above
  const ico = buildIco([
    { size: 16, buffer: png16 },
    { size: 32, buffer: png32 },
    { size: 48, buffer: png48 },
  ]);
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(path.join(outDir, "favicon.ico"), ico)
  );
  console.log("wrote favicon.ico (16/32/48 multi-size)");

  // Apple touch icon — flattened on white per Apple's guidance (no alpha)
  await writePng(180, "apple-touch-icon.png", 0.1);

  // Android / PWA manifest icons
  await writePng(192, "icon-192.png", 0.12);
  await writePng(512, "icon-512.png", 0.12);

  // SVG favicon wrapper (raster-based — no vector source available) so
  // browsers that prefer rel="icon" type="image/svg+xml" still get a crisp icon.
  const svgSourcePng = await squareOnWhite(512, 0.08);
  const base64 = svgSourcePng.toString("base64");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <image href="data:image/png;base64,${base64}" width="512" height="512" />
</svg>
`;
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(path.join(outDir, "favicon.svg"), svg)
  );
  console.log("wrote favicon.svg (raster-wrapped)");

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
