

import { Chapter } from './types';

/**
 * Legacy pagination logic (fallback).
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
 * Intelligent Chapter Parser.
 * Detects patterns like "第x章" to split content.
 */
export const parseChapters = (text: string): Chapter[] => {
  // Regex to match common Chinese chapter headers at start of line
  // Matches: 第1章, 第一章, 第100节, Chapter 1, etc.
  const chapterRegex = /(?:^|\n)\s*(#{1,3}\s+)?(第[0-9零一二三四五六七八九十百千]+[章回节卷]|Chapter\s+\d+|[A-Z][a-z]+(\s+[A-Z][a-z]+)*).*/g;
  
  const matches = [...text.matchAll(chapterRegex)];
  
  // If we find too few chapters (e.g., < 3), it might not be a novel, or formatting is weird.
  // In that case, we fallback to splitting by length but treat them as "Pages".
  if (matches.length < 2) {
    const RAW_CHARS_PER_PAGE = 5000; // Larger chunks for "chapter" view
    const rawPages = paginateText(text, RAW_CHARS_PER_PAGE);
    return rawPages.map((content, index) => ({
      title: `Page ${index + 1}`,
      content
    }));
  }

  const chapters: Chapter[] = [];
  
  // Handle preamble (text before first chapter)
  if (matches[0].index! > 0) {
    chapters.push({
      title: 'Preface / Start',
      content: text.substring(0, matches[0].index!).trim()
    });
  }

  // Iterate through matches
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const startIndex = match.index!;
    const endIndex = i < matches.length - 1 ? matches[i + 1].index! : text.length;
    
    const fullSection = text.substring(startIndex, endIndex);
    // Clean up title: remove Markdown hashes if present
    const title = match[0].replace(/^[#\s]+/, '').trim().split('\n')[0]; 
    
    // We keep full section so the reader sees the title in the text body too
    chapters.push({
      title: title,
      content: fullSection 
    });
  }

  return chapters;
};

// Helper to dynamically load scripts if they are missing
const loadScript = (src: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve(); // Already loaded or loading
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
};

export const ensureEpubLibrariesLoaded = async () => {
  // Check for JSZip
  if (!(window as any).JSZip) {
    console.log('Loading JSZip...');
    await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
  }
  // Check for ePub
  if (!(window as any).ePub) {
    console.log('Loading ePub...');
    await loadScript('https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js');
    // Give it a small tick to initialize global var
    await new Promise(r => setTimeout(r, 100));
  }
};

export const ensurePdfLibraryLoaded = async () => {
  if (!(window as any).pdfjsLib) {
    console.log('Loading PDF.js...');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    
    // Wait for library to attach
    await new Promise(r => setTimeout(r, 100));
    
    // Setup worker
    const pdfjsLib = (window as any).pdfjsLib;
    if (pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
  } else {
    // Ensure worker is set even if script was already loaded
    const pdfjsLib = (window as any).pdfjsLib;
    if (pdfjsLib && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
  }
};

/**
 * Parses an EPUB file and extracts text chapters and cover image.
 * Uses epub.js (via CDN).
 */
export const parseEpub = async (file: File): Promise<{ chapters: Chapter[], coverImage?: string, author?: string }> => {
  // Ensure libraries are present before proceeding
  await ensureEpubLibrariesLoaded();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target?.result;
        if (!arrayBuffer) {
          reject("Empty file");
          return;
        }

        // Access global ePub safely from window
        const ePubLib = (window as any).ePub;
        if (!ePubLib) {
          throw new Error("EPUB library failed to initialize.");
        }

        // Initialize ePub book with ArrayBuffer
        const book = ePubLib(arrayBuffer);
        await book.ready;

        // Extract metadata
        const metadata = await book.loaded.metadata;
        const author = metadata.creator || metadata.publisher;

        // 1. Extract Chapters
        const chapters: Chapter[] = [];
        
        // Iterate through the spine items directly
        const spineItems = book.spine.items;
        
        for (const item of spineItems) {
           if (!item.href) continue;

           // Use book.load() instead of item.load() to avoid "is not a function" errors
           // book.load(href) resolves to the document/content
           const doc = await book.load(item.href);
           
           // If it's a document object, we extract text
           let text = '';
           if (typeof doc === 'string') {
             // Sometimes it returns raw HTML string
             const parser = new DOMParser();
             const htmlDoc = parser.parseFromString(doc, 'text/html');
             text = htmlDoc.body.textContent || '';
           } else if (doc instanceof Document) {
             text = doc.body.textContent || '';
           } else if (doc && doc.textContent) {
             text = doc.textContent;
           }

           // Cleanup whitespace
           text = text.trim();
           
           // Basic filter to ignore empty/utility files
           if (text.length > 50) { 
             // Try to find a title from TOC or fallback
             let title = "Chapter";
             // Note: book.navigation might not be fully populated immediately without checking
             const navItem = book.navigation?.toc?.find((n: any) => n.href && item.href && n.href.includes(item.href));
             
             if (navItem) {
               title = navItem.label.trim();
             } else {
               // Fallback: try to grab first line
               const firstLine = text.split('\n')[0].substring(0, 50);
               if (firstLine.length > 0 && firstLine.length < 50) title = firstLine;
             }

             chapters.push({
               title: title,
               content: text
             });
           }
        }

        // 2. Extract Cover
        let coverImage: string | undefined;
        try {
          const coverUrl = await book.coverUrl();
          if (coverUrl) {
            // book.coverUrl() might return a blob URL or internal URL
            // We need to fetch it to store it
            const response = await fetch(coverUrl);
            const blob = await response.blob();
            // Convert to base64 for storage
            coverImage = await new Promise((resolve) => {
              const r = new FileReader();
              r.onloadend = () => resolve(r.result as string);
              r.readAsDataURL(blob);
            });
          }
        } catch (coverErr) {
          console.warn("Could not extract cover image", coverErr);
        }
        
        if (chapters.length === 0) {
          reject("No readable text content found in EPUB");
          return;
        }

        resolve({ chapters, coverImage, author });
      } catch (err) {
        console.error("EPUB Parse Error", err);
        reject(err);
      }
    };
    reader.onerror = () => reject("Error reading file");
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Native PDF Parsing.
 * Returns the raw ArrayBuffer, page count, and extracts TOC.
 */
export const parsePdf = async (file: File): Promise<{ content: string, pdfArrayBuffer: ArrayBuffer, coverImage?: string, author?: string, title?: string, pageCount: number, chapters: Chapter[] }> => {
  await ensurePdfLibraryLoaded();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target?.result;
        if (!arrayBuffer || !(arrayBuffer instanceof ArrayBuffer)) {
          reject("Invalid PDF file data");
          return;
        }

        const pdfjsLib = (window as any).pdfjsLib;
        
        // CRITICAL: Clone buffer for PDF.js.
        const bufferForPdf = arrayBuffer.slice(0);
        
        const loadingTask = pdfjsLib.getDocument(new Uint8Array(bufferForPdf));
        const pdf = await loadingTask.promise;
        const pageCount = pdf.numPages;

        let fullText = '';
        let author = '';
        let docTitle = '';
        let coverImage = undefined;
        let chapters: Chapter[] = [];

        // 1. Get Metadata
        try {
          const metadata = await pdf.getMetadata();
          if (metadata && metadata.info) {
            author = metadata.info.Author || '';
            docTitle = metadata.info.Title || '';
          }
        } catch (metaErr) {
          console.warn("PDF metadata extraction failed", metaErr);
        }

        // 2. Generate Cover (Page 1)
        try {
          const page1 = await pdf.getPage(1);
          const viewport = page1.getViewport({ scale: 1.0 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          if (context) {
            await page1.render({ canvasContext: context, viewport: viewport }).promise;
            coverImage = canvas.toDataURL('image/jpeg', 0.8);
          }
        } catch (coverErr) {
          console.warn("PDF cover generation failed", coverErr);
        }

        // 3. Extract Outline (TOC)
        try {
          const outline = await pdf.getOutline();
          if (outline && outline.length > 0) {
             const processOutlineItem = async (item: any): Promise<Chapter | null> => {
                 let pageIndex = 0;
                 try {
                     // Resolve destination to page index
                     let dest = item.dest;
                     if (typeof dest === 'string') {
                         dest = await pdf.getDestination(dest);
                     }
                     if (Array.isArray(dest)) {
                         const ref = dest[0];
                         // getPageIndex returns 0-based index
                         pageIndex = await pdf.getPageIndex(ref);
                     }
                 } catch (e) { console.warn("Could not resolve outline destination", e); }
                 
                 return {
                     title: item.title,
                     content: '', // Empty for PDF
                     pageNumber: pageIndex + 1 // Convert to 1-based for UI consistency
                 };
             };

             // We only process top-level items for now to keep it simple, 
             // or flat map the tree. Let's flatten one level.
             for (const item of outline) {
                 const chapter = await processOutlineItem(item);
                 if (chapter) {
                    chapters.push(chapter);
                    if (item.items && item.items.length > 0) {
                        for (const subItem of item.items) {
                             const subChapter = await processOutlineItem(subItem);
                             if (subChapter) {
                                 subChapter.title = "  " + subChapter.title; // Indent
                                 chapters.push(subChapter);
                             }
                        }
                    }
                 }
             }
          }
        } catch (tocErr) {
            console.warn("PDF Outline extraction failed", tocErr);
        }

        // If no chapters/outline found, we default to no chapters (user navigates by page)
        // or we could create dummy chapters for every 10 pages? 
        // Better to just have an empty chapter list and let Reader handle page-only nav.
        if (chapters.length === 0) {
             chapters = [{ title: "Full Document", content: "", pageNumber: 1 }];
        }

        // 4. Simple Text Extraction (for search/indexing only)
        const maxPagesToExtract = Math.min(pdf.numPages, 10);
        
        for (let i = 1; i <= maxPagesToExtract; i++) {
           try {
             const page = await pdf.getPage(i);
             const textContent = await page.getTextContent();
             const pageText = textContent.items.map((item: any) => item.str).join(' ');
             fullText += pageText + "\n\n";
           } catch (e) {}
        }
        
        if (pdf.numPages > 10) {
            fullText += "\n...[Remaining PDF text not indexed for performance]...";
        }

        resolve({ 
            content: fullText, 
            pdfArrayBuffer: arrayBuffer, 
            coverImage, 
            author, 
            title: docTitle,
            pageCount,
            chapters
        });

      } catch (err) {
        console.error("PDF Parse Error", err);
        reject(err);
      }
    };
    reader.onerror = () => reject("Error reading PDF file");
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Attempts to extract metadata (Author, Title, Publisher) from the first 1000 characters of a TXT file.
 */
export const extractMetadata = (text: string): { author?: string, title?: string, publisher?: string } => {
  const snippet = text.slice(0, 1000);
  const result: { author?: string, title?: string, publisher?: string } = {};
  
  // 1. Extract Author
  const authorPatterns = [
    /(?:作者|Author|writer)[:：]\s*([^\n\r]+)/i,
    /(?:著|By)[:：]\s*([^\n\r]+)/i,
    /^\s*([^\n\r]+)\s*(?:著|作)\s*$/m // Matches a line ending with "著" or "作"
  ];

  for (const pattern of authorPatterns) {
    const match = snippet.match(pattern);
    if (match && match[1]) {
      result.author = match[1].trim();
      break;
    }
  }

  // 2. Extract Title (Explicit)
  const titlePatterns = [
    /(?:书名|Title|Name)[:：]\s*([^\n\r]+)/i,
    /《([^》]+)》/ // Matches text inside Chinese book marks
  ];

  for (const pattern of titlePatterns) {
    const match = snippet.match(pattern);
    if (match && match[1]) {
      result.title = match[1].trim();
      break;
    }
  }

  // 3. Extract Publisher
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
 * Generates an ID.
 * If seed is provided (e.g. filename + filesize), generates a deterministic hash.
 * This allows multiple devices to recognize the same file as the same book ID.
 */
export const generateId = (seed?: string): string => {
  if (seed) {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      const char = seed.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    // Return a base36 string of the absolute hash, padded to be reasonably safe
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
    // Iterate through directory entries
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file') {
        const file = await entry.getFile();
        const name = file.name.toLowerCase();
        if (name.endsWith('.txt') || name.endsWith('.epub') || name.endsWith('.pdf')) {
          files.push(file);
        }
      } else if (entry.kind === 'directory') {
        // Recursively scan subdirectories
        const subFiles = await scanDirectoryForFiles(entry);
        files.push(...subFiles);
      }
    }
  } catch (err) {
    console.warn("Error scanning directory:", err);
  }
  
  return files;
};
