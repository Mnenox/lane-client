// 生成统一应用图标：午夜底 + 品红霓虹 lane 字标（窗口 / 任务栏 / 托盘同源）
const sharp = require('sharp');
const path = require('node:path');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <filter id="g1" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="10"/></filter>
    <filter id="g2" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="22"/></filter>
  </defs>
  <rect width="256" height="256" rx="52" fill="#1B2438"/>
  <rect x="10" y="10" width="236" height="236" rx="44" fill="none" stroke="#33405E" stroke-width="3"/>
  <text x="128" y="160" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="92" fill="#FF2E9A" filter="url(#g2)" opacity="0.55">lane</text>
  <text x="128" y="160" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="92" fill="#FF2E9A" filter="url(#g1)" opacity="0.85">lane</text>
  <text x="128" y="160" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="92" fill="#FFD7EC">lane</text>
  <text x="128" y="160" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="92" fill="none" stroke="#FF2E9A" stroke-width="2">lane</text>
</svg>`;

sharp(Buffer.from(svg))
  .resize(256, 256)
  .png()
  .toFile(path.join(__dirname, '..', 'src', 'main', 'icon.png'))
  .then(() => console.log('icon.png written (magenta neon lane)'));