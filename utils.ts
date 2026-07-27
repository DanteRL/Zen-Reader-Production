import { Chapter } from './types';
export {
  parseBookFile,
  parseChapters,
  parseEpubFile as parseEpub,
  parsePdfFile as parsePdf,
  ensureEpubLibrariesLoaded,
  ensurePdfLibraryLoaded
} from './services/parsers';

export { extractMetadata } from './services/parsers/txtParser';

/**
 * Fallback pagination logic.
 * Splits text by character count.
 */
export const paginateText = (text: string, charsPerPage: number): string[] => {
  const pages: string[] = [];
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

  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  return pages;
};

/**
 * Calculates reading progress percentage
 */
export const calculateProgress = (currentPage: number, totalPages: number): number => {
  if (totalPages === 0) return 0;
  return Math.round(((currentPage + 1) / totalPages) * 100);
};

/**
 * Generates an ID.
 * If seed is provided (e.g. filename + filesize), generates a deterministic hash.
 */
export const generateId = (seed?: string): string => {
  if (seed) {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      const char = seed.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36).padEnd(8, 'x') + seed.length.toString(36);
  }
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

// Colors for generated covers
const COVER_GRADIENTS = [
  'from-blue-400 to-blue-600',
  'from-emerald-400 to-emerald-600',
  'from-amber-400 to-amber-600',
  'from-rose-400 to-rose-600',
  'from-indigo-400 to-indigo-600',
  'from-violet-400 to-violet-600',
  'from-cyan-400 to-cyan-600',
  'from-slate-500 to-slate-700',
];

/**
 * Returns a consistent gradient style based on the string.
 */
export const getBookCoverStyle = (title: string): string => {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = title.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % COVER_GRADIENTS.length;
  return `bg-gradient-to-br ${COVER_GRADIENTS[index]}`;
};

/**
 * Recursively scans a directory handle for supported book files.
 */
export const scanDirectoryForFiles = async (dirHandle: any): Promise<File[]> => {
  const files: File[] = [];

  try {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file') {
        const file = await entry.getFile();
        const name = file.name.toLowerCase();
        if (name.endsWith('.txt') || name.endsWith('.epub') || name.endsWith('.pdf')) {
          files.push(file);
        }
      } else if (entry.kind === 'directory') {
        const subFiles = await scanDirectoryForFiles(entry);
        files.push(...subFiles);
      }
    }
  } catch (err) {
    console.warn("Error scanning directory:", err);
  }

  return files;
};
