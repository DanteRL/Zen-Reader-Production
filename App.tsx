import React, { useState, useEffect, useCallback } from 'react';
import { Bookshelf } from './components/Bookshelf';
import { ReaderView } from './components/ReaderView';
import { ControlPanel } from './components/ControlPanel';
import { BookData, ReaderSettings, ThemeType } from './types';
import { DEFAULT_SETTINGS, THEME_COLORS } from './constants';
import { scanDirectoryForFiles } from './utils';
import { parseBookFile } from './services/parsers';
import { BookRepository } from './services/repository/bookRepository';
import { ThemeService } from './services/themeService';
import { Locale } from './locales';
import { isSupabaseConfigured, onAuthStateChange, initAuth, type Session, type User } from './supabase';
import { pushProgress, pullProgress, type CloudProgress } from './cloudSync';
import { LinkProgressModal } from './components/LinkProgressModal';

const App: React.FC = () => {
  // Application State
  const [view, setView] = useState<'shelf' | 'reader'>('shelf');
  const [books, setBooks] = useState<BookData[]>([]);
  const [activeBook, setActiveBook] = useState<BookData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Cloud Sync State
  const [cloudUser, setCloudUser] = useState<User | null>(null);
  const [isSyncConnected, setIsSyncConnected] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [showLinkModal, setShowLinkModal] = useState<{ bookId: string; bookHash: string; bookTitle: string } | null>(null);
  const [cloudProgressList, setCloudProgressList] = useState<CloudProgress[]>([]);

  const [settings, setSettings] = useState<ReaderSettings>(() => {
    const saved = localStorage.getItem('zenreader-settings');
    const parsed = saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...parsed };
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const getLocale = (): Locale => {
    if (settings.language === 'auto') {
      return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    }
    return settings.language as Locale;
  };
  const currentLocale = getLocale();

  // Initialize DB and load books
  useEffect(() => {
    const init = async () => {
      try {
        await BookRepository.init();
        const loadedBooks = await BookRepository.getAllBooks();
        setBooks(loadedBooks);
      } catch (e) {
        console.error("Failed to load database", e);
      } finally {
        setIsLoading(false);
      }
    };
    init();
  }, []);

  // Initialize Supabase auth in background
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    initAuth().catch(e => console.error('[Auth] initAuth failed:', e));
  }, []);

  // Supabase auth state listener
  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const reloadAndSync = async (userId: string) => {
      try {
        setSyncStatus('syncing');
        const { updatedCount } = await BookRepository.syncAll(userId);
        const reloadedBooks = await BookRepository.getAllBooks();
        setBooks(reloadedBooks);
        setSyncStatus('success');
        setTimeout(() => setSyncStatus('idle'), 3000);
      } catch (e) {
        console.error('[Auth] Sync failed:', e);
        setSyncStatus('error');
      }
    };

    const { data } = onAuthStateChange(async (session: Session | null) => {
      const user = session?.user || null;
      setCloudUser(user);
      setIsSyncConnected(!!user);

      if (user) {
        await reloadAndSync(user.id);
      } else {
        setSyncStatus('idle');
      }
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  // Apply Settings & Theme
  useEffect(() => {
    localStorage.setItem('zenreader-settings', JSON.stringify(settings));

    let appliedBg = '';
    if (view === 'reader') {
      appliedBg = THEME_COLORS[settings.theme].bg;
      document.body.style.backgroundColor = appliedBg;
    } else {
      appliedBg = THEME_COLORS[ThemeType.LIGHT].uiBg || THEME_COLORS[settings.theme].bg;
      document.body.style.backgroundColor = appliedBg;
    }
  }, [settings, view]);

  // Dynamic accent color derived from active book cover
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (view !== 'reader') {
        document.documentElement.style.removeProperty('--zenreader-accent');
        return;
      }

      const cover = activeBook?.coverImage;
      const accent = await ThemeService.computeAccentColor(cover);
      if (cancelled) return;

      if (accent) {
        document.documentElement.style.setProperty('--zenreader-accent', accent);
      } else {
        const fallback = THEME_COLORS[settings.theme].bg || THEME_COLORS[ThemeType.LIGHT].uiBg;
        document.documentElement.style.setProperty('--zenreader-accent', fallback);
      }
    })();

    return () => { cancelled = true; };
  }, [activeBook?.coverImage, view, settings.theme]);

  // Auto-push progress on changes (Debounced)
  useEffect(() => {
    if (!isSyncConnected || !cloudUser) return;

    const performPush = async () => {
      if (!activeBook || !activeBook.fileHash) return;

      setSyncStatus('syncing');
      try {
        const totalPages = activeBook.pdfArrayBuffer
          ? (activeBook.pageCount || 1)
          : Math.max(1, activeBook.chapters?.length || 1);

        const ok = await pushProgress(cloudUser.id, {
          file_hash: activeBook.fileHash,
          book_title: activeBook.title,
          author: activeBook.author,
          current_page_index: activeBook.currentPageIndex,
          total_pages: totalPages,
          last_read_at: activeBook.lastReadAt,
        });

        setSyncStatus(ok ? 'success' : 'error');
        if (ok) {
          setTimeout(() => setSyncStatus(prev => prev === 'success' ? 'idle' : prev), 3000);
        }
      } catch (error) {
        console.error("[CloudSync] Auto-push failed:", error);
        setSyncStatus('error');
      }
    };

    const timer = setTimeout(performPush, 1500);
    return () => clearTimeout(timer);
  }, [activeBook?.currentPageIndex, activeBook?.lastReadAt, isSyncConnected, cloudUser]);

  // Bulk import handler
  const handleBooksImport = async (files: File[]) => {
    if (files.length === 0) return;

    setIsLoading(true);

    const validFiles = files.filter(f => {
      const name = f.name.toLowerCase();
      return name.endsWith('.txt') || name.endsWith('.epub') || name.endsWith('.pdf');
    });

    try {
      const currentBooks = [...books];
      let hasChanges = false;

      for (const file of validFiles) {
        const book = await parseBookFile(file);
        book.fileHash = await BookRepository.computeHash(file);

        const existingIndex = currentBooks.findIndex(b => b.id === book.id);

        if (existingIndex >= 0) {
          if (!currentBooks[existingIndex].fileHash && book.fileHash) {
            currentBooks[existingIndex].fileHash = book.fileHash;
            await BookRepository.saveBook(currentBooks[existingIndex]);
            hasChanges = true;
          }
        } else {
          if (cloudUser && book.fileHash) {
            try {
              const cloudProg = await pullProgress(cloudUser.id, book.fileHash);
              if (cloudProg && cloudProg.last_read_at > 0) {
                book.currentPageIndex = cloudProg.current_page_index;
                book.lastReadAt = cloudProg.last_read_at;
              }
            } catch (e) {
              console.warn('[CloudSync] Failed to pull progress on import:', e);
            }
          }

          await BookRepository.saveBook(book);
          currentBooks.push(book);
          hasChanges = true;
        }
      }

      if (hasChanges) {
        const updatedBooks = await BookRepository.getAllBooks();
        setBooks(updatedBooks);
      }
    } catch (err) {
      console.error("Bulk import error", err);
      alert("An error occurred during import.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportBook = async (file: File) => {
    await handleBooksImport([file]);
  };

  const handleImportFolder = async (): Promise<boolean> => {
    try {
      // @ts-ignore
      if (window.showDirectoryPicker) {
        // @ts-ignore
        const dirHandle = await window.showDirectoryPicker();
        setIsLoading(true);
        const files = await scanDirectoryForFiles(dirHandle);
        setIsLoading(false);
        await handleBooksImport(files);
        return true;
      }
      return false;
    } catch (err: any) {
      setIsLoading(false);
      if (err.name !== 'AbortError') {
        console.error("Folder import error:", err);
      }
      return false;
    }
  };

  const handleOpenBook = async (book: BookData) => {
    let activeCopy = { ...book, lastReadAt: Date.now() };

    if (isSyncConnected && cloudUser && activeCopy.fileHash) {
      try {
        const cloudProg = await pullProgress(cloudUser.id, activeCopy.fileHash);
        if (cloudProg && cloudProg.last_read_at > activeCopy.lastReadAt) {
          activeCopy.currentPageIndex = cloudProg.current_page_index;
          activeCopy.lastReadAt = cloudProg.last_read_at;
        }
      } catch (e) {
        console.warn('[CloudSync] Failed to pull progress on open:', e);
      }
    }

    setActiveBook(activeCopy);
    setView('reader');
    await BookRepository.saveBook(activeCopy);

    const updated = await BookRepository.getAllBooks();
    setBooks(updated);
  };

  const handleCloseBook = async () => {
    if (activeBook) {
      await BookRepository.saveBook(activeBook);

      if (isSyncConnected && cloudUser && activeBook.fileHash) {
        const totalPages = activeBook.pdfArrayBuffer
          ? (activeBook.pageCount || 1)
          : Math.max(1, activeBook.chapters?.length || 1);

        pushProgress(cloudUser.id, {
          file_hash: activeBook.fileHash,
          book_title: activeBook.title,
          author: activeBook.author,
          current_page_index: activeBook.currentPageIndex,
          total_pages: totalPages,
          last_read_at: activeBook.lastReadAt,
        }).catch(e => console.error('[CloudSync] Push on close failed:', e));
      }
    }
    setActiveBook(null);
    setView('shelf');
    const updated = await BookRepository.getAllBooks();
    setBooks(updated);
  };

  const handlePageChange = async (newPageIndex: number) => {
    if (!activeBook) return;

    const updatedBook = {
      ...activeBook,
      currentPageIndex: newPageIndex,
      lastReadAt: Date.now(),
    };

    setActiveBook(updatedBook);
    setBooks(prev => prev.map(b => b.id === updatedBook.id ? updatedBook : b));

    await BookRepository.updateProgress(updatedBook.id, newPageIndex);
  };

  const handleDeleteBook = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to remove this book from your shelf?')) {
      await BookRepository.deleteBook(id);
      const updated = await BookRepository.getAllBooks();
      setBooks(updated);
      if (activeBook?.id === id) {
        setActiveBook(null);
        setView('shelf');
      }
    }
  };

  const handleManualSync = async () => {
    if (!cloudUser) return;

    setSyncStatus('syncing');
    try {
      const { updatedCount } = await BookRepository.syncAll(cloudUser.id);
      const updated = await BookRepository.getAllBooks();
      setBooks(updated);

      if (activeBook) {
        const refreshedActive = updated.find(b => b.id === activeBook.id);
        if (refreshedActive) setActiveBook(refreshedActive);
      }

      setSyncStatus('success');
      setTimeout(() => setSyncStatus('idle'), 3000);
    } catch (e) {
      console.error('[ManualSync] Failed:', e);
      setSyncStatus('error');
    }
  };

  const handleLinkProgress = async (sourceHash: string, targetHash: string) => {
    if (!cloudUser) return;

    try {
      const ok = await BookRepository.linkBookProgress(cloudUser.id, sourceHash, targetHash);
      if (ok) {
        setShowLinkModal(null);
        await handleManualSync();
      } else {
        alert('Failed to link books. Please try again.');
      }
    } catch (e) {
      console.error('[LinkProgress] Error:', e);
      alert('Failed to link books.');
    }
  };

  const handleExportBackup = async () => {
    await BookRepository.exportBackup();
  };

  const handleRestoreBackup = async (file: File) => {
    try {
      setIsLoading(true);
      const count = await BookRepository.importBackup(file);
      const updated = await BookRepository.getAllBooks();
      setBooks(updated);
      alert(`Backup restored successfully. Updated ${count} books.`);
    } catch (e: any) {
      alert(`Failed to restore backup: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen font-sans antialiased text-gray-900 bg-gray-50 dark:bg-zinc-900 dark:text-gray-100 transition-colors duration-200">
      {view === 'shelf' ? (
        <Bookshelf
          books={books}
          onOpenBook={handleOpenBook}
          onImportBook={handleImportBook}
          onImportFolder={handleImportFolder}
          onDeleteBook={handleDeleteBook}
          onOpenSettings={() => setIsSettingsOpen(true)}
          isLoading={isLoading}
          settings={settings}
          language={currentLocale}
          isSyncConnected={isSyncConnected}
          syncStatus={syncStatus}
          cloudUserEmail={cloudUser?.email}
          onConnectSync={() => {
            if (isSyncConnected) {
              handleManualSync();
            }
          }}
          onLinkClick={(book) => {
            if (book.fileHash) {
              setShowLinkModal({
                bookId: book.id,
                bookHash: book.fileHash,
                bookTitle: book.title,
              });
            }
          }}
        />
      ) : (
        activeBook && (
          <ReaderView
            book={activeBook}
            settings={settings}
            onPageChange={handlePageChange}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onCloseBook={handleCloseBook}
            onToggleFocusMode={() => setSettings(s => ({ ...s, focusMode: !s.focusMode }))}
            onUpdateSettings={(newSettings) => setSettings(s => ({ ...s, ...newSettings }))}
            syncStatus={syncStatus}
            isSyncConnected={isSyncConnected}
            language={currentLocale}
          />
        )
      )}

      <ControlPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={(newSettings) => setSettings(s => ({ ...s, ...newSettings }))}
        language={currentLocale}
        onExportBackup={handleExportBackup}
        onRestoreBackup={handleRestoreBackup}
      />


      {showLinkModal && (
        <LinkProgressModal
          isOpen={true}
          onClose={() => setShowLinkModal(null)}
          bookTitle={showLinkModal.bookTitle}
          bookHash={showLinkModal.bookHash}
          availableProgressList={cloudProgressList}
          onLink={(targetHash) => handleLinkProgress(showLinkModal.bookHash, targetHash)}
          language={currentLocale}
        />
      )}
    </div>
  );
};

export default App;
