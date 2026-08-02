const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const source = path.resolve('images/file_00000000cd7881f492a9357c14c31bd9.png');
const outputDirectory = path.resolve('public/images/hero');

async function encode(page, mimeType, quality) {
  const bytes = await fs.readFile(source);
  return page.evaluate(async ({ data, mimeType, quality }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const width = 1280;
    const height = Math.round(width * image.naturalHeight / image.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d', { alpha: false }).drawImage(image, 0, 0, width, height);
    const dataUrl = canvas.toDataURL(mimeType, quality);
    return { width, height, base64: dataUrl.split(',')[1] };
  }, { data: bytes.toString('base64'), mimeType, quality });
}

async function main() {
  await fs.mkdir(outputDirectory, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const webp = await encode(page, 'image/webp', 0.84);
    const jpeg = await encode(page, 'image/jpeg', 0.86);
    await Promise.all([
      fs.writeFile(path.join(outputDirectory, 'young-congolese-learner-online-english.webp'), Buffer.from(webp.base64, 'base64')),
      fs.writeFile(path.join(outputDirectory, 'young-congolese-learner-online-english.jpg'), Buffer.from(jpeg.base64, 'base64')),
    ]);
    console.log(`HERO_IMAGE_OK=${webp.width}x${webp.height}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
