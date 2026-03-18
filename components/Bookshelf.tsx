import React, { useRef, useState, useEffect } from 'react';
import { Plus, Search, Trash2, FolderInput, Download, ChevronDown, FileText, FileUp, FileDown, Cloud, RefreshCw, Check, Folder, Library, X, CloudOff, Loader2, CheckCircle2, AlertCircle, LogIn, LogOut, Link2, User as UserIcon } from 'lucide-react';
import { BookData } from '../types';
import { calculateProgress } from '../utils';
import { translations, Locale } from '../locales';
import type { User } from '../supabase';

interface BookshelfProps {
  books: BookData[];
  onOpenBook: (book: BookData) => void;
  onImportBook: (file: File) => void;
  onImportFiles: (files: File[]) => void;
  onImportFolder: () => Promise<boolean>;
  onExportBackup: () => void;
  onRestoreBackup: (file: File) => void;
  onDeleteBooks: (ids: string[]) => void;
  onLogin: () => void;
  onLogout: () => void;
  onManualSync: () => void;
  onLinkProgress: (bookId: string) => void;
  cloudUser: User | null;
  isSyncConnected: boolean;
  syncStatus?: 'idle' | 'syncing' | 'success' | 'error';
  language: Locale;
}

const TABS_KEYS = ['tab_default', 'tab_recent', 'tab_progress', 'tab_title', 'tab_length'] as const;

