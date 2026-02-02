import React, { useState, useEffect, useRef } from 'react';
import { Bookshelf } from './components/Bookshelf';
import { ReaderView } from './components/ReaderView';
import { ControlPanel } from './components/ControlPanel';
import { BookData, ReaderSettings, Chapter } from './types';
import { DEFAULT_SETTINGS, THEME_COLORS } from './constants';
import { parseChapters, parseEpub, parsePdf, generateId, extractMetadata, scanDirectoryForFiles } from './utils';
import { initDB, saveBook, getAllBooks, updateBookProgress, deleteBook, saveDirectoryHandle, getDirectoryHandle } from './db';
import { verifyPermission, readSyncFile, writeSyncFile, SyncState } from './fsHelpers';
import { Locale } from './locales';

const App: React.FC = () => {
  // Application State
  const [view, setView] = useState<'shelf' | 'reader'>('shelf');
  const [books, setBooks] = useState<BookData[]>([]);
  const [activeBook, setActiveBook] = useState<BookData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Sync State
  const [syncHandle, setSyncHandle] = useState<any | null>(null);
  const [syncFolderName, setSyncFolderName] = useState<string | null>(null);
  const [isSyncConnected, setIsSyncConnected] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');

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

        // Check for persisted sync handle
        const handle = await getDirectoryHandle();
        if (handle) {
          setSyncHandle(handle);
          setSyncFolderName(handle.name);
          // We assume connected for UI, but actual reads need permission verification
          // which happens on user interaction or first sync attempt.
        }
      } catch (e) {
        console.error("Failed to load database", e);
      } finally {
        setIsLoading(false);
      }
    };
    init();
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

  // --- AUTOMATIC SYNC LOGIC (Debounced) ---
  useEffect(() => {
    // Only run if we are fully connected and have a handle
    if (!isSyncConnected || !syncHandle) return;

    const performSync = async () => {
      setSyncStatus('syncing');
      try {
         // Verify permission silently first (usually cached by browser session)
         // If permission is lost, this might fail, which is expected.
         const hasPerm = await verifyPermission(syncHandle, false); 
         if (!hasPerm) {
             setSyncStatus('error'); // Permission lost in background
             return;
         }

         await syncStateToDisk(syncHandle, books, settings);
         setSyncStatus('success');
         // Clear success message after 3s
         setTimeout(() => setSyncStatus((prev) => prev === 'success' ? 'idle' : prev), 3000);
      } catch (error) {
         console.error("Auto-sync failed:", error);
         setSyncStatus('error');
      }
    };

    // Debounce 1 second for snappier feeling while avoiding disk thrashing
    const timer = setTimeout(performSync, 1000);
    return () => clearTimeout(timer);

  }, [books, settings, isSyncConnected, syncHandle]);


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
      
      try {
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
        };
        
        return newBook;
  
      } catch (err) {
        console.error(`Failed to import book: ${file.name}`, err);
        return null;
      }
  };

  // Central helper to write sync file
  const syncStateToDisk = async (handle: any, currentBooks: BookData[], currentSettings: ReaderSettings) => {
      try {
          const progressMap: Record<string, { pageIndex: number; lastReadAt: number }> = {};
          currentBooks.forEach(b => {
              progressMap[b.id] = { pageIndex: b.currentPageIndex, lastReadAt: b.lastReadAt };
          });

          const syncData: SyncState = {
              updatedAt: Date.now(),
              settings: currentSettings,
              progress: progressMap
          };

          await writeSyncFile(handle, syncData);
      } catch (e) {
          console.error("Background sync write failed", e);
          throw e; // Propagate for handling
      }
  };

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
                  // Already exists, don't overwrite unless we want to update content
                  console.log(`Book ${book.title} exists, skipping content overwrite.`);
               } else {
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
           if (importedCount > 0 && !isSyncConnected) {
              // Only alert if manual import (not sync scan)
              alert(`Successfully imported ${importedCount} books.`);
           }
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
     // Legacy scan folder (read-only scan)
     try {
       // @ts-ignore
       if (window.showDirectoryPicker) {
           // @ts-ignore
           const dirHandle = await window.showDirectoryPicker();
           setIsLoading(true);
           const files = await scanDirectoryForFiles(dirHandle);
           setIsLoading(false);
           await handleBooksImport(files);
           return true; // Success
       }
     } catch (err) {
        // If security error (iframe) or user cancelled, we return false to fallback
        console.warn("Import folder failed (falling back to input):", err);
     } finally {
        setIsLoading(false);
     }
     return false; // Fallback required
  };

  // --- CORE SYNC LOGIC ---

  const performConnectAndSync = async (dirHandle: any) => {
      try {
          setIsLoading(true);
          setSyncStatus('syncing');

          // 1. Verify Permission (Prompt User if needed)
          const granted = await verifyPermission(dirHandle, true);
          if (!granted) {
              alert("Permission denied to access the sync folder. Please try again.");
              setSyncStatus('error');
              return;
          }

          // 2. Save Handle & Info
          setSyncHandle(dirHandle);
          setSyncFolderName(dirHandle.name);
          await saveDirectoryHandle(dirHandle);
          
          // --- SYNC PHASE 1: READ REMOTE ---
          
          // A. Read Sync State JSON
          const remoteState = await readSyncFile(dirHandle);
          
          // B. Scan for Book Files in Folder
          const files = await scanDirectoryForFiles(dirHandle);
          
          // C. Import any new books found in the folder
          await handleBooksImport(files);

          // --- SYNC PHASE 2: MERGE STATE ---
          const currentAllBooks = await getAllBooks();
          let stateChanged = false;

          if (remoteState) {
              // Merge Settings (Remote wins if valid, or we could do timestamp based if we tracked it)
              // For simplicity: If remote has settings, apply them.
              if (remoteState.settings) {
                  setSettings(prev => ({ ...prev, ...remoteState.settings }));
                  stateChanged = true;
              }

              // Merge Progress
              if (remoteState.progress) {
                  for (const book of currentAllBooks) {
                      const remoteProg = remoteState.progress[book.id];
                      if (remoteProg) {
                          // Rule: If Remote is newer, take Remote.
                          // If Local is newer, keep Local (it will overwrite remote in Phase 3)
                          if (remoteProg.lastReadAt > book.lastReadAt || book.currentPageIndex === 0) {
                              book.currentPageIndex = remoteProg.pageIndex;
                              book.lastReadAt = remoteProg.lastReadAt;
                              await updateBookProgress(book.id, book.currentPageIndex);
                              stateChanged = true;
                          }
                      }
                  }
              }
          }

          // Update React State if merged
          if (stateChanged) {
             const reloaded = await getAllBooks();
             setBooks(reloaded);
             
             // --- SYNC PHASE 3: WRITE BACK (Merged State) ---
             // We write the *freshly merged* state back to disk immediately
             // so the cloud file is up to date with this device's latest changes too.
             await syncStateToDisk(dirHandle, reloaded, remoteState?.settings ? { ...settings, ...remoteState.settings } : settings);
          } else {
             // No changes from remote, but we should overwrite remote with our current state 
             // to ensure it's initialized if it was empty.
             await syncStateToDisk(dirHandle, currentAllBooks, settings);
             setBooks(currentAllBooks);
          }
          
          // Done
          setIsSyncConnected(true);
          setSyncStatus('success');
          // alert("Sync Connected! Your library is now staying in sync with this folder.");

      } catch (err) {
          console.error("Sync Logic Error", err);
          alert("Failed to sync with the selected folder.");
          setSyncStatus('error');
          setIsSyncConnected(false);
      } finally {
          setIsLoading(false);
          setTimeout(() => setSyncStatus(prev => prev === 'success' ? 'idle' : prev), 3000);
      }
  };

  const handleConnectSyncFolder = async () => {
      // 0. Compatibility Check
      if (!('showDirectoryPicker' in window)) {
         alert("Sync Feature Not Supported in this Browser.\n\nDue to Apple's security restrictions, Safari does not support the File System Access API required for real-time sync.\n\nPlease use Chrome, Edge, or Opera on Desktop for this feature.\n\nYou can still use the 'Import' button to add files manually.");
         return;
      }

      try {
          // 1. Pick Folder
          // @ts-ignore
          const dirHandle = await window.showDirectoryPicker({
              mode: 'readwrite',
              id: 'zenreader-sync'
          });

          // 2. Execute Sync Logic
          await performConnectAndSync(dirHandle);

      } catch (err) {
          // Handle specific errors
          if ((err as Error).name === 'AbortError') return; // User cancelled
          
          if ((err as Error).name === 'SecurityError' || (err as any).code === 18) {
              alert("Security Restriction: Sync cannot run in an iframe or cross-origin context. Please open the app in a full browser tab.");
          } else {
              alert(`Connection Failed: ${(err as Error).message}`);
          }
          setSyncStatus('error');
      }
  };

  const handleReconnectSync = async () => {
     if (syncHandle) {
         // Reusing the handle will trigger permission prompt if permission is gone (e.g. refresh)
         await performConnectAndSync(syncHandle);
     }
  };

  const handleManualSync = async () => {
      if (!syncHandle) {
          // If no handle, treat as "Connect First Time"
          await handleConnectSyncFolder();
      } else {
          // If handle exists, reuse it (will trigger permission prompt if needed)
          await performConnectAndSync(syncHandle);
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

    const validPageIndex = Math.min(book.currentPageIndex, maxIndex);

    // Prepare book state
    const updatedBook = { ...book, chapters, currentPageIndex: validPageIndex, lastReadAt: Date.now() };
    setActiveBook(updatedBook);
    
    // Update DB immediately for read timestamp
    await updateBookProgress(book.id, validPageIndex);
    
    // Update 'books' state which triggers the Auto-Sync useEffect
    setBooks(prevBooks => prevBooks.map(b => b.id === book.id ? updatedBook : b));

    setView('reader');
  };

  const handleDeleteBooks = async (ids: string[], deleteLocal: boolean) => {
    setIsLoading(true);
    try {
      // 1. Delete from Local File System (if sync connected and requested)
      if (deleteLocal && syncHandle) {
         let deletedCount = 0;
         for (const id of ids) {
            const book = books.find(b => b.id === id);
            if (book && book.filename) {
               try {
                 // @ts-ignore
                 await syncHandle.removeEntry(book.filename);
                 deletedCount++;
               } catch(e) { 
                  console.warn(`Could not delete local file for ${book.title}`, e); 
               }
             }
         }
         if (deletedCount > 0) {
             console.log(`Deleted ${deletedCount} local files.`);
         }
      }

      // 2. Delete from DB
      for (const id of ids) {
        await deleteBook(id);
      }
      
      // 3. Refresh State
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
          onConnectSync={handleConnectSyncFolder}
          onManualSync={handleManualSync}
          onReconnectSync={handleReconnectSync}
          hasSavedSync={!!syncHandle}
          isSyncConnected={isSyncConnected}
          syncFolderName={syncFolderName}
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
    </div>
  );
};

export default App;
