import { Chapter, BookData } from '../../types';
import { generateId } from '../../utils';

export const extractMetadata = (text: string): { author?: string, title?: string, publisher?: string } => {
  const snippet = text.slice(0, 1000);
  const result: { author?: string, title?: string, publisher?: string } = {};

  const authorPatterns = [
    /(?:作者|Author|writer)[:：]\s*([^\n\r]+)/i,
    /(?:著|By)[:：]\s*([^\n\r]+)/i,
    /^\s*([^\n\r]+)\s*(?:著|作)\s*$/m
  ];

  for (const pattern of authorPatterns) {
    const match = snippet.match(pattern);
    if (match && match[1]) {
      result.author = match[1].trim();
      break;
    }
  }

  const titlePatterns = [
    /(?:书名|Title|Name)[:：]\s*([^\n\r]+)/i,
    /《([^》]+)》/
  ];

  for (const pattern of titlePatterns) {
    const match = snippet.match(pattern);
    if (match && match[1]) {
      result.title = match[1].trim();
      break;
    }
  }

  const publisherPatterns = [
    /(?:出版社|Publisher)[:：]\s*([^\n\r]+)/i,
    /(?:出版)[:：]\s*([^\n\r]+)/i
  ];

  for (const pattern of publisherPatterns) {
    const match = snippet.match(pattern);
    if (match && match[1]) {
      result.publisher = match[1].trim();
      break;
    }
  }

  return result;
};

/**
 * Parses TXT content into chapters using intelligent regex / paragraph splitting.
 */
export const parseChapters = (text: string): Chapter[] => {
  if (!text || text.trim().length === 0) return [];

  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  const chineseHeader = /^\s*第\s*[0-9零一二三四五六七八九十百千两〇○]+(?:章|回|节|卷|篇)\b[:：.\s\-–—]*/;
  const englishHeaderNumeric = /^\s*(?:chapter|chap)\s*\d+\b[:：.\s\-–—]*/i;
  const englishHeaderRoman = /^\s*(?:chapter|chap)\s*[ivxlcdm]+\b[:：.\s\-–—]*/i;
  const markdownHeader = /^\s*#{1,6}\s+/;

  const headerLines: { lineIndex: number; title: string; charIndex: number }[] = [];
  let charIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.length > 0 && (chineseHeader.test(trimmed) || englishHeaderNumeric.test(trimmed) || englishHeaderRoman.test(trimmed) || markdownHeader.test(trimmed))) {
      headerLines.push({ lineIndex: i, title: trimmed, charIndex });
    }

    charIndex += line.length + (i < lines.length - 1 ? 1 : 0);
  }

  const finalize = (chs: Chapter[]) => {
    const MIN_CHARS = 120;
    const out: Chapter[] = [];
    for (let i = 0; i < chs.length; i++) {
      const cur = chs[i];
      const prevIsPreface = out.length > 0 && out[out.length - 1].title === 'Preface / Start';
      if (cur.content.length < MIN_CHARS && out.length > 0 && !prevIsPreface) {
        out[out.length - 1].content = (out[out.length - 1].content + '\n\n' + cur.content).trim();
      } else {
        out.push({ title: cur.title, content: cur.content });
      }
    }
    return out;
  };

  if (headerLines.length < 2) {
    const RAW_CHARS_PER_PAGE = 5000;
    const paragraphs = normalized.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);

    const paraCharIndex: number[] = [];
    let searchPos = 0;
    for (const p of paragraphs) {
      const idx = normalized.indexOf(p, searchPos);
      paraCharIndex.push(idx >= 0 ? idx : searchPos);
      searchPos = (idx >= 0 ? idx : searchPos) + p.length;
    }

    const paraHeaders: { paraIndex: number; title: string; charIndex: number }[] = [];
    for (let i = 0; i < paragraphs.length - 1; i++) {
      const cur = paragraphs[i];
      const next = paragraphs[i + 1];
      if (cur.length > 0 && cur.length <= 120 && next.length >= 200) {
        paraHeaders.push({ paraIndex: i, title: cur.split('\n')[0].trim(), charIndex: paraCharIndex[i] });
      }
    }

    const explicitParaHeaders = [] as { paraIndex: number; title: string; charIndex: number }[];
    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs[i];
      const firstLine = p.split('\n')[0].trim();
      if (firstLine.length === 0) continue;
      if (chineseHeader.test(firstLine) || englishHeaderNumeric.test(firstLine) || englishHeaderRoman.test(firstLine) || markdownHeader.test(firstLine)) {
        explicitParaHeaders.push({ paraIndex: i, title: firstLine.replace(/^#{1,6}\s+/, '').trim(), charIndex: paraCharIndex[i] });
      }
    }

    const detectedParaHeaders = explicitParaHeaders.length >= 2 ? explicitParaHeaders : (paraHeaders.length >= 2 ? paraHeaders : []);

    if (detectedParaHeaders.length >= 2) {
      const chapters: Chapter[] = [];
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
      return finalize(chapters);
    }

    const pages: string[] = [];
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

    const makeTitle = (content: string, idx: number) => {
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

    const titles: string[] = [];
    const seen = new Map<string, number>();
    for (let i = 0; i < pages.length; i++) {
      let t = makeTitle(pages[i], i) || `Page ${i + 1}`;
      const count = seen.get(t) || 0;
      if (count > 0) t = `${t} (${count + 1})`;
      seen.set(t, count + 1);
      titles.push(t);
    }

    const pg = pages.map((content, index) => ({ title: titles[index], content }));
    return finalize(pg);
  }

  const chapters: Chapter[] = [];

  if (headerLines[0].charIndex > 0) {
    chapters.push({
      title: 'Preface / Start',
      content: normalized.substring(0, headerLines[0].charIndex).trim()
    });
  }

  for (let i = 0; i < headerLines.length; i++) {
    const start = headerLines[i].charIndex;
    const end = i < headerLines.length - 1 ? headerLines[i + 1].charIndex : normalized.length;
    const section = normalized.substring(start, end).trim();
    const cleanedTitle = headerLines[i].title.replace(/^#{1,6}\s+/, '').trim().split('\n')[0];

    chapters.push({
      title: cleanedTitle || `Chapter ${i + 1}`,
      content: section
    });
  }

  return finalize(chapters);
};

/**
 * Parses a TXT File object into a BookData object with automatic UTF-8 / GBK encoding fallback.
 */
export const parseTxtFile = async (file: File): Promise<Partial<BookData>> => {
  const buffer = await file.arrayBuffer();
  let content = '';

  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    content = decoder.decode(buffer);
  } catch (e) {
    const decoder = new TextDecoder('gbk');
    content = decoder.decode(buffer);
  }

  const chapters = parseChapters(content);
  const metadata = extractMetadata(content);
  const cleanFileName = file.name.replace(/\.[^/.]+$/, "");

  return {
    title: metadata.title || cleanFileName,
    author: metadata.author || 'Unknown',
    content,
    chapters,
    format: 'txt',
  };
};