export const Bookshelf: React.FC<BookshelfProps> = ({ 
  books, 
  onOpenBook, 
  onImportFiles,
  onImportFolder,
  onExportBackup,
  onRestoreBackup,
  onDeleteBooks,
  onLogin,
  onLogout,
  onManualSync,
  onLinkProgress,
  cloudUser,
  isSyncConnected,
  syncStatus = 'idle',
  language
}) => {
  const t = translations[language];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  
  const syncMenuRef = useRef<HTMLDivElement>(null);
  const importMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  
  // Selection State
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [initialSelection, setInitialSelection] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionBox, setSelectionBox] = useState<{ startX: number, startY: number, currentX: number, currentY: number } | null>(null);

  // Delete Modal State
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [idsToDelete, setIdsToDelete] = useState<string[]>([]);
  
  const [activeTabKey, setActiveTabKey] = useState<typeof TABS_KEYS[number]>('tab_default');
  const [searchQuery, setSearchQuery] = useState('');
  const [isHoveringId, setIsHoveringId] = useState<string | null>(null);
  const [activeMenu, setActiveMenu] = useState<'import' | 'export' | 'sync' | null>(null);
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        importMenuRef.current && !importMenuRef.current.contains(event.target as Node) &&
        exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node) &&
        syncMenuRef.current && !syncMenuRef.current.contains(event.target as Node)
      ) {
        setActiveMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredBooks = books.filter(book => 
    book.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sortedBooks = [...filteredBooks].sort((a, b) => {
    if (activeTabKey === 'tab_progress') {
      const progA = calculateProgress(a.currentPageIndex, a.chapters?.length || 1);
      const progB = calculateProgress(b.currentPageIndex, b.chapters?.length || 1);
      return progB - progA;
    }
    if (activeTabKey === 'tab_recent') {
      return b.lastReadAt - a.lastReadAt;
    }
    if (activeTabKey === 'tab_title') {
      return a.title.localeCompare(b.title, language === 'zh' ? 'zh-CN' : 'en');
    }
    if (activeTabKey === 'tab_length') {
      return b.content.length - a.content.length;
    }
    return b.createdAt - a.createdAt;
  });

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onImportFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFolderInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onImportFiles(Array.from(e.target.files));
    }
    if (e.target) e.target.value = '';
  };

  const handleScanFolderClick = async () => {
    setActiveMenu(null);
    let success = false;
    // @ts-ignore
    if (window.showDirectoryPicker) {
      success = await onImportFolder();
    } 
    if (!success) {
      folderInputRef.current?.click();
    }
  };

  // --- MOUSE SELECTION LOGIC ---
  const handleMouseDown = (e: React.MouseEvent) => {
    const isWrapper = e.target === wrapperRef.current;
    const isSelectionZone = (e.target as HTMLElement).classList?.contains('selection-zone');

    if (isWrapper || isSelectionZone) {
      e.preventDefault();
      setIsSelecting(true);
      
      const startX = e.clientX;
      const startY = e.clientY;
      setSelectionBox({ startX, startY, currentX: startX, currentY: startY });

      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        setInitialSelection(new Set(selectedIds));
      } else {
        setInitialSelection(new Set());
        setSelectedIds(new Set());
      }
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isSelecting || !selectionBox) return;
    
    setSelectionBox(prev => prev ? ({ ...prev, currentX: e.clientX, currentY: e.clientY }) : null);
    
    const left = Math.min(selectionBox.startX, e.clientX);
    const top = Math.min(selectionBox.startY, e.clientY);
    const width = Math.abs(e.clientX - selectionBox.startX);
    const height = Math.abs(e.clientY - selectionBox.startY);
    const selectRect = { left, top, right: left + width, bottom: top + height };

    const nextSelection = new Set(initialSelection);
    
    const booksElements = document.querySelectorAll('[data-book-id]');
    booksElements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        const id = el.getAttribute('data-book-id');
        if (!id) return;

        const isIntersecting = !(rect.right < selectRect.left || 
                               rect.left > selectRect.right || 
                               rect.bottom < selectRect.top || 
                               rect.top > selectRect.bottom);
        
        if (isIntersecting) {
            nextSelection.add(id);
        }
    });

    setSelectedIds(nextSelection);
  };

  const handleMouseUp = () => {
    setIsSelecting(false);
    setSelectionBox(null);
  };

  useEffect(() => {
    if (isSelecting) {
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('mousemove', handleMouseMove);
    }
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [isSelecting, selectionBox, initialSelection]); 

  const toggleSelection = (id: string, multi: boolean) => {
    const newSet = new Set(multi ? selectedIds : []);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  // --- DELETE LOGIC ---
  const requestDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    
    if (selectedIds.has(id)) {
       setIdsToDelete(Array.from(selectedIds));
    } else {
       setIdsToDelete([id]);
    }
    
    setShowDeleteModal(true);
  };

  const confirmDelete = () => {
    onDeleteBooks(idsToDelete);
    setShowDeleteModal(false);
    setSelectedIds(new Set());
    setIdsToDelete([]);
  };

  const showSyncButton = true;

  const selectionStyle: React.CSSProperties | undefined = selectionBox ? {
    position: 'fixed',
    left: Math.min(selectionBox.startX, selectionBox.currentX),
    top: Math.min(selectionBox.startY, selectionBox.currentY),
    width: Math.abs(selectionBox.currentX - selectionBox.startX),
    height: Math.abs(selectionBox.currentY - selectionBox.startY),
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    border: '1px solid rgba(59, 130, 246, 0.5)',
    pointerEvents: 'none',
    zIndex: 9999
  } : undefined;

  // Icon Logic
  const getSyncIcon = () => {
    if (!isSyncConnected) return <CloudOff className="w-4 h-4 text-gray-400" />;
    if (syncStatus === 'syncing') return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
    if (syncStatus === 'success') return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    if (syncStatus === 'error') return <AlertCircle className="w-4 h-4 text-red-500" />;
    return <Cloud className="w-4 h-4 text-blue-600" />;
  };

  return (
    <div 
      ref={wrapperRef}
      className="min-h-screen bg-[#FBFBFD] text-gray-900 font-sans select-none"
      onMouseDown={handleMouseDown}
    >
      {/* Selection Box Visual */}
      {isSelecting && selectionBox && <div style={selectionStyle} />}

      {/* Delete Modal */}
      {showDeleteModal && (
         <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setShowDeleteModal(false)} />
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 relative z-10 animate-in fade-in zoom-in-95 duration-200">
               <h3 className="text-lg font-bold text-gray-900 mb-2">{t.delete_confirm_title}</h3>
               <p className="text-gray-600 text-sm mb-6">
                 {t.delete_confirm_msg} <span className="font-bold text-gray-900">{idsToDelete.length}</span> {t.delete_confirm_suffix}
               </p>

               <div className="flex gap-3">
                 <button 
                   onClick={() => setShowDeleteModal(false)}
                   className="flex-1 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
                 >
                   {t.cancel}
                 </button>
                 <button 
                   onClick={confirmDelete}
                   className="flex-1 px-4 py-2 rounded-lg bg-red-500 text-white font-medium hover:bg-red-600 transition-colors shadow-sm shadow-red-200"
                 >
                   {t.delete}
                 </button>
               </div>
            </div>
         </div>
      )}
      
      {/* Main Layout */}
      <div className="max-w-7xl mx-auto px-4 md:px-8 pt-8 md:pt-16 pb-20">
        
        {/* Header Row: Flex container for single line layout */}
        <div className="flex items-center justify-between gap-4 mb-8">
          
          {/* Left Side: Title & Search */}
          <div className="flex items-center gap-4 md:gap-6 flex-1 min-w-0">
              <div className="flex items-baseline gap-2 shrink-0">
                  <h1 className="text-2xl md:text-3xl font-serif font-bold text-gray-900 tracking-tight leading-none">
                    {t.bookshelf_title}
                  </h1>
                  {selectedIds.size > 0 && (
                    <span className="text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full animate-in fade-in">
                      {selectedIds.size}
                    </span>
                  )}
              </div>

              {/* Search Bar - Inline and Compact */}
              <div className={`
                 group relative flex items-center transition-all duration-300 ease-out
                 ${isSearchFocused || searchQuery ? 'w-full max-w-xs bg-white shadow-sm ring-1 ring-gray-200' : 'w-48 bg-transparent hover:bg-gray-100/50'}
                 rounded-lg h-8 px-2
              `}>
                 <Search className={`w-3.5 h-3.5 mr-2 flex-shrink-0 transition-colors ${isSearchFocused ? 'text-gray-600' : 'text-gray-400'}`} />
                 <input 
                   type="text"
                   placeholder={t.search_placeholder}
                   value={searchQuery}
                   onChange={(e) => setSearchQuery(e.target.value)}
                   onFocus={() => setIsSearchFocused(true)}
                   onBlur={() => setIsSearchFocused(false)}
                   className="w-full bg-transparent border-none outline-none text-sm text-gray-800 placeholder-gray-400 focus:ring-0 p-0"
                 />
                 {searchQuery && (
                   <button onClick={() => setSearchQuery('')} className="ml-1 p-0.5 rounded-full hover:bg-gray-200 text-gray-400">
                      <X className="w-3 h-3" />
                   </button>
                 )}
              </div>
          </div>
          
          {/* Right Side: Actions */}
          <div className="flex items-center gap-2 shrink-0">
            
            {/* Cloud Sync Dropdown */}
            {showSyncButton && (
              <div className="relative" ref={syncMenuRef}>
                <button
                  onClick={() => setActiveMenu(activeMenu === 'sync' ? null : 'sync')}
                  className={`
                    flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all text-sm font-medium
                    ${activeMenu === 'sync' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}
                    ${isSyncConnected ? 'bg-blue-50/50 text-blue-700 hover:bg-blue-50' : ''}
                  `}
                  title={t.sync}
                >
                  {getSyncIcon()}
                  <span className="hidden sm:inline">{t.sync}</span>
                  <ChevronDown className={`w-3 h-3 opacity-50 transition-transform ${activeMenu === 'sync' ? 'rotate-180' : ''}`} />
                </button>

                {activeMenu === 'sync' && (
                  <div className="absolute top-full right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden z-40 animate-in fade-in zoom-in-95 duration-100 origin-top-right">
                      {/* Status Header */}
                      <div className="px-4 py-3 bg-gray-50/50 border-b border-gray-100">
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">{t.cloud_account}</div>
                        {cloudUser ? (
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center">
                              <UserIcon className="w-3.5 h-3.5 text-blue-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-medium text-gray-800 truncate block">
                                {cloudUser.email || cloudUser.user_metadata?.full_name || 'User'}
                              </span>
                              <span className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                                {t.connected}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-gray-300"></div>
                            <span className="text-sm text-gray-500">{t.disconnected}</span>
                          </div>
                        )}
                      </div>

                      {/* Menu Actions */}
                      <div className="p-1.5 space-y-0.5">
                          {cloudUser ? (
                             <>
                              <button
                                onClick={() => { setActiveMenu(null); onManualSync(); }}
                                className="w-full text-left px-3 py-2 text-[13px] text-gray-700 hover:bg-blue-50 hover:text-blue-700 rounded-lg flex items-center gap-3 transition-colors"
                              >
                                <RefreshCw className={`w-4 h-4 opacity-70 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
                                <span>{t.sync_now}</span>
                              </button>

                              <div className="my-1 border-t border-gray-100 mx-2"></div>
                              
                              <button
                                onClick={() => { setActiveMenu(null); onLogout(); }}
                                className="w-full text-left px-3 py-2 text-[13px] text-gray-500 hover:bg-red-50 hover:text-red-600 rounded-lg flex items-center gap-3 transition-colors"
                              >
                                <LogOut className="w-4 h-4 opacity-70" />
                                <span>{t.logout}</span>
                              </button>
                             </>
                          ) : (
                             <button
                               onClick={() => { setActiveMenu(null); onLogin(); }}
                               className="w-full text-left px-3 py-2 text-[13px] text-blue-600 hover:bg-blue-50 rounded-lg font-medium flex items-center gap-3 transition-colors"
                             >
                               <LogIn className="w-4 h-4" />
                               <span>{t.login_to_sync}</span>
                             </button>
                          )}
                      </div>
                  </div>
                )}
              </div>
            )}

            {/* Import Dropdown */}
            <div className="relative" ref={importMenuRef}>
              <button
                onClick={() => setActiveMenu(activeMenu === 'import' ? null : 'import')}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors text-sm font-medium
                  ${activeMenu === 'import' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}
                `}
                title={t.import}
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">{t.import}</span>
                <ChevronDown className={`w-3 h-3 opacity-50 transition-transform ${activeMenu === 'import' ? 'rotate-180' : ''}`} />
              </button>

              {activeMenu === 'import' && (
                <div className="absolute top-full right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden z-40 animate-in fade-in zoom-in-95 duration-100 origin-top-right">
                    <div className="p-1.5 space-y-0.5">
                      <button
                        onClick={() => { setActiveMenu(null); fileInputRef.current?.click(); }}
                        className="w-full text-left px-3 py-2 text-[13px] text-gray-700 hover:bg-gray-50 hover:text-gray-900 rounded-lg flex items-center gap-3 transition-colors"
                      >
                        <FileText className="w-4 h-4 opacity-70" />
                        <span>{t.import_file}</span>
                      </button>
                      <button
                        onClick={handleScanFolderClick}
                        className="w-full text-left px-3 py-2 text-[13px] text-gray-700 hover:bg-gray-50 hover:text-gray-900 rounded-lg flex items-center gap-3 transition-colors"
                      >
                        <FolderInput className="w-4 h-4 opacity-70" />
                        <span>{t.scan_folder}</span>
                      </button>
                      <div className="my-1 border-t border-gray-100 mx-2"></div>
                      <button
                        onClick={() => { setActiveMenu(null); backupInputRef.current?.click(); }}
                        className="w-full text-left px-3 py-2 text-[13px] text-gray-700 hover:bg-gray-50 hover:text-gray-900 rounded-lg flex items-center gap-3 transition-colors"
                      >
                        <FileUp className="w-4 h-4 opacity-70" />
                        <span>{t.restore_backup}</span>
                      </button>
                    </div>
                </div>
              )}
            </div>

            {/* Export Dropdown */}
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setActiveMenu(activeMenu === 'export' ? null : 'export')}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors text-sm font-medium
                  ${activeMenu === 'export' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}
                `}
                title={t.export}
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">{t.export}</span>
                <ChevronDown className={`w-3 h-3 opacity-50 transition-transform ${activeMenu === 'export' ? 'rotate-180' : ''}`} />
              </button>

               {activeMenu === 'export' && (
                <div className="absolute top-full right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden z-40 animate-in fade-in zoom-in-95 duration-100 origin-top-right">
                    <div className="p-1.5">
                      <button
                        onClick={() => { setActiveMenu(null); onExportBackup(); }}
                        className="w-full text-left px-3 py-2 text-[13px] text-gray-700 hover:bg-gray-50 hover:text-gray-900 rounded-lg flex items-center gap-3 transition-colors"
                      >
                        <FileDown className="w-4 h-4 opacity-70" />
                        <span>{t.backup_data}</span>
                      </button>
                    </div>
                </div>
              )}
            </div>
            
            {/* Hidden Inputs */}
            <input type="file" ref={fileInputRef} className="hidden" accept=".txt,.epub,.pdf" multiple onChange={(e) => e.target.files && onImportFiles(Array.from(e.target.files))} />
            <input type="file" ref={folderInputRef} className="hidden" 
              // @ts-ignore
              webkitdirectory="" directory="" multiple onChange={handleFolderInputChange} 
            />
            <input type="file" ref={backupInputRef} className="hidden" accept=".json" onChange={(e) => e.target.files?.[0] && onRestoreBackup(e.target.files[0])} />

          </div>
        </div>

        {/* Tabs (Segmented Control Style) */}
        <div className="flex items-center gap-8 border-b border-gray-200/60 mb-8 pointer-events-none overflow-x-auto no-scrollbar">
          {TABS_KEYS.map((key) => (
            <button
              key={key}
              onClick={() => setActiveTabKey(key)}
              className={`
                pb-3 text-sm transition-all relative pointer-events-auto whitespace-nowrap
                ${activeTabKey === key 
                  ? 'text-gray-900 font-medium after:absolute after:bottom-0 after:left-0 after:w-full after:h-0.5 after:bg-gray-900 after:rounded-t-full' 
                  : 'text-gray-500 font-normal hover:text-gray-700'
                }
              `}
            >
              {t[key]}
            </button>
          ))}
        </div>

        {/* Book Grid */}
        <div 
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-5 gap-y-10 selection-zone"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {sortedBooks.map((book) => {
            const totalUnits = book.chapters && book.chapters.length > 0 ? book.chapters.length : Math.max(1, Math.ceil(book.content.length / 3000));
            const percentage = calculateProgress(book.currentPageIndex, totalUnits);
            const isSelected = selectedIds.has(book.id);

            return (
              <div 
                key={book.id} 
                data-book-id={book.id}
                className="flex flex-col gap-3 group relative cursor-pointer"
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey || isSelecting) {
                     e.stopPropagation();
                     toggleSelection(book.id, true);
                  } else if (selectedIds.size > 0 && !isSelected) {
                     // Click on unselected item clears selection and opens it
                     setSelectedIds(new Set());
                     onOpenBook(book);
                  } else if (isSelected) {
                     e.stopPropagation();
                     toggleSelection(book.id, true); 
                  } else {
                     onOpenBook(book);
                  }
                }}
                onMouseEnter={() => setIsHoveringId(book.id)}
                onMouseLeave={() => setIsHoveringId(null)}
              >
                <div 
                  className={`
                    relative aspect-[2/3] w-full bg-white shadow-sm border overflow-hidden rounded-lg transition-all duration-300 
                    ${isSelected 
                      ? 'ring-2 ring-blue-500 border-blue-500 translate-y-[-4px] shadow-md' 
                      : 'border-gray-200 group-hover:shadow-md group-hover:-translate-y-1'
                    }
                  `}
                >
                  {book.coverImage ? (
                    <img src={book.coverImage} alt={book.title} className="w-full h-full object-cover grayscale-[10%] group-hover:grayscale-0 transition-all duration-500" />
                  ) : (
                    <div className="w-full h-full p-4 flex flex-col items-center justify-center text-center bg-gray-50/30">
                       <div className="text-[9px] uppercase tracking-widest text-gray-400 mb-2 font-mono">{book.publisher || 'BOOK'}</div>
                       <h3 className="text-gray-900 font-serif font-bold text-lg leading-tight line-clamp-3 mb-2">{book.title}</h3>
                       {book.author && <p className="text-[10px] text-gray-500 uppercase tracking-wide">{book.author}</p>}
                    </div>
                  )}

                  {isSelected && (
                    <div className="absolute inset-0 bg-blue-500/10 flex items-center justify-center z-20 backdrop-blur-[1px]">
                       <div className="bg-blue-600 text-white rounded-full p-2 shadow-lg scale-110">
                          <Check className="w-5 h-5" />
                       </div>
                    </div>
                  )}

                  <button
                      onClick={(e) => requestDelete(e, book.id)}
                      className={`
                        absolute top-2 right-2 p-1.5 bg-white text-red-500 rounded-full border border-gray-100 shadow-sm
                        hover:bg-red-50 transition-all duration-200 z-30
                        ${isHoveringId === book.id || isSelected ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-90 pointer-events-none'}
                      `}
                      title={t.delete}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  
                  {/* Link Progress Button (visible on hover, only when cloud sync is connected) */}
                  {cloudUser && book.fileHash && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onLinkProgress(book.id); }}
                      className={`
                        absolute top-2 left-2 p-1.5 bg-white text-blue-500 rounded-full border border-gray-100 shadow-sm
                        hover:bg-blue-50 transition-all duration-200 z-30
                        ${isHoveringId === book.id && !isSelected ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-90 pointer-events-none'}
                      `}
                      title={t.link_progress}
                    >
                      <Link2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="space-y-0.5">
                  <h3 className={`text-[14px] font-medium leading-snug line-clamp-2 ${isSelected ? 'text-blue-600' : 'text-gray-800 group-hover:text-gray-900'}`}>{book.title}</h3>
                  <div className="flex items-center justify-between">
                     <p className="text-[11px] text-gray-400 font-medium">
                       {percentage === 0 ? t.not_started : `${percentage}%`}
                     </p>
                  </div>
                </div>
              </div>
            );
          })}
          
          {/* Add Book Card (Hybrid Style) */}
          <div 
            onClick={() => fileInputRef.current?.click()}
            className="
              group relative aspect-[2/3] w-full 
              flex flex-col items-center justify-center
              border border-gray-200 
              rounded-xl bg-white
              shadow-[0_2px_8px_rgba(0,0,0,0.02)]
              cursor-pointer transition-all duration-300
              hover:border-blue-300 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] hover:-translate-y-1
            "
          >
              <div className="w-10 h-10 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center group-hover:bg-blue-50 group-hover:border-blue-100 transition-colors duration-300">
                <Plus className="w-5 h-5 text-gray-400 group-hover:text-blue-600 transition-colors" />
              </div>
              <div className="mt-3 text-[13px] font-medium text-gray-400 group-hover:text-blue-600 transition-colors">
                {t.add_book}
              </div>
          </div>
        </div>

        {/* Empty State Hint */}
        {books.length === 0 && (
           <div className="mt-12 text-center">
              <p className="text-gray-400 text-sm font-light">{t.empty_hint}</p>
           </div>
        )}

        {sortedBooks.length === 0 && books.length > 0 && searchQuery && (
           <div className="text-center mt-20 text-gray-400 text-sm">{t.no_results}</div>
        )}

        {/* Footer Count */}
        {books.length > 0 && (
           <div className="mt-24 mb-12 flex justify-center opacity-40 hover:opacity-100 transition-opacity duration-500">
               <div className="flex items-center gap-2 text-xs font-medium text-gray-400">
                   <Library className="w-3 h-3" />
                   <span>{t.total_books.replace('{count}', books.length.toString())}</span>
               </div>
           </div>
        )}

        {/* Version Number */}
        <div className="fixed bottom-4 right-4 text-[10px] text-gray-300 font-light pointer-events-none">
          v0.0.0
        </div>
      </div>
    </div>
  );
};