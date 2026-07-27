import { BookData } from '../../types';
import {
  initDB,
  saveBook as saveBookToDB,
  getAllBooks as getAllBooksFromDB,
  updateBookProgress as updateProgressInDB,
  deleteBook as deleteBookFromDB,
  getDirectoryHandle,
  saveDirectoryHandle
} from '../../db';
import {
  computeFileHash,
  pushProgress,
  pullProgress,
  syncAllProgress,
  fetchAllProgress,
  createBookLink,
  type LocalBookForSync,
  type CloudProgress
} from '../../cloudSync';

/**
 * Deep Module: BookRepository
 * Hides IndexedDB, Supabase cloud sync, file hash generation, and conflict merging
 * behind a unified repository interface.
 */
export class BookRepository {
  /**
   * Initializes local database.
   */
  static async init(): Promise<void> {
    await initDB();
  }

  /**
   * Fetches all books from local IndexedDB storage.
   */
  static async getAllBooks(): Promise<BookData[]> {
    return await getAllBooksFromDB();
  }

  /**
   * Saves or updates a book in local storage.
   */
  static async saveBook(book: BookData): Promise<void> {
    await saveBookToDB(book);
  }

  /**
   * Updates page index & timestamp for a specific book.
   */
  static async updateProgress(id: string, pageIndex: number): Promise<void> {
    await updateProgressInDB(id, pageIndex);
  }

  /**
   * Deletes a book from local storage.
   */
  static async deleteBook(id: string): Promise<void> {
    await deleteBookFromDB(id);
  }

  /**
   * Computes SHA-256 hash for a file.
   */
  static async computeHash(file: File): Promise<string> {
    return await computeFileHash(file);
  }

  /**
   * Performs full bidirectional cloud sync for all books with file hashes.
   */
  static async syncAll(userId: string): Promise<{ updatedCount: number }> {
    const books = await this.getAllBooks();
    const booksWithHash = books.filter(b => b.fileHash);

    if (booksWithHash.length === 0) {
      return { updatedCount: 0 };
    }

    const localForSync: LocalBookForSync[] = booksWithHash.map(b => ({
      fileHash: b.fileHash!,
      title: b.title,
      author: b.author,
      currentPageIndex: b.currentPageIndex,
      totalPages: b.pdfArrayBuffer
        ? (b.pageCount || 1)
        : Math.max(1, b.chapters?.length || 1),
      lastReadAt: b.lastReadAt,
    }));

    const result = await syncAllProgress(userId, localForSync);

    let updatedCount = 0;
    for (const remoteItem of result.pulled) {
      const localBook = books.find(b => b.fileHash === remoteItem.file_hash);
      if (localBook && remoteItem.last_read_at > localBook.lastReadAt) {
        localBook.currentPageIndex = remoteItem.current_page_index;
        localBook.lastReadAt = remoteItem.last_read_at;
        await this.saveBook(localBook);
        updatedCount++;
      }
    }

    return { updatedCount };
  }

  /**
   * Links two book hashes together for cross-device sync.
   */
  static async linkBookProgress(userId: string, sourceHash: string, targetHash: string): Promise<boolean> {
    return await createBookLink(userId, sourceHash, targetHash);
  }

  /**
   * Exports all local books and reading progress to a JSON backup blob.
   */
  static async exportBackup(): Promise<void> {
    const books = await this.getAllBooks();
    const backupData = {
      version: 1,
      exportedAt: Date.now(),
      books: books.map(b => ({
        id: b.id,
        title: b.title,
        author: b.author,
        currentPageIndex: b.currentPageIndex,
        lastReadAt: b.lastReadAt,
        fileHash: b.fileHash,
        format: b.format,
      })),
    };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ZenReader-Backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Imports reading progress from a JSON backup file.
   */
  static async importBackup(file: File): Promise<number> {
    const text = await file.text();
    const backup = JSON.parse(text);

    if (!backup.books || !Array.isArray(backup.books)) {
      throw new Error("Invalid backup format");
    }

    const currentBooks = await this.getAllBooks();
    let updatedCount = 0;

    for (const item of backup.books) {
      const match = currentBooks.find(b => (item.fileHash && b.fileHash === item.fileHash) || b.id === item.id);

      if (match) {
        if (item.lastReadAt > match.lastReadAt) {
          match.currentPageIndex = item.currentPageIndex;
          match.lastReadAt = item.lastReadAt;
          await this.saveBook(match);
          updatedCount++;
        }
      }
    }

    return updatedCount;
  }

  static async getDirectoryHandle(): Promise<any> {
    return await getDirectoryHandle();
  }

  static async saveDirectoryHandle(handle: any): Promise<void> {
    await saveDirectoryHandle(handle);
  }
}
