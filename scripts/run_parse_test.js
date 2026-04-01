#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const filePath = process.argv[2] || path.join(require('os').homedir(), 'Downloads', '学霸的黑科技系统.txt');
let text;
try {
  text = fs.readFileSync(filePath, 'utf8');
} catch (e) {
  console.error('Failed to read file', filePath, e.message);
  process.exit(2);
}

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
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const chineseHeader = /^\s*第\s*[0-9零一二三四五六七八九十百千两〇○]+(?:章|回|节|卷|篇)\b[:：.\s\-–—]*/;
    const englishHeaderNumeric = /^\s*(?:chapter|chap)\s*\d+\b[:：.\s\-–—]*/i;
    const englishHeaderRoman = /^\s*(?:chapter|chap)\s*[ivxlcdm]+\b[:：.\s\-–—]*/i;
    const markdownHeader = /^\s*#{1,6}\s+/;
    if (trimmed.length > 0 && (chineseHeader.test(trimmed) || englishHeaderNumeric.test(trimmed) || englishHeaderRoman.test(trimmed) || markdownHeader.test(trimmed))) {
      headerLines.push({ lineIndex: i, title: trimmed, charIndex });
    }
    charIndex += line.length + (i < lines.length - 1 ? 1 : 0);
  }

  if (headerLines.length < 2) {
    const RAW_CHARS_PER_PAGE = 5000;
    const paragraphs = normalized.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    const paraCharIndex = [];
    let searchPos = 0;
    for (const p of paragraphs) {
      const idx = normalized.indexOf(p, searchPos);
      paraCharIndex.push(idx >= 0 ? idx : searchPos);
      searchPos = (idx >= 0 ? idx : searchPos) + p.length;
    }
    const paraHeaders = [];
    for (let i = 0; i < paragraphs.length - 1; i++) {
      const cur = paragraphs[i];
      const next = paragraphs[i + 1];
      if (cur.length > 0 && cur.length <= 120 && next.length >= 200) {
        paraHeaders.push({ paraIndex: i, title: cur.split('\n')[0].trim(), charIndex: paraCharIndex[i] });
      }
    }
    const explicitParaHeaders = [];
    const chineseHeader = /^\s*第\s*[0-9零一二三四五六七八九十百千两〇○]+(?:章|回|节|卷|篇)\b[:：.\s\-–—]*/;
    const englishHeaderNumeric = /^\s*(?:chapter|chap)\s*\d+\b[:：.\s\-–—]*/i;
    const englishHeaderRoman = /^\s*(?:chapter|chap)\s*[ivxlcdm]+\b[:：.\s\-–—]*/i;
    const markdownHeader = /^\s*#{1,6}\s+/;
    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs[i];
      const firstLine = p.split('\n')[0].trim();
      if (!firstLine) continue;
      if (chineseHeader.test(firstLine) || englishHeaderNumeric.test(firstLine) || englishHeaderRoman.test(firstLine) || markdownHeader.test(firstLine)) {
        explicitParaHeaders.push({ paraIndex: i, title: firstLine.replace(/^#{1,6}\s+/, '').trim(), charIndex: paraCharIndex[i] });
      }
    }
    const detectedParaHeaders = explicitParaHeaders.length >= 2 ? explicitParaHeaders : (paraHeaders.length >= 2 ? paraHeaders : []);
    if (detectedParaHeaders.length >= 2) {
      const chapters = [];
      if (detectedParaHeaders[0].charIndex > 0) {
        chapters.push({ title: 'Preface / Start', content: normalized.substring(0, detectedParaHeaders[0].charIndex).trim() });
      }
      for (let i = 0; i < detectedParaHeaders.length; i++) {
        const start = detectedParaHeaders[i].charIndex;
        const end = i < detectedParaHeaders.length - 1 ? detectedParaHeaders[i + 1].charIndex : normalized.length;
        const section = normalized.substring(start, end).trim();
        const cleanedTitle = detectedParaHeaders[i].title.split('\n')[0].trim();
        chapters.push({ title: cleanedTitle || `Section ${i + 1}`, content: section });
      }
      return chapters;
    }
    const pages = [];
    let current = '';
    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i] + '\n\n';
      if (current.length + para.length > RAW_CHARS_PER_PAGE && current.length > 0) {
        pages.push(current.trim());
        current = para;
      } else {
        current += para;
      }
    }
    if (current.length > 0) pages.push(current.trim());
    const makeTitle = (content, idx) => {
      if (pages.length === 1) return 'Content';
      const md = content.match(/^\s*#{1,6}\s*(.+)$/m);
      if (md && md[1]) return md[1].trim().slice(0, 80);
      const ch = content.match(/^\s*(第\s*[0-9零一二三四五六七八九十百千两〇○]+(?:章|回|节|卷|篇))\b[:：.\s\-–—]*(.*)$/mi);
      if (ch && ch[1]) return ((ch[2] || '').trim() ? `${ch[1]} ${ch[2].trim()}` : ch[1]).slice(0, 80);
      const en = content.match(/^\s*(?:chapter|chap)\s*([0-9]+|[ivxlcdmIVXLCDM]+)\b[:：.\s\-–—]*([^\n]*)/mi);
      if (en && en[1]) return (`Chapter ${en[1]}` + ((en[2] || '').trim() ? ` ${en[2].trim()}` : '')).slice(0, 80);
      const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      for (const ln of lines.slice(0, 6)) {
        if (ln.length <= 80) return ln.slice(0, 80);
      }
      const fallback = content.replace(/\s+/g, ' ').trim().slice(0, 40);
      return fallback ? (fallback + '...') : `Page ${idx + 1}`;
    };
    const titles = [];
    const seen = new Map();
    for (let i = 0; i < pages.length; i++) {
      let t = makeTitle(pages[i], i) || `Page ${i + 1}`;
      const count = seen.get(t) || 0;
      if (count > 0) t = `${t} (${count + 1})`;
      seen.set(t, count + 1);
      titles.push(t);
    }
    return pages.map((content, index) => ({ title: titles[index], content }));
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

const chapters = parseChapters(text);
console.log('Detected chapters:', chapters.length);
for (let i = 0; i < Math.min(30, chapters.length); i++) {
  const ch = chapters[i];
  console.log('\n--- Chapter', i + 1, '---');
  console.log('Title:', ch.title);
  console.log('Preview:', ch.content.substring(0, 300).replace(/\n/g, '\\n'));
}

// Print detected header lines for debugging
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
