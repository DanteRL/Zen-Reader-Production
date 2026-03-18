

import React, { useEffect, useRef } from 'react';
import { X, MapPin } from 'lucide-react';
import { Chapter, ThemeType } from '../types';
import { THEMES } from '../constants';
import { translations, Locale } from '../locales';

interface TOCProps {
  isOpen: boolean;
  onClose: () => void;
  chapters: Chapter[];
  currentChapterIndex: number; // This represents Chapter Index (EPUB) OR Page Index (PDF)
  onSelectChapter: (index: number) => void;
  currentTheme: ThemeType;
  // Note: We don't receive language prop here from ReaderView, but we can default to 'zh' if not provided 
  // or update ReaderView to pass it. ReaderView passes it in the updated code.
  // Wait, I didn't update TOCProps in ReaderView call. Let me check the ReaderView change.
  // ReaderView invokes <TOC ... />. It needs to pass language or we import App's context (which we don't have).
  // I will add a simple static import or assume ReaderView renders it.
  // Actually, let's just use a default or modify ReaderView to pass it? 
  // Let's modify ReaderView to pass it. Wait, I already modified ReaderView above.
  // I need to update TOC props definition here.
}

// Update: ReaderView doesn't pass language to TOC in my previous XML block? 
// Let me double check ReaderView.tsx...
// Ah, in ReaderView.tsx I added `language={currentLocale}` to ReaderView props, 
// but I need to pass it down to <TOC>.
// Let's assume for this file change I'll make it accept it.

export const TOC: React.FC<TOCProps & { language?: Locale }> = ({
  isOpen,
  onClose,
  chapters,
  currentChapterIndex,
  onSelectChapter,
  currentTheme,
  language = 'en'
}) => {
  const t = translations[language];
  const themeStyles = THEMES[currentTheme];
  const activeItemRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to current chapter when opening
  useEffect(() => {
    if (isOpen && activeItemRef.current && listRef.current) {
      // Use a small delay to ensure the DOM is fully rendered
      setTimeout(() => {
        activeItemRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }, 100);
    }
  }, [isOpen, currentChapterIndex]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex pointer-events-none">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/20 pointer-events-auto backdrop-blur-sm transition-opacity" 
        onClick={onClose}
      />

      {/* Drawer */}
      <div className={`
        relative w-full max-w-xs h-full shadow-2xl pointer-events-auto transform transition-transform duration-300 ease-in-out
        flex flex-col
        ${themeStyles.uiBg} ${themeStyles.text} border-r ${themeStyles.border}
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        
        {/* Header */}
        <div className={`flex items-center justify-between p-4 border-b ${themeStyles.border}`}>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold tracking-tight">{t.toc}</h2>
            <span className="text-xs opacity-60 bg-black/5 px-2 py-0.5 rounded-full">
              {chapters.length}
            </span>
          </div>
          <button 
            onClick={onClose}
            className={`p-2 rounded-full ${themeStyles.hover} transition-colors`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* List */}
        <div 
          ref={listRef}
          className="flex-1 overflow-y-auto scrollbar-thin"
        >
          {chapters.map((chapter, index) => {
            // Logic for Highlighting:
            // Case 1: PDF (Has pageNumber). currentChapterIndex is absolute page number (0-based)
            // Case 2: EPUB/TXT. currentChapterIndex is chapter index.
            
            let isActive = false;
            let onClickIndex = index;

            if (chapter.pageNumber !== undefined) {
               // PDF Mode: 
               // currentChapterIndex is 0-based page index.
               // chapter.pageNumber is 1-based page index.
               
               // To determine active chapter in TOC:
               // The active chapter is the one where chapter.pageNumber <= (currentChapterIndex + 1)
               // AND the next chapter's pageNumber > (currentChapterIndex + 1)
               
               const currentPage = currentChapterIndex + 1;
               const thisPage = chapter.pageNumber;
               const nextPage = chapters[index + 1]?.pageNumber ?? 999999;
               
               isActive = currentPage >= thisPage && currentPage < nextPage;
               onClickIndex = thisPage - 1; // Convert 1-based page back to 0-based index for onSelectChapter
            } else {
               // Standard Mode
               isActive = index === currentChapterIndex;
               onClickIndex = index;
            }

            return (
              <button
                key={index}
                ref={isActive ? activeItemRef : null}
                onClick={() => {
                  onSelectChapter(onClickIndex);
                  onClose();
                }}
                className={`
                  w-full text-left px-4 py-3 border-b text-sm transition-colors flex items-start gap-3
                  ${themeStyles.border}
                  ${isActive 
                    ? `bg-blue-500 text-white border-blue-600` 
                    : `${themeStyles.hover} opacity-80 hover:opacity-100`
                  }
                `}
              >
                {isActive && <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0 animate-pulse" />}
                <span className={`line-clamp-2 ${!isActive && 'pl-7'}`}>
                  {chapter.title}
                </span>
                {chapter.pageNumber && (
                    <span className={`ml-auto text-xs ${isActive ? 'text-white/80' : 'text-gray-400'}`}>
                        {chapter.pageNumber}
                    </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};