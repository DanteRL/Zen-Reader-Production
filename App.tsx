import React, { useState, useEffect, useCallback } from 'react';
import { Bookshelf } from './components/Bookshelf';
import { ReaderView } from './components/ReaderView';
import { ControlPanel } from './components/ControlPanel';
import { BookData, ReaderSettings, Chapter } from './types';
import { DEFAULT_SETTINGS, THEME_COLORS } from './constants';
import { parseChapters, parseEpub, parsePdf, generateId, extractMetadata, scanDirectoryForFiles } from './utils';
import { initDB, saveBook, getAllBooks, updateBookProgress, deleteBook } from './db';
import { Locale } from './locales';
import { isSupabaseConfigured, onAuthStateChange, getCurrentUser, signOut, signInWithGitHub, signInWithGoogle, signInWithEmail, type Session, type User } from './supabase';
import { computeFileHash, pushProgress, pullProgress, syncAllProgress, fetchAllProgress, createBookLink, type CloudProgress, type LocalBookForSync } from './cloudSync';
import { LoginModal } from './components/LoginModal';
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
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState<{ bookId: string; bookHash: string; bookTitle: string } | null>(null);
  const [cloudProgressList, setCloudProgressList] = useState<CloudProgress[]>([]);

  const [settings, setSettings] = useState<ReaderSettings>(() => {
    const saved = localStorage.getItem('zenreader-settings');
    const parsed = saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
    // Ensure new settings fields exist
    return { ...DEFAULT_SETTINGS, ...parsed };
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Determine current locale
  const getLocale = (): Locale => {
    if (settings.language === 'auto') {
      // Simple detection: if user agent string starts with zh, use zh. Else en.
      return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    }
    return settings.language as Locale;
  };
  const currentLocale = getLocale();

  // Initialize DB and load books
  useEffect(() => {
    const init = async () => {
      try {
        await initDB();
        const loadedBooks = await getAllBooks();
        setBooks(loadedBooks);
      } catch (e) {
        console.error("Failed to load database", e);
      } finally {
        setIsLoading(false);
      }
    };
    init();
  }, []);

  // Listen for Supabase auth state changes
  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const { data } = onAuthStateChange(async (session: Session | null) => {
      const user = session?.user || null;
      setCloudUser(user);
      setIsSyncConnected(!!user);
      
      if (user) {
        // CRITICAL: Reload books after login to prevent state issues
        // This ensures the book list is preserved after auth state change
        try {
          const reloadedBooks = await getAllBooks();
          setBooks(reloadedBooks);
          console.log(`[Auth] Logged in, reloaded ${reloadedBooks.length} books`);
        } catch (e) {
          console.error('[Auth] Failed to reload books after login:', e);
        }
      } else {
        // User logged out - clear sync state
        setSyncStatus('idle');
        console.log('[Auth] Logged out, sync state cleared');
        // Note: We DON'T clear books - they should remain in local storage
      }
    });

    // Check initial session
    getCurrentUser().then(async user => {
      if (user) {
        setCloudUser(user);
        setIsSyncConnected(true);
        // Also reload books on initial session check
        try {
          const reloadedBooks = await getAllBooks();
          setBooks(reloadedBooks);
        } catch (e) {
          console.error('[Auth] Failed to reload books on initial session:', e);
        }
      }
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  // Sync Settings to LocalStorage (Immediate)
  useEffect(() => {
    localStorage.setItem('zenreader-settings', JSON.stringify(settings));
    
    // Only apply theme to body if in reader mode, otherwise use default gray for shelf
    if (view === 'reader') {
      document.body.style.backgroundColor = THEME_COLORS[settings.theme].bg;
    } else {
       document.body.style.backgroundColor = THEME_COLORS.light.uiBg; // Default shelf bg
    }
  }, [settings, view]);

  // --- CLOUD SYNC: Auto-push progress on changes (Debounced) ---
  useEffect(() => {
    if (!isSyncConnected || !cloudUser) return;

    const performPush = async () => {
      // Only push the active book's progress if we're in the reader
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


  const processFile = async (file: File): Promise<BookData | null> => {
      // Default title from filename
      let title = file.name.replace(/\.(txt|epub|pdf)$/i, '');
      let content = '';
      let chapters: Chapter[] = [];
      let coverImage: string | undefined;
      let author: string | undefined;
      let publisher: string | undefined;
      let pdfArrayBuffer: ArrayBuffer | undefined;
      let pageCount: number | undefined;
      let fileHash: string | undefined;
      
      try {
        // Compute file hash for cross-device sync
        fileHash = await computeFileHash(file);

        const lowerName = file.name.toLowerCase();
  
        if (lowerName.endsWith('.epub')) {
          // Parse EPUB
          const result = await parseEpub(file);
          chapters = result.chapters;
          coverImage = result.coverImage;
          author = result.author;
          content = chapters.map(c => c.content).join('\n\n'); 
        } else if (lowerName.endsWith('.pdf')) {
          // Parse PDF
          const result = await parsePdf(file);
          content = result.content;
          coverImage = result.coverImage;
          pdfArrayBuffer = result.pdfArrayBuffer;
          pageCount = result.pageCount;
          chapters = result.chapters;

          if (result.author) author = result.author;
          if (result.title && result.title.trim().length > 0) title = result.title;
        } else {
          // Parse TXT with Smart Encoding Detection
          const buffer = await file.arrayBuffer();
          try {
            // Try UTF-8 first
            const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
            content = utf8Decoder.decode(buffer);
          } catch (e) {
            // Fallback to GBK for common Chinese files
            const gbkDecoder = new TextDecoder('gbk');
            content = gbkDecoder.decode(buffer);
          }
          
          // Normalize newlines
          content = content.replace(/\r\n/g, '\n');
          
          // Extract Metadata from first 1000 chars
          const metadata = extractMetadata(content);
          if (metadata.author) author = metadata.author;
          if (metadata.publisher) publisher = metadata.publisher;
          if (metadata.title && metadata.title.length < 50) {
            title = metadata.title;
          }
          
          chapters = parseChapters(content);
        }

        // GENERATE DETERMINISTIC ID based on filename + size
        // This ensures the same file on two devices gets the same ID.
        const idSeed = `${file.name}_${file.size}`;
        const id = generateId(idSeed);
  
        const newBook: BookData = {
          id: id,
          title: title,
          author: author,
          publisher: publisher,
          content: content,
          chapters: chapters,
          currentPageIndex: 0,
          createdAt: Date.now(),
          lastReadAt: Date.now(),
          coverImage: coverImage,
          pdfArrayBuffer: pdfArrayBuffer,
          pageCount: pageCount,
          filename: file.name, // Store original filename for sync operations
          fileHash: fileHash, // SHA-256 hash for cross-device sync
        };
        
        return newBook;
  
      } catch (err) {
        console.error(`Failed to import book: ${file.name}`, err);
        return null;
      }
  };

  // Central cloud sync helper: push progress for a single book
  const pushBookProgress = useCallback(async (book: BookData) => {
    if (!cloudUser || !book.fileHash) return;
    const totalPages = book.pdfArrayBuffer
      ? (book.pageCount || 1)
      : Math.max(1, book.chapters?.length || 1);
    
    await pushProgress(cloudUser.id, {
      file_hash: book.fileHash,
      book_title: book.title,
      author: book.author,
      current_page_index: book.currentPageIndex,
      total_pages: totalPages,
      last_read_at: book.lastReadAt,
    });
  }, [cloudUser]);

  // Bulk import handler
  const handleBooksImport = async (files: File[]) => {
    if (files.length === 0) return;
    
    setIsLoading(true);
    let importedCount = 0;
    
    // Filter supported files
    const validFiles = files.filter(f => {
       const name = f.name.toLowerCase();
       return name.endsWith('.txt') || name.endsWith('.epub') || name.endsWith('.pdf');
    });

    try {
        const newBooks = [...books];
        let hasChanges = false;

        for (const file of validFiles) {
            const book = await processFile(file);
            
            if (book) {
               // Check if book exists by ID (deterministic now)
               const existingIndex = newBooks.findIndex(b => b.id === book.id);

               if (existingIndex >= 0) {
                  // Already exists — update fileHash if it was missing
                  if (!newBooks[existingIndex].fileHash && book.fileHash) {
                    newBooks[existingIndex].fileHash = book.fileHash;
                    await saveBook(newBooks[existingIndex]);
                    hasChanges = true;
                  }
                  console.log(`Book ${book.title} exists, skipping content overwrite.`);
               } else {
                  // New book — check cloud for existing progress (auto-track)
                  if (cloudUser && book.fileHash) {
                    try {
                      const cloudProg = await pullProgress(cloudUser.id, book.fileHash);
                      if (cloudProg && cloudProg.last_read_at > 0) {
                        book.currentPageIndex = cloudProg.current_page_index;
                        book.lastReadAt = cloudProg.last_read_at;
                        console.log(`[CloudSync] Auto-restored progress for "${book.title}" from cloud.`);
                      }
                    } catch (e) {
                      console.warn('[CloudSync] Failed to pull progress on import:', e);
                    }
                  }

                  await saveBook(book);
                  newBooks.push(book);
                  importedCount++;
                  hasChanges = true;
               }
            }
        }
        
        if (hasChanges) {
           const updatedBooks = await getAllBooks();
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
     } catch (err) {
        console.warn("Import folder failed (falling back to input):", err);
     } finally {
        setIsLoading(false);
     }
     return false;
  };

  // --- CLOUD SYNC LOGIC ---

  const handleLogin = () => {
    if (!isSupabaseConfigured()) {
      alert("Cloud Sync is not configured.\n\nPlease set SUPABASE_URL and SUPABASE_ANON_KEY in your environment.");
      return;
    }
    setShowLoginModal(true);
  };

  const handleLogout = async () => {
    try {
      await signOut();
      // Don't manually set state here - let onAuthStateChange handle it
      // This prevents race conditions and ensures proper cleanup
      console.log('[Auth] Signed out successfully');
    } catch (err) {
      console.error('[Auth] Logout failed:', err);
      alert('退出登录失败，请重试');
    }
  };

  const handleManualSync = async () => {
    if (!cloudUser) {
      handleLogin();
      return;
    }

    setSyncStatus('syncing');
    try {
      // Build local book list for sync
      const currentBooks = await getAllBooks();
      const localForSync: LocalBookForSync[] = currentBooks
        .filter(b => b.fileHash)
        .map(b => ({
          fileHash: b.fileHash!,
          title: b.title,
          author: b.author,
          currentPageIndex: b.currentPageIndex,
          totalPages: b.pdfArrayBuffer
            ? (b.pageCount || 1)
            : Math.max(1, b.chapters?.length || 1),
          lastReadAt: b.lastReadAt,
        }));

      const result = await syncAllProgress(cloudUser.id, localForSync);

      // Apply pulled progress locally
      if (result.pulled.length > 0) {
        for (const pulled of result.pulled) {
          const localBook = currentBooks.find(b => b.fileHash === pulled.fileHash);
          if (localBook) {
            localBook.currentPageIndex = pulled.pageIndex;
            localBook.lastReadAt = pulled.lastReadAt;
            await updateBookProgress(localBook.id, pulled.pageIndex);
          }
        }
        const reloaded = await getAllBooks();
        setBooks(reloaded);
      }

      setSyncStatus('success');
      console.log(`[CloudSync] Sync complete: pulled=${result.pulled.length}, pushed=${result.pushed}, errors=${result.errors}`);
      setTimeout(() => setSyncStatus(prev => prev === 'success' ? 'idle' : prev), 3000);
    } catch (err) {
      console.error("[CloudSync] Manual sync failed:", err);
      setSyncStatus('error');
    }
  };

  // --- LINK PROGRESS (Manual Track) ---

  const handleOpenLinkModal = async (bookId: string) => {
    if (!cloudUser) {
      handleLogin();
      return;
    }
    const book = books.find(b => b.id === bookId);
    if (!book || !book.fileHash) {
      alert("This book doesn't have a file hash. Please re-import it.");
      return;
    }
    
    // Fetch all cloud progress entries for the user
    const allProgress = await fetchAllProgress(cloudUser.id);
    // Filter out the current book's own hash
    const filtered = allProgress.filter(p => p.file_hash !== book.fileHash);
    setCloudProgressList(filtered);
    setShowLinkModal({ bookId: book.id, bookHash: book.fileHash, bookTitle: book.title });
  };

  const handleLinkProgress = async (targetHash: string) => {
    if (!cloudUser || !showLinkModal) return;

    try {
      // 1. Create the link
      const ok = await createBookLink(cloudUser.id, showLinkModal.bookHash, targetHash);
      if (!ok) {
        alert("Failed to create link.");
        return;
      }

      // 2. Pull progress from the target
      const cloudProg = await pullProgress(cloudUser.id, showLinkModal.bookHash);
      if (cloudProg) {
        const localBook = books.find(b => b.id === showLinkModal.bookId);
        if (localBook) {
          localBook.currentPageIndex = cloudProg.current_page_index;
          localBook.lastReadAt = cloudProg.last_read_at;
          await updateBookProgress(localBook.id, cloudProg.current_page_index);
          
          const reloaded = await getAllBooks();
          setBooks(reloaded);
        }
      }

      setShowLinkModal(null);
    } catch (err) {
      console.error("[CloudSync] Link progress failed:", err);
      alert("Failed to link progress.");
    }
  };

  const handleExportBackup = async () => {
    try {
      setIsLoading(true);
      const allBooks = await getAllBooks();
      
      // Create lightweight backup (Metadata Only)
      const backupData = allBooks.map(book => ({
        id: book.id,
        title: book.title,
        author: book.author,
        publisher: book.publisher,
        currentPageIndex: book.currentPageIndex,
        lastReadAt: book.lastReadAt,
        createdAt: book.createdAt,
        pageCount: book.pageCount,
        content: undefined, 
        chapters: undefined,
        coverImage: undefined,
        pdfArrayBuffer: undefined,
        filename: book.filename
      }));
      
      const json = JSON.stringify(backupData, null, 2);
      
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toISOString().split('T')[0];
      a.download = `zenreader_metadata_backup_${date}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Export failed", error);
      alert("Failed to export data.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestoreBackup = async (file: File) => {
    setIsLoading(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const json = e.target?.result as string;
        const backupBooks = JSON.parse(json);
        
        if (!Array.isArray(backupBooks)) {
          throw new Error("Invalid backup format");
        }

        const currentBooks = await getAllBooks();
        // Create a map for fast lookup by ID
        const bookMap = new Map(currentBooks.map(b => [b.id, b]));

        let updatedCount = 0;
        let olderCount = 0;
        let skippedCount = 0;

        for (const backupBook of backupBooks) {
           if (!backupBook.id) continue;

           const localBook = bookMap.get(backupBook.id);

           if (localBook) {
             // Smart Merge: Only update if backup has newer progress
             const backupTime = backupBook.lastReadAt || 0;
             const localTime = localBook.lastReadAt || 0;

             if (backupTime > localTime) {
                localBook.currentPageIndex = backupBook.currentPageIndex ?? localBook.currentPageIndex;
                localBook.lastReadAt = backupTime;
                // We trust the backup's progress, but keep local content
                await saveBook(localBook);
                updatedCount++;
             } else {
                olderCount++;
             }
           } else {
             // If local book doesn't exist, we CANNOT restore it because the backup
             // is metadata-only (doesn't contain content/chapters).
             skippedCount++;
           }
        }

        const updatedBooks = await getAllBooks();
        setBooks(updatedBooks);
        
        let msg = `Restore Complete.\n\nUpdated: ${updatedCount} books (newer progress found).`;
        if (olderCount > 0) msg += `\nSkipped: ${olderCount} books (local progress is newer).`;
        if (skippedCount > 0) msg += `\nSkipped: ${skippedCount} books (missing local content file).`;
        
        alert(msg);
      } catch (err) {
        console.error("Restore failed", err);
        alert("Failed to restore backup. Invalid file format.");
      } finally {
        setIsLoading(false);
      }
    };
    reader.readAsText(file);
  };

  const handleOpenBook = async (book: BookData) => {
    // Check if chapters are parsed. If not (old data), parse them now.
    let chapters = book.chapters;
    if (!chapters || chapters.length === 0) {
      chapters = parseChapters(book.content);
    }

    const maxIndex = book.pdfArrayBuffer 
       ? (book.pageCount ? book.pageCount - 1 : 0)
       : Math.max(0, chapters.length - 1);

    let validPageIndex = Math.min(book.currentPageIndex, maxIndex);

    // --- Auto-Track: Pull cloud progress if hash is available ---
    if (cloudUser && book.fileHash) {
      try {
        const cloudProg = await pullProgress(cloudUser.id, book.fileHash);
        if (cloudProg && cloudProg.last_read_at > book.lastReadAt) {
          validPageIndex = Math.min(cloudProg.current_page_index, maxIndex);
          console.log(`[CloudSync] Auto-restored progress for "${book.title}" from cloud (page ${validPageIndex}).`);
        }
      } catch (e) {
        console.warn('[CloudSync] Failed to pull progress on open:', e);
      }
    }

    // Prepare book state
    const updatedBook = { ...book, chapters, currentPageIndex: validPageIndex, lastReadAt: Date.now() };
    setActiveBook(updatedBook);
    
    // Update DB immediately for read timestamp
    await updateBookProgress(book.id, validPageIndex);
    
    // Update 'books' state which triggers the Auto-Sync useEffect
    setBooks(prevBooks => prevBooks.map(b => b.id === book.id ? updatedBook : b));

    setView('reader');
  };

  const handleDeleteBooks = async (ids: string[]) => {
    setIsLoading(true);
    try {
      // Delete from DB
      for (const id of ids) {
        await deleteBook(id);
      }
      
      // Refresh State
      const updatedBooks = await getAllBooks();
      setBooks(updatedBooks);
    } catch (err) {
      console.error("Batch delete failed", err);
      alert("Error deleting books.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateSettings = (newSettings: Partial<ReaderSettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
    // Auto-sync useEffect will handle the sync
  };

  const handlePageChange = async (pageIndex: number) => {
    if (activeBook) {
      const updatedBook = { ...activeBook, currentPageIndex: pageIndex, lastReadAt: Date.now() };
      setActiveBook(updatedBook);
      
      // Persist progress to DB
      await updateBookProgress(activeBook.id, pageIndex);
      
      // Update local books state (THIS TRIGGERS THE AUTO-SYNC EFFECT)
      setBooks(prevBooks => prevBooks.map(b => b.id === activeBook.id ? updatedBook : b));
    }
  };

  const handleCloseBook = async () => {
    setView('shelf');
    setActiveBook(null);
    const updatedBooks = await getAllBooks();
    setBooks(updatedBooks);
  };

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="animate-pulse flex flex-col items-center">
        <div className="w-12 h-12 bg-gray-200 rounded-full mb-4"></div>
        <div className="h-4 w-32 bg-gray-200 rounded"></div>
        <p className="mt-4 text-gray-500 text-sm">Loading Library...</p>
      </div>
    </div>;
  }

  return (
    <div className={`min-h-screen transition-colors duration-300`}>
      {view === 'shelf' ? (
        <Bookshelf 
          books={books}
          onImportBook={handleImportBook}
          onImportFiles={handleBooksImport}
          onImportFolder={handleImportFolder}
          onExportBackup={handleExportBackup}
          onRestoreBackup={handleRestoreBackup}
          onOpenBook={handleOpenBook}
          onDeleteBooks={handleDeleteBooks}
          onLogin={handleLogin}
          onLogout={handleLogout}
          onManualSync={handleManualSync}
          onLinkProgress={handleOpenLinkModal}
          cloudUser={cloudUser}
          isSyncConnected={isSyncConnected}
          syncStatus={syncStatus}
          language={currentLocale}
        />
      ) : activeBook ? (
        <>
          <ReaderView 
            book={activeBook}
            settings={settings}
            onPageChange={handlePageChange}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onCloseBook={handleCloseBook}
            onToggleFocusMode={() => handleUpdateSettings({ focusMode: !settings.focusMode })}
            onUpdateSettings={handleUpdateSettings}
            syncStatus={syncStatus}
            isSyncConnected={isSyncConnected}
            language={currentLocale}
          />
          <ControlPanel 
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            currentTheme={settings.theme}
            isPdf={!!activeBook.pdfArrayBuffer}
            language={currentLocale}
          />
        </>
      ) : null}

      {/* Login Modal */}
      {showLoginModal && (
        <LoginModal 
          onClose={() => setShowLoginModal(false)} 
          language={currentLocale}
        />
      )}

      {/* Link Progress Modal */}
      {showLinkModal && (
        <LinkProgressModal
          bookTitle={showLinkModal.bookTitle}
          progressList={cloudProgressList}
          onLink={handleLinkProgress}
          onClose={() => setShowLinkModal(null)}
          language={currentLocale}
        />
      )}
    </div>
  );
};

export default App;
