

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
  toc?: any; // optional nested TOC from epub.js
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
  toc,
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

  // Render nested toc items recursively
  const renderTocItems = (items: any[], depth = 0) => {
    return items.map((it, idx) => {
      const label = it.label || it.text || 'Untitled';
      const href: string | undefined = it.href;
      const children = it.subitems || it.children || it.nav || null;

      // Find a matching chapter index by href (loose matching)
      const findChapterIndex = (href?: string) => {
        if (!href) return -1;
        const baseHref = href.split('#')[0];
        const idx = chapters.findIndex(c => {
          if (!c.href) return false;
          const chBase = c.href.split('#')[0];
          return chBase === baseHref || baseHref.includes(chBase) || chBase.includes(baseHref);
        });
        return idx;
      };

      const chapterIndex = findChapterIndex(href);

      return (
        <div key={`${depth}-${idx}`} className={`pl-${Math.min(depth * 4, 16)} py-1`}> 
          <button
            onClick={() => {
              if (chapterIndex >= 0) {
                onSelectChapter(chapterIndex);
              }
              if (href && href.includes('#')) {
                const anchor = href.split('#')[1];
                try { window.dispatchEvent(new CustomEvent('zenreader-scroll-to-anchor', { detail: { anchor } })); } catch (e) {}
              }
              onClose();
            }}
            className={`w-full text-left px-4 py-2 text-sm ${themeStyles.hover} transition-colors`}
          >
            <span className="line-clamp-2">{label}</span>
          </button>
          {children && Array.isArray(children) && (
            <div className="pl-4">
              {renderTocItems(children, depth + 1)}
            </div>
          )}
        </div>
      );
    });
  };

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
          {toc && Array.isArray(toc) ? (
            // Render nested TOC from epub navigation
            <div>
              {renderTocItems(toc)}
            </div>
          ) : (
            <>
              {chapters.map((chapter, index) => {
                // Logic for Highlighting (PDF vs chapter index)
                let isActive = false;
                let onClickIndex = index;

                if (chapter.pageNumber !== undefined) {
                  const currentPage = currentChapterIndex + 1;
                  const thisPage = chapter.pageNumber;
                  const nextPage = chapters[index + 1]?.pageNumber ?? 999999;
                  isActive = currentPage >= thisPage && currentPage < nextPage;
                  onClickIndex = thisPage - 1;
                } else {
                  isActive = index === currentChapterIndex;
                  onClickIndex = index;
                }

                const classes = [
                  'w-full', 'text-left', 'px-4', 'py-3', 'border-b', 'text-sm', 'transition-colors', 'flex', 'items-start', 'gap-3',
                  themeStyles.border,
                  isActive ? 'bg-blue-500 text-white border-blue-600' : `${themeStyles.hover} opacity-80 hover:opacity-100`,
                ].join(' ');

                return (
                  <div key={index}>
                    <button
                      ref={isActive ? activeItemRef : undefined}
                      onClick={() => {
                        onSelectChapter(onClickIndex);
                        if (chapter.href && chapter.href.includes('#')) {
                          const anchor = chapter.href.split('#')[1];
                          try { window.dispatchEvent(new CustomEvent('zenreader-scroll-to-anchor', { detail: { anchor } })); } catch (e) {}
                        }
                        onClose();
                      }}
                      className={classes}
                    >
                      {isActive && <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0 animate-pulse" />}
                      <span className={isActive ? 'line-clamp-2' : 'line-clamp-2 pl-7'}>{chapter.title}</span>
                      {chapter.pageNumber && (
                        <span className={isActive ? 'ml-auto text-xs text-white/80' : 'ml-auto text-xs text-gray-400'}>
                          {chapter.pageNumber}
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
};