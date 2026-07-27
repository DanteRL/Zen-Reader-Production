import { BookData } from '../../types';
import { generateId } from '../../utils';
import { parseTxtFile } from './txtParser';
import { parseEpubFile } from './epubParser';
import { parsePdfFile } from './pdfParser';

/**
 * Deep Module interface for parsing any book file (TXT, EPUB, PDF).
 * Hides all library dynamic script loading, encoding detection, DOM parsing, and Canvas snapshot generation.
 */
export const parseBookFile = async (file: File): Promise<BookData> => {
  const fileName = file.name.toLowerCase();
  const fileId = generateId(`${file.name}-${file.size}`);

  let parsed: Partial<BookData> = {};

  if (fileName.endsWith('.epub')) {
    parsed = await parseEpubFile(file);
  } else if (fileName.endsWith('.pdf')) {
    parsed = await parsePdfFile(file);
  } else {
    parsed = await parseTxtFile(file);
  }

  return {
    id: fileId,
    title: parsed.title || file.name.replace(/\.[^/.]+$/, ""),
    author: parsed.author || 'Unknown',
    content: parsed.content || '',
    chapters: parsed.chapters || [],
    currentPageIndex: 0,
    lastReadAt: Date.now(),
    coverImage: parsed.coverImage,
    pdfArrayBuffer: parsed.pdfArrayBuffer,
    pageCount: parsed.pageCount,
    format: parsed.format || 'txt',
  };
};

export { parseTxtFile, parseChapters } from './txtParser';
export { parseEpubFile, ensureEpubLibrariesLoaded } from './epubParser';
export { parsePdfFile, ensurePdfLibraryLoaded } from './pdfParser';
