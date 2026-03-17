

export enum ThemeType {
  LIGHT = 'light',
  SEPIA = 'sepia',
  DARK = 'dark',
}

export enum FontFamily {
  SANS = 'sans',
  SERIF = 'serif',
  ELEGANT = 'elegant',
  MONO = 'mono',
  // Chinese Fonts
  SONGTI = 'songti', // 宋体
  HEITI = 'heiti',   // 黑体
  KAITI = 'kaiti',   // 楷体
}

export type AILanguage = 'auto' | 'zh' | 'en';
export type AppLanguage = 'auto' | 'zh' | 'en';

export type PdfViewMode = 'scroll' | 'single' | 'double';
export type PdfFitMode = 'width' | 'height' | 'manual';

export interface ReaderSettings {
  language: AppLanguage; // Interface language
  theme: ThemeType;
  fontSize: number;
  lineHeight: number;
  fontFamily: FontFamily;
  maxWidth: number;
  textAlign: 'left' | 'justify';
  autoHideControls: boolean;
  autoHideDuration: number; // seconds
  focusMode: boolean; 
  focusParagraphCount: number; // Number of paragraphs to highlight
  aiMode: boolean; // New AI Companion Mode
  aiLanguage: AILanguage; // Language for AI definitions
  apiKey?: string; // User provided API Key for Gemini
  
  // PDF Specific
  pdfViewMode: PdfViewMode;
  pdfScale: number; // 1.0 = 100%
  pdfFitMode: PdfFitMode;
  
  // Text Conversion
  textConversion: 'none' | 'cn2tw' | 'tw2cn';
}

export interface Chapter {
  title: string;
  content: string;
  pageNumber?: number; // For PDF, 1-based page number indicating start of chapter
}

export interface BookData {
  id: string; // Unique ID for database
  title: string;
  author?: string; // Extracted author name
  publisher?: string; // Extracted publisher name
  content: string; // The full text content
  chapters: Chapter[]; // Structured chapters (title + content)
  currentPageIndex: number; // For TXT/EPUB: Chapter Index. For PDF: Page Index (0-based)
  createdAt: number;
  lastReadAt: number;
  coverImage?: string; // Base64 string for the cover
  pdfArrayBuffer?: ArrayBuffer; // Stored PDF binary for native rendering
  pageCount?: number; // Total pages for PDF
  filename?: string; // Original filename for file system operations
  fileHash?: string; // SHA-256 hash for cross-device sync
}

export interface AIEntityData {
  term: string;
  definition: string;
}