const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');
const staticFiles = [
  'index.html',
  'privacy.html',
  'manifest.webmanifest',
  'service-worker.js',
  'solreplies.png',
  'srgmark.png',
  'srgwordmark.png',
  'preview.png',
  'pwa-icon-192.png',
  'pwa-icon-512.png',
];

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

for (const file of staticFiles) {
  fs.copyFileSync(path.join(__dirname, file), path.join(distDir, file));
}

console.log('Build complete');
