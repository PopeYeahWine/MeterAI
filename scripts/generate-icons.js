const sharp = require('sharp');
const pngToIco = require('png-to-ico').default || require('png-to-ico');
const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, '..', 'src-tauri', 'icons');
const svgPath = path.join(iconsDir, 'icon.svg');

async function generateIcons() {
  console.log('Generating icons from SVG...');

  const svgBuffer = fs.readFileSync(svgPath);

  // Generate PNG files at different sizes
  const sizes = [32, 128, 256];

  for (const size of sizes) {
    const outputName = size === 256 ? '128x128@2x.png' : `${size}x${size}.png`;
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(path.join(iconsDir, outputName));
    console.log(`Created ${outputName}`);
  }

  // Create icon.png (512x512 for high-res)
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(iconsDir, 'icon.png'));
  console.log('Created icon.png');

  // Generate ICO file for Windows (using multiple sizes)
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const icoBuffers = [];

  for (const size of icoSizes) {
    const buffer = await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toBuffer();
    icoBuffers.push(buffer);
  }

  const icoBuffer = await pngToIco(icoBuffers);
  fs.writeFileSync(path.join(iconsDir, 'icon.ico'), icoBuffer);
  console.log('Created icon.ico');

  // For macOS, we need icns - but we can use PNG as fallback
  // Tauri will handle this, just copy icon.png as a placeholder
  fs.copyFileSync(
    path.join(iconsDir, 'icon.png'),
    path.join(iconsDir, 'icon.icns.png')
  );

  console.log('All icons generated successfully!');
}

generateIcons().catch(console.error);
