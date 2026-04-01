#!/usr/bin/env node
const fs = require('fs');

function parseChapters(text) {
  if (!text || text.trim().length === 0) return [];
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const headerLines = [];
  let charIndex = 0;
  const chineseHeader = /^\s*第\s*[0-9零一二三四五六七八九十百千两〇○]+(?:章|回|节|卷|篇)\b[:：.\s\-–—]*/;
  const englishHeaderNumeric = /^\s*(?:chapter|chap)\s*\d+\b[:：.\s\-–—]*/i;
  const englishHeaderRoman = /^\s*(?:chapter|chap)\s*[ivxlcdm]+\b[:：.\s\-–—]*/i;
  const markdownHeader = /^\s*#{1,6}\s+/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.length > 0 && (chineseHeader.test(trimmed) || englishHeaderNumeric.test(trimmed) || englishHeaderRoman.test(trimmed) || markdownHeader.test(trimmed))) {
      headerLines.push({ lineIndex: i, title: trimmed, charIndex });
    }
    charIndex += line.length + (i < lines.length - 1 ? 1 : 0);
  }

  if (headerLines.length < 2) {
    const parts = normalized.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
    return parts.map((content, idx) => ({ title: parts.length === 1 ? 'Content' : `Page ${idx + 1}`, content }));
  }

  const chapters = [];
  if (headerLines[0].charIndex > 0) {
    chapters.push({ title: 'Preface / Start', content: normalized.substring(0, headerLines[0].charIndex).trim() });
  }
  for (let i = 0; i < headerLines.length; i++) {
    const start = headerLines[i].charIndex;
    const end = i < headerLines.length - 1 ? headerLines[i + 1].charIndex : normalized.length;
    const section = normalized.substring(start, end).trim();
    const cleanedTitle = headerLines[i].title.replace(/^#{1,6}\s+/, '').trim().split('\n')[0];
    chapters.push({ title: cleanedTitle || `Chapter ${i + 1}`, content: section });
  }
  return chapters;
}

const filePath = process.argv[2] || '/Users/01326553/Downloads/学霸的黑科技系统.txt';
let text;
try {
  text = fs.readFileSync(filePath, 'utf8');
} catch (e) {
  console.error('Failed to read file', filePath, e.message);
  process.exit(2);
}
const chapters = parseChapters(text);
console.log('Chapters detected:', chapters.length);
for (let i = 0; i < chapters.length; i++) {
  const ch = chapters[i];
  console.log('\n--- Chapter', i + 1, '---');
  console.log('Title:', ch.title);
  console.log('Preview:', ch.content.substring(0, 300).replace(/\n/g, '\\n'));
}

// Also print detected header lines with file line numbers for debugging
console.log('\nDetected header lines (debug):');
const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const fileLines = normalized.split('\n');
const chineseHeader = /^\s*第\s*[0-9零一二三四五六七八九十百千两〇○]+(?:章|回|节|卷|篇)\b[:：.\s\-–—]*/;
const englishHeaderNumeric = /^\s*(?:chapter|chap)\s*\d+\b[:：.\s\-–—]*/i;
const englishHeaderRoman = /^\s*(?:chapter|chap)\s*[ivxlcdm]+\b[:：.\s\-–—]*/i;
const markdownHeader = /^\s*#{1,6}\s+/;
for (let i = 0; i < fileLines.length; i++) {
  const t = fileLines[i].trim();
  if (t.length > 0 && (chineseHeader.test(t) || englishHeaderNumeric.test(t) || englishHeaderRoman.test(t) || markdownHeader.test(t))) {
    console.log('Line', i + 1 + ':', t);
  }
}
