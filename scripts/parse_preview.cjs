#!/usr/bin/env node
const fs = require('fs');

function paginateText(text, charsPerPage) {
  const pages = [];
  const paragraphs = text.split(/\n/);
  let currentPage = '';
  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i] + '\n';
    if ((currentPage.length + paragraph.length) > charsPerPage && currentPage.length > 0) {
      pages.push(currentPage);
      currentPage = paragraph;
    } else {
      currentPage += paragraph;
    }
  }
  if (currentPage.length > 0) pages.push(currentPage);
  return pages;
}

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
    const RAW_CHARS_PER_PAGE = 5000;
    const rawPages = paginateText(normalized, RAW_CHARS_PER_PAGE);
    return rawPages.map((content, index) => ({ title: rawPages.length === 1 ? 'Content' : `Page ${index + 1}`, content }));
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

// ALSO: run the old (faulty) global regex to show what it would have matched
console.log('\nOld global-regex matches near selection (lines 390-450):');
const oldRegex = /(?:^|\n)\s*(#{1,3}\s+)?(第[0-9零一二三四五六七八九十百千]+[章回节卷]|Chapter\s+\d+|[A-Z][a-z]+(\s+[A-Z][a-z]+)*).*/g;
const matches = [...normalized.matchAll(oldRegex)];
for (const m of matches) {
  const idx = m.index || 0;
  const lineNumber = normalized.substring(0, idx).split('\n').length;
  if (lineNumber >= 390 && lineNumber <= 450) {
    console.log('OldRegex match at line', lineNumber + ':', m[0].trim());
  }
}
