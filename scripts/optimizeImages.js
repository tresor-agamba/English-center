const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const outputRoot = path.join(root, 'public', 'images', 'optimized');
const photos = [
  ['public/images/nva/pic-1.png', 'pic-1', [640, 1290]],
  ['public/images/nva/pic-3.png', 'pic-3', [480, 768, 1024]],
  ['public/images/nva/pic-6.png', 'pic-6', [480, 768, 1280]],
  ['public/images/nva/pic-7.jpeg', 'pic-7', [768, 1440]],
  ['public/images/nva/pic-8.png', 'pic-8', [480, 768, 1024]],
  ['public/images/nva/pic-9.png', 'pic-9', [480, 768, 1024]],
  ['public/images/nva/pic-10.png', 'pic-10', [480, 768, 1024]],
];
const logos = [
  ['public/images/logo/logo-icon.png', 'logo-icon-192.png', 192],
  ['public/images/logo/logo-navigation.png', 'logo-navigation-320.png', 320],
  ['public/images/logo/logo-with-tagline.png', 'logo-with-tagline-480.png', 480],
];

async function ensureOutput() { await fs.mkdir(outputRoot, { recursive: true }); }
async function size(file) { return (await fs.stat(file)).size; }

async function main() {
  await ensureOutput();
  const report = [];
  for (const [source, stem, widths] of photos) {
    const absoluteSource = path.join(root, source);
    const metadata = await sharp(absoluteSource).metadata();
    for (const width of widths) {
      const destination = path.join(outputRoot, `${stem}-${width}.webp`);
      await sharp(absoluteSource).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 84, effort: 6 }).toFile(destination);
      const result = await sharp(destination).metadata();
      report.push({ source, destination: path.relative(root, destination).replaceAll('\\', '/'), beforeBytes: await size(absoluteSource), afterBytes: await size(destination), dimensions: `${result.width}x${result.height}`, format: 'webp', sourceDimensions: `${metadata.width}x${metadata.height}` });
    }
  }
  for (const [source, filename, width] of logos) {
    const absoluteSource = path.join(root, source);
    const destination = path.join(outputRoot, filename);
    await sharp(absoluteSource).resize({ width, withoutEnlargement: true }).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(destination);
    const result = await sharp(destination).metadata();
    report.push({ source, destination: path.relative(root, destination).replaceAll('\\', '/'), beforeBytes: await size(absoluteSource), afterBytes: await size(destination), dimensions: `${result.width}x${result.height}`, format: 'png' });
  }
  console.table(report);
}

main().catch((error) => { console.error(`[IMAGE_OPTIMIZATION_FAILED] ${error.message}`); process.exitCode = 1; });
