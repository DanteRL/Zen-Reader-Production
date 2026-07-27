# ZenReader Web Domain & Architectural Context

This document captures the domain model and key architectural **Deep Modules** in `zenreader-web`.

## Domain Concepts

- **BookData**: The primary entity representing a loaded e-book (TXT, EPUB, or PDF), including metadata (Title, Author, Cover), progress (`currentPageIndex`, `lastReadAt`), and format-specific structures.
- **Chapter**: A logical division within a book containing a title, raw content, and optional HTML/href formatting.
- **CloudProgress**: A lightweight sync record containing file hash, title, current page, total pages, and last read timestamp for cross-device synchronization.

## Deep Modules & Architectural Seams

### 1. `BookRepository` (`services/repository/bookRepository.ts`)
- **Seam**: Sits between the UI components (`App.tsx`, `Bookshelf`, `ReaderView`) and local/remote persistence stores.
- **Interface**: Exposes clean async operations: `init()`, `getAllBooks()`, `saveBook()`, `updateProgress()`, `deleteBook()`, `syncAll()`, `exportBackup()`, `importBackup()`.
- **Implementation**: Encapsulates raw IndexedDB database operations (`db.ts`), SHA-256 hash generation (`computeFileHash`), Supabase RLS API requests (`cloudSync.ts`), and conflict resolution (Last-Write-Wins).

### 2. `BookParser` (`services/parsers/index.ts`)
- **Seam**: Sits between raw file imports (`File`) and internal domain objects (`BookData`).
- **Interface**: Exposes a single entry point: `parseBookFile(file: File): Promise<BookData>`.
- **Implementation**: Hides format-specific strategies:
  - `txtParser.ts`: UTF-8/GBK encoding fallback, intelligent regex chapter splitting (`第x章`, `Chapter X`), metadata extraction.
  - `epubParser.ts`: Dynamic CDN loading of JSZip/ePub.js, DOM HTML parsing, cover extraction, data URL image converting.
  - `pdfParser.ts`: Dynamic CDN loading of PDF.js, worker setup, off-screen `<canvas>` cover generation, outline/TOC extraction.

### 3. `AIService` (`services/aiService.ts`)
- **Seam**: Sits between UI context menus and LLM APIs.
- **Interface**: Exposes `explainTerm(term, contextText, targetLang)` for AI term explanations.
- **Implementation**: Encapsulates `@google/genai` Gemini SDK initialization, prompt engineering, and JSON response parsing.

### 4. `TextConverter` (`services/textConverter.ts`)
- **Seam**: Sits between text rendering components and Chinese text conversion engines.
- **Interface**: Exposes `convert(text, mode: 's2t' | 't2s' | 'original')`.
- **Implementation**: Encapsulates and caches OpenCC converter instances.

### 5. `ThemeService` (`services/themeService.ts`)
- **Seam**: Sits between settings/book covers and DOM styling.
- **Interface**: Exposes `applyTheme(themeName)` and `computeAccentColor(imageUrl)`.
- **Implementation**: Directly handles DOM `<meta name="theme-color">` updates, class toggling, and off-screen `<canvas>` pixel sampling.
