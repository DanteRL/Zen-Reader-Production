const fs = require('fs');
const filePath = process.argv[2] || '/Users/01326553/Downloads/学霸的黑科技系统.txt';
let text;
try {
  text = fs.readFileSync(filePath, 'utf8');
} catch (e) {
  console.error('read error', e.message);
  process.exit(2);
}
const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const oldRegex = /(?:^|\n)\s*(#{1,3}\s+)?(第[0-9零一二三四五六七八九十百千]+[章回节卷]|Chapter\s+\d+|[A-Z][a-z]+(\s+[A-Z][a-z]+)*).*/g;
let found = false;
const matches = [...normalized.matchAll(oldRegex)];
for (const m of matches) {
  const idx = m.index || 0;
  const lineNumber = normalized.substring(0, idx).split('\n').length;
  // Print matches in a focused window to inspect erroneous detections
  if (lineNumber >= 360 && lineNumber <= 460) {
    console.log('OldRegex match at line', lineNumber + ':', m[0].trim());
    found = true;
  }
}
console.log('found in window 360-460 =', found, '; total matches =', matches.length);
