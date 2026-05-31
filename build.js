const fs = require('fs');
const path = require('path');

const key = process.env.OPENROUTER_API_KEY || '';
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
const out = html.replace('__OR_KEY__', key);
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'index.html'), out);
console.log('Build complete');
