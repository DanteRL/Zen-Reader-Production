import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Settings, ArrowLeft, ArrowRight, List, Target, Sparkles, X, ChevronLeft, ChevronRight, Loader2, Languages, Copy, StickyNote, Scan, Scaling, Minus, Plus, Maximize, Columns, File, Scroll, Cloud, CheckCircle2, AlertCircle, Clock, BookOpenCheck, CloudOff } from 'lucide-react';
import { BookData, ReaderSettings, AIEntityData, PdfViewMode, PdfFitMode } from '../types';
import { THEMES } from '../constants';
import { calculateProgress, ensurePdfLibraryLoaded } from '../utils';
import { TOC } from './TOC';
import { GoogleGenAI } from "@google/genai";
import { translations, Locale } from '../locales';
import * as OpenCC from 'opencc-js';

// --- Types ---
interface Position {
  top: number;
  left: number;
  align: 'left' | 'right' | 'center';
  placement: 'top' | 'bottom';
}

interface ContextMenuState {
  left: number;
  top: number;
  text: string;
  context: string; // Surrounding paragraph for better AI inference
  selectionRect: DOMRect;
}

// --- Helper Components ---

const DefinitionPopover = ({ 
  data, 
  position, 
  onClose,
  theme,
  isLoading
}: { 
  data: AIEntityData; 
  position: Position | null; 
  onClose: () => void;
  theme: string;
  isLoading?: boolean;
}) => {
  if (!position) return null;

  const isDark = theme === 'dark';
  const isSepia = theme === 'sepia';
  
  // Minimalist Colors
  const containerClasses = isDark
    ? 'bg-[#242424]/95 border-white/10 text-gray-200 shadow-black/50'
    : isSepia
    ? 'bg-[#F2F0E9]/95 border-[#8C857B]/20 text-[#2D2926] shadow-[#8C857B]/20'
    : 'bg-white/95 border-gray-200/50 text-gray-700 shadow-xl shadow-gray-200/50';

  const subTextClasses = isDark ? 'text-gray-500' : 'text-gray-400';

  // Dynamic Alignment Styles
  const transformOrigin = position.placement === 'top' ? 'bottom center' : 'top center';
  const translateY = position.placement === 'top' ? '-100%' : '0';
  // Adjust margin to distance slightly from text
  const marginTop = position.placement === 'bottom' ? '12px' : '-12px';

  return (
    <div 
      className={`
        absolute z-[100] flex flex-col w-[320px] max-w-[90vw] rounded-xl border backdrop-blur-md
        transition-all duration-300 ease-out
        animate-in fade-in zoom-in-95
        ${containerClasses}
      `}
      style={{
        top: position.top,
        left: position.left,
        transform: `translate(-50%, ${translateY})`,
        marginTop: marginTop,
        transformOrigin: transformOrigin,
      }}
      onClick={(e) => e.stopPropagation()} // Prevent click-outside logic from triggering when clicking inside
    >
      {/* Content Container */}
      <div className="p-4 flex flex-col gap-2.5">
        
        {/* Header: Term + Actions */}
        <div className="flex justify-between items-start gap-3">
           <div className="flex items-center gap-2 overflow-hidden">
             <div className={`p-1 rounded-md flex-shrink-0 ${isDark ? 'bg-white/10' : 'bg-black/5'}`}>
               <Sparkles className="w-3 h-3 text-amber-500" />
             </div>
             <span className="font-serif font-bold text-sm truncate opacity-90 select-none">
               {data.term}
             </span>
           </div>

           <div className="flex items-center gap-1 flex-shrink-0">
              {!isLoading && (
                <button 
                  onClick={() => navigator.clipboard.writeText(data.definition)}
                  className={`p-1 rounded hover:bg-black/5 transition-colors ${subTextClasses} hover:text-gray-600`}
                  title="Copy"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              )}
              <button 
                onClick={onClose}
                className={`p-1 rounded hover:bg-black/5 transition-colors ${subTextClasses} hover:text-gray-600`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
           </div>
        </div>

        {/* Body */}
        <div className={`text-[13px] leading-relaxed opacity-90 font-sans whitespace-pre-wrap`}>
            {isLoading ? (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="w-4 h-4 animate-spin text-blue-500/80" />
                <span className={`text-xs ${subTextClasses} animate-pulse`}>Analyzing context...</span>
              </div>
            ) : (
              <div className="animate-in fade-in duration-300">
                {data.definition}
              </div>
            )}
        </div>
      </div>
    </div>
  );
};

// --- PDF Renderer ---
const PdfPage = ({ 
  pdf, 
  pageNum, 
  scale,
  theme,
  isScrollMode,
  onVisible 
}: { 
  pdf: any, 
  pageNum: number, 
  scale: number,
  theme: string,
  isScrollMode: boolean,
  onVisible?: () => void
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isRendered, setIsRendered] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  
  // Lazy Loading logic via Intersection Observer
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry.isIntersecting) {
        setIsVisible(true);
        if (onVisible) onVisible();
      }
    }, { rootMargin: '500px 0px 500px 0px' }); 

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [pageNum, isScrollMode, onVisible]);

  useEffect(() => {
    if (!pdf || !canvasRef.current || !isVisible) return;
    
    let renderTask: any = null;

    const render = async () => {
      try {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        const outputScale = window.devicePixelRatio || 1;

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = Math.floor(viewport.width) + "px";
        canvas.style.height = Math.floor(viewport.height) + "px";
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        // Theme Filters
        if (theme === 'dark') {
          canvas.style.filter = 'invert(0.92) hue-rotate(180deg) brightness(0.8)';
        } else if (theme === 'sepia') {
          canvas.style.filter = 'sepia(0.2) contrast(0.95) brightness(0.95)';
        } else {
          canvas.style.filter = 'none';
        }

        const transform = outputScale !== 1 
          ? [outputScale, 0, 0, outputScale, 0, 0] 
          : null;

        renderTask = page.render({ canvasContext: ctx, viewport, transform });
        await renderTask.promise;
        setIsRendered(true);
      } catch (e: any) {
        if (e.name !== 'RenderingCancelledException') {
            console.error(e);
        }
      }
    };
    
    render();
    
    return () => {
        if (renderTask) renderTask.cancel();
    };
  }, [pdf, pageNum, scale, theme, isVisible]);
  
  return (
    <div ref={containerRef} className="flex justify-center relative min-h-[300px]">
        {isVisible ? (
           <canvas ref={canvasRef} className="bg-white shadow-sm transition-transform duration-200" />
        ) : (
           <div 
             className="flex items-center justify-center bg-black/5 rounded animate-pulse"
             style={{ width: '100%', height: '800px' }} // Placeholder height
           >
              <span className="text-xs opacity-50">Page {pageNum}</span>
           </div>
        )}
    </div>
  );
};

const PdfRenderer = ({ 
  data, 
  pageIndex, 
  scale,
  theme, 
  settings,
  onPageVisible,
  onLoad
}: { 
  data: ArrayBuffer, 
  pageIndex: number, 
  scale: number,
  theme: string,
  settings: ReaderSettings,
  onPageVisible: (index: number) => void,
  onLoad: (meta: { width: number, height: number, numPages: number }) => void
}) => {
  const [pdf, setPdf] = useState<any>(null);
  const [initialScrollDone, setInitialScrollDone] = useState(false);

  useEffect(() => {
    const load = async () => {
        await ensurePdfLibraryLoaded();
        const pdfjsLib = (window as any).pdfjsLib;
        if (pdfjsLib) {
             const loadingTask = pdfjsLib.getDocument(new Uint8Array(data.slice(0)));
             const pdfDoc = await loadingTask.promise;
             setPdf(pdfDoc);
             
             // Extract metadata from first page to help with scaling
             const page1 = await pdfDoc.getPage(1);
             const viewport = page1.getViewport({ scale: 1 });
             onLoad({ width: viewport.width, height: viewport.height, numPages: pdfDoc.numPages });
        }
    };
    load();
  }, [data]);

  const mode = settings.pdfViewMode || 'single';

  // --- SCROLL MODE LOGIC ---

  // 1. Initial Scroll Restoration
  useEffect(() => {
    if (mode === 'scroll' && pdf && !initialScrollDone) {
        // Wait a tick for rendering
        const timer = setTimeout(() => {
          const el = document.querySelector(`div[data-page="${pageIndex}"]`);
          if (el) {
              console.log("Restoring PDF position to page", pageIndex);
              el.scrollIntoView({ block: 'start' });
              setInitialScrollDone(true);
          }
        }, 150);
        return () => clearTimeout(timer);
    }
  }, [pdf, mode, initialScrollDone]); 

  // 2. Scroll Spy for Progress Tracking
  useEffect(() => {
    if (mode !== 'scroll' || !pdf) return;

    let timeout: number;
    const handleScroll = () => {
       const pageDivs = document.querySelectorAll('div[data-page]');
       let activePage = 0;
       
       // Find the first page whose bottom is significantly into the viewport
       for (const div of pageDivs) {
           const rect = div.getBoundingClientRect();
           // If the page is mostly visible or at the top
           if (rect.bottom > 200) { 
               activePage = parseInt(div.getAttribute('data-page') || '0');
               break;
           }
       }
       onPageVisible(activePage);
    };

    const onScroll = () => {
        if (timeout) return;
        timeout = window.setTimeout(() => {
            handleScroll();
            timeout = 0;
        }, 500); // Throttle to 500ms to avoid DB spam
    };

    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, [mode, pdf, onPageVisible]);


  if (!pdf) return <div className="py-20 flex justify-center"><Loader2 className="animate-spin w-8 h-8 opacity-50"/></div>;

  // SCROLL MODE RENDER
  if (mode === 'scroll') {
      return (
        <div className="w-full flex flex-col gap-6 pb-32 items-center">
           {Array.from({ length: pdf.numPages }).map((_, i) => (
             <div key={i} data-page={i} className="max-w-full">
                <PdfPage 
                  pdf={pdf} 
                  pageNum={i + 1} 
                  scale={scale} 
                  theme={theme}
                  isScrollMode={true}
                />
                <div className="text-center text-[10px] text-gray-400 mt-2">{i + 1}</div>
             </div>
           ))}
        </div>
      );
  }

  // DOUBLE PAGE MODE
  if (mode === 'double') {
     const isCover = pageIndex === 0;
     const leftPageIndex = isCover ? 0 : (pageIndex % 2 !== 0 ? pageIndex : pageIndex - 1);
     const rightPageIndex = leftPageIndex + 1;
     const hasRightPage = rightPageIndex < pdf.numPages;

     return (
       <div className="w-full flex justify-center items-start gap-0 min-h-screen pt-10">
          {isCover ? (
             <div className="shadow-2xl">
               <PdfPage pdf={pdf} pageNum={1} scale={scale} theme={theme} isScrollMode={false} />
             </div>
          ) : (
             <div className="flex shadow-2xl">
               <div className="flex-1 flex justify-end">
                 <PdfPage pdf={pdf} pageNum={leftPageIndex + 1} scale={scale} theme={theme} isScrollMode={false} />
               </div>
               {hasRightPage && (
                 <div className="flex-1 flex justify-start">
                   <PdfPage pdf={pdf} pageNum={rightPageIndex + 1} scale={scale} theme={theme} isScrollMode={false} />
                 </div>
               )}
             </div>
          )}
       </div>
     );
  }

  // SINGLE PAGE MODE
  return (
      <div className="w-full flex justify-center min-h-screen pt-10">
          <div className="shadow-xl">
             <PdfPage pdf={pdf} pageNum={pageIndex + 1} scale={scale} theme={theme} isScrollMode={false} />
          </div>
      </div>
  );
};


interface ParagraphProps {
  text: string;
  index: number;
  isActive: boolean;
  settings: ReaderSettings;
}

const Paragraph = React.memo(({ 
  text, 
  index, 
  isActive, 
  settings, 
}: ParagraphProps) => {
  
  // Identify if it's a heading
  const isHeading = text.startsWith('## ');
  const cleanText = isHeading ? text.replace(/^##\s+/, '') : text;

  // Focus Mode Styles
  let containerClass = "relative transition-all duration-500 ease-in-out px-4 md:px-0 mb-6";
  let textClass = "transition-all duration-500 block";
  
  if (isHeading) {
     textClass += " font-bold text-2xl mt-12 mb-6 opacity-90";
     containerClass += " mb-2"; 
  } 

  if (settings.focusMode) {
    if (isActive) {
      containerClass += " opacity-100 scale-[1.01] my-10"; 
      textClass += isHeading ? "" : " font-medium";
    } else {
      containerClass += " opacity-1 blur-[1.5px] grayscale my-10"; 
    }
  }

  return (
    <div 
      data-index={index}
      className={containerClass}
      style={{
        textAlign: isHeading ? 'left' : settings.textAlign,
      }}
    >
      <p className={textClass}>
        {cleanText}
      </p>
    </div>
  );
});

Paragraph.displayName = 'Paragraph';

// --- Main Component ---

interface ReaderViewProps {
  book: BookData;
  settings: ReaderSettings;
  onPageChange: (pageIndex: number) => void;
  onOpenSettings: () => void;
  onCloseBook: () => void;
  onToggleFocusMode: () => void;
  onUpdateSettings: (newSettings: Partial<ReaderSettings>) => void;
  syncStatus?: 'idle' | 'syncing' | 'success' | 'error';
  isSyncConnected?: boolean;
  language: Locale;
}

export const ReaderView: React.FC<ReaderViewProps> = ({
  book,
  settings,
  onPageChange,
  onOpenSettings,
  onCloseBook,
  onToggleFocusMode,
  onUpdateSettings,
  syncStatus = 'idle',
  isSyncConnected = false,
  language
}) => {
  const t = translations[language];
  const contentRef = useRef<HTMLDivElement>(null);
  const pendingAnchorRef = useRef<string | null>(null);
  const isAutoScrolling = useRef(false);
  const scrollTimeoutRef = useRef<number | null>(null);
  const lastKeyTime = useRef<number>(0);
  const controlsTimerRef = useRef<number | null>(null);
  
  const [isTOCOpen, setIsTOCOpen] = useState(false);
  const [activeParagraphIndex, setActiveParagraphIndex] = useState<number | null>(null);
  const [showControls, setShowControls] = useState(true);

  // Time state
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }, 1000 * 60);
    return () => clearInterval(timer);
  }, []);

  // PDF State
  const [pdfMeta, setPdfMeta] = useState<{ width: number, height: number } | null>(null);
  const [containerSize, setContainerSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  // AI State
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [activeEntity, setActiveEntity] = useState<{data: AIEntityData, position: Position, isLoading?: boolean} | null>(null);

  const themeStyles = THEMES[settings.theme];
  const accentBg = `var(--zenreader-accent, ${settings.theme === 'dark' ? 'rgba(36,36,36,0.85)' : settings.theme === 'sepia' ? 'rgba(242,240,233,0.85)' : 'rgba(255,255,255,0.9)'})`;
  
  const isPdf = !!book.pdfArrayBuffer;
  const totalUnits = isPdf ? (book.pageCount || 1) : book.chapters.length;
  const progress = calculateProgress(book.currentPageIndex, totalUnits);
  
  const currentChapter = isPdf ? null : book.chapters[book.currentPageIndex];

  // Converted content / HTML for text chapters (OpenCC conversion etc.)
  const [convertedContent, setConvertedContent] = useState<string>('');
  // If chapter provides HTML, keep a sanitized HTML copy for rendering
  const [convertedHtml, setConvertedHtml] = useState<string>('');
  const [imageModalUrl, setImageModalUrl] = useState<string | null>(null);
  const converterRef = useRef<((text: string) => string) | null>(null);

  // Screen Orientation Lock
  useEffect(() => {
    const lockOrientation = async () => {
      const lock = settings.orientationLock;
      if (!lock || lock === 'none') return;
      try {
        const screenOrientation = (screen as any).orientation;
        if (screenOrientation?.lock) {
          await screenOrientation.lock(lock === 'portrait' ? 'portrait-primary' : 'landscape-primary');
        }
      } catch (e) {
        // Orientation lock is best-effort; not all browsers/contexts support it
        console.warn('[Orientation] lock failed:', e);
      }
    };
    lockOrientation();
    return () => {
      try {
        const screenOrientation = (screen as any).orientation;
        if (screenOrientation?.unlock) {
          screenOrientation.unlock();
        }
      } catch (_) { /* ignore */ }
    };
  }, [settings.orientationLock]);

  // Track window resize for PDF auto-fit
  useEffect(() => {
    const handleResize = () => {
        setContainerSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Calculate PDF Scale
  const effectivePdfScale = useMemo(() => {
    if (!isPdf || !pdfMeta) return 1.0;

    if (settings.pdfFitMode === 'width') {
        const padding = 32; 
        const availableWidth = containerSize.width - padding;
        const widthToFit = settings.pdfViewMode === 'double' ? availableWidth / 2 : availableWidth;
        return widthToFit / pdfMeta.width;
    } 
    
    if (settings.pdfFitMode === 'height') {
        const padding = 120; 
        const availableHeight = containerSize.height - padding;
        return availableHeight / pdfMeta.height;
    }

    return settings.pdfScale || 1.0;
  }, [isPdf, pdfMeta, settings.pdfFitMode, settings.pdfViewMode, settings.pdfScale, containerSize]);


  // --- AI Interaction Logic ---
  // (Omitted for brevity, logic remains same as previous implementation)
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!settings.aiMode || isPdf) return;
    const selection = window.getSelection();
    if (!selection || selection.toString().trim().length === 0) return;
    e.preventDefault();
    const text = selection.toString().trim();
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    let context = "";
    if (selection.anchorNode) {
        const node = selection.anchorNode.nodeType === Node.TEXT_NODE 
            ? selection.anchorNode.parentElement 
            : selection.anchorNode as HTMLElement;
        if (node && node.textContent) {
            context = node.textContent.trim().slice(0, 1500); 
        }
    }
    setContextMenu({ left: e.clientX, top: e.clientY, text, context, selectionRect: rect });
    setActiveEntity(null);
  }, [settings.aiMode, isPdf]);

  const handleAIAction = async (action: 'explain' | 'translate') => {
    if (!contextMenu) return;
    const { text, context, selectionRect } = contextMenu;
    setContextMenu(null); 
    const viewportWidth = window.innerWidth;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const absoluteLeft = selectionRect.left + scrollX;
    const absoluteTop = selectionRect.top + scrollY;
    const width = selectionRect.width;
    const height = selectionRect.height;
    let left = absoluteLeft + (width / 2);
    let top = absoluteTop;
    let align: 'left' | 'right' | 'center' = 'center';
    let placement: 'top' | 'bottom' = 'top';
    if (selectionRect.left < 150) { 
        left = absoluteLeft + 150; 
    } else if (selectionRect.right > viewportWidth - 150) {
        left = absoluteLeft + width - 150;
    }
    if (selectionRect.top < 220) {
        top = absoluteTop + height;
        placement = 'bottom';
    } else {
        top = absoluteTop;
        placement = 'top';
    }
    const displayTerm = text.length > 25 ? text.substring(0, 25) + '...' : text;
    setActiveEntity({
      data: { term: displayTerm, definition: '' },
      position: { top, left, align, placement },
      isLoading: true
    });
    
    const apiKey = settings.apiKey;
    if (!apiKey) {
       setActiveEntity(prev => prev ? { ...prev, data: { ...prev.data, definition: "API Key not configured. Please set it in Settings." }, isLoading: false } : null);
       return;
    }

    try {
        const ai = new GoogleGenAI({ apiKey: apiKey });
        let prompt = "";
        let langInstruction = "";
        if (settings.aiLanguage === 'auto') {
           const userLang = navigator.language; 
           if (userLang.startsWith('zh')) { langInstruction = "Respond in Simplified Chinese."; } else { langInstruction = "Respond in the same language as the selected text."; }
        } else if (settings.aiLanguage === 'zh') { langInstruction = "Respond in Simplified Chinese."; } else if (settings.aiLanguage === 'en') { langInstruction = "Respond in English."; }

        if (action === 'explain') {
            prompt = `
You are a "Contextual Knowledge Bridge".
Context: "...${context}..."
Target: "${text}"
Rules: Explain background knowledge/meme/implication. No simple dictionary definitions.
Structure: Concept, Implicit Meaning, Key Nuance.
${langInstruction}`;
        } else {
            prompt = `Context: "${context}"
Task: Translate "${text}" into the target language.
${langInstruction}`;
        }

        const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
        setActiveEntity(prev => prev ? ({ ...prev, data: { ...prev.data, definition: response.text ? response.text.trim() : "No result." }, isLoading: false }) : null);
    } catch (e) {
        console.error(e);
        setActiveEntity(prev => prev ? ({ ...prev, data: { ...prev.data, definition: "Error processing request." }, isLoading: false }) : null);
    }
  };

  // --- Standard Reader Logic ---

  useEffect(() => {
    if (settings.pdfViewMode !== 'scroll') {
       window.scrollTo({ top: 0, behavior: 'auto' });
    }
    if (settings.focusMode && !isPdf) {
      setTimeout(() => scrollToParagraph(0), 100);
    } else {
      setActiveParagraphIndex(null);
    }
  }, [book.currentPageIndex, settings.focusMode, isPdf, settings.pdfViewMode]);

  // Listen for anchor scroll requests from TOC
  useEffect(() => {
    const handler = (e: Event) => {
      const detail: any = (e as CustomEvent).detail;
      if (detail && detail.anchor) {
        pendingAnchorRef.current = detail.anchor;
      }
    };
    window.addEventListener('zenreader-scroll-to-anchor', handler as EventListener);
    return () => window.removeEventListener('zenreader-scroll-to-anchor', handler as EventListener);
  }, []);

  // After chapter content updates, if there's a pending anchor, scroll to it
  useEffect(() => {
    if (!contentRef.current) return;
    const anchor = pendingAnchorRef.current;
    if (!anchor) return;
    // Small delay to ensure DOM nodes exist
    setTimeout(() => {
      const el = contentRef.current?.querySelector(`#${CSS.escape(anchor)}`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      pendingAnchorRef.current = null;
    }, 200);
  }, [book.currentPageIndex, convertedHtml]);

  // --- Text Conversion Logic ---

  useEffect(() => {
    // If PDF, or no chapter, or conversion is "none", just skip OpenCC
    if (isPdf || !currentChapter) {
      setConvertedContent('');
      setConvertedHtml('');
      return;
    }

    if (settings.textConversion === 'none') {
      setConvertedContent(currentChapter.content);
      // Use raw HTML if available
      setConvertedHtml(currentChapter.html || '');
      return;
    }

    // Initialize converter if needed or changed
    try {
      if (settings.textConversion === 'cn2tw') {
        converterRef.current = OpenCC.Converter({ from: 'cn', to: 'tw' });
      } else if (settings.textConversion === 'tw2cn') {
        converterRef.current = OpenCC.Converter({ from: 'tw', to: 'cn' });
      }
      
      if (converterRef.current) {
        setConvertedContent(converterRef.current(currentChapter.content));
      } else {
        setConvertedContent(currentChapter.content);
      }
      // For now, when conversion is requested, we won't convert HTML nodes.
      // Clear convertedHtml to force text-mode rendering.
      setConvertedHtml('');
    } catch (e) {
      console.error("OpenCC conversion error:", e);
      setConvertedContent(currentChapter.content); // fallback
    }
    
  }, [currentChapter, settings.textConversion, isPdf]);

  const resetControlsTimer = useCallback(() => {
    if (controlsTimerRef.current) {
      clearTimeout(controlsTimerRef.current);
      controlsTimerRef.current = null;
    }
    if (settings.autoHideControls && showControls) {
      controlsTimerRef.current = window.setTimeout(() => {
        setShowControls(false);
      }, (settings.autoHideDuration || 3) * 1000);
    }
  }, [settings.autoHideControls, settings.autoHideDuration, showControls]);

  const handleUserInteraction = useCallback(() => {
    if (showControls) resetControlsTimer();
  }, [showControls, resetControlsTimer]);

  useEffect(() => {
    resetControlsTimer();
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, [resetControlsTimer]);

  const handleContentClick = useCallback((e: React.MouseEvent) => {
    if (contextMenu) { setContextMenu(null); return; }
    if (activeEntity) { setActiveEntity(null); return; }
    if (window.getSelection()?.toString().length) return;
    if ((e.target as HTMLElement).closest('button, a')) return;
    setShowControls(prev => !prev);
  }, [activeEntity, contextMenu]);

  // Focus Mode Scrolling
  const scrollToParagraph = useCallback((index: number) => {
    const p = document.querySelector(`[data-index="${index}"]`) as HTMLElement;
    if (!p) return;
    isAutoScrolling.current = true;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    const rect = p.getBoundingClientRect();
    const absoluteTop = window.scrollY + rect.top;
    const viewportHeight = window.innerHeight;
    const elementHeight = rect.height;
    let targetScrollY = absoluteTop - (viewportHeight / 2) + (elementHeight / 2);
    if (elementHeight > viewportHeight * 0.8) {
      targetScrollY = absoluteTop - (viewportHeight * 0.2);
    }
    setActiveParagraphIndex(index);
    window.scrollTo({ top: targetScrollY, behavior: 'smooth' });
    scrollTimeoutRef.current = window.setTimeout(() => {
      isAutoScrolling.current = false;
    }, 600);
  }, []);

  // Wheel Handler
  useEffect(() => {
     if (settings.focusMode) return;
     const handleWheel = (e: WheelEvent) => {
       if (contextMenu) setContextMenu(null); 
       if (Math.abs(e.deltaY) > 20 && showControls && settings.autoHideControls) {
          setShowControls(false);
       }
     };
     window.addEventListener('wheel', handleWheel, { passive: true });
     return () => window.removeEventListener('wheel', handleWheel);
  }, [settings.focusMode, showControls, settings.autoHideControls, contextMenu]);

  const navigatePdf = (direction: 'next' | 'prev') => {
      if (!isPdf) return;
      
      const step = settings.pdfViewMode === 'double' ? 2 : 1;
      let nextIndex = book.currentPageIndex;

      if (direction === 'next') {
          if (settings.pdfViewMode === 'double' && book.currentPageIndex === 0) {
              nextIndex = 1;
          } else {
              nextIndex += step;
          }
      } else {
           if (settings.pdfViewMode === 'double' && book.currentPageIndex === 1) {
              nextIndex = 0;
           } else {
              nextIndex -= step;
           }
      }

      if (nextIndex < 0) nextIndex = 0;
      if (nextIndex >= totalUnits) nextIndex = totalUnits - 1;
      
      if (nextIndex !== book.currentPageIndex) {
          onPageChange(nextIndex);
      }
  };

  // Keyboard Handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

      // Volume Key Navigation (mobile devices)
      if (settings.volumeKeyNav && (e.key === 'AudioVolumeUp' || e.key === 'AudioVolumeDown' || e.key === 'VolumeUp' || e.key === 'VolumeDown')) {
          e.preventDefault();
          e.stopPropagation();
          const isNext = e.key === 'AudioVolumeDown' || e.key === 'VolumeDown';
          if (isPdf && settings.pdfViewMode !== 'scroll') {
              navigatePdf(isNext ? 'next' : 'prev');
          } else if (!isPdf) {
              if (settings.focusMode) {
                  // In focus mode: navigate paragraphs
                  const totalParagraphs = contentRef.current?.querySelectorAll('div[data-index]').length || 0;
                  const currentIndex = activeParagraphIndex ?? -1;
                  if (isNext) {
                      scrollToParagraph(Math.min(currentIndex + 1, totalParagraphs - 1));
                  } else {
                      scrollToParagraph(Math.max(currentIndex - 1, 0));
                  }
              } else {
                  // Normal mode: scroll by a screenful
                  const direction = isNext ? 1 : -1;
                  const distance = window.innerHeight * 0.85;
                  window.scrollBy({ top: direction * distance, behavior: 'smooth' });
              }
          } else {
              // PDF scroll mode: scroll by a screenful
              const direction = isNext ? 1 : -1;
              const distance = window.innerHeight * 0.85;
              window.scrollBy({ top: direction * distance, behavior: 'smooth' });
          }
          return;
      }

      const isVertical = e.key === 'ArrowUp' || e.key === 'ArrowDown';
      const isHorizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight';

      // 1. Horizontal Navigation (Universal - Priority over Focus Mode Block)
      // This ensures Left/Right ALWAYS works for chapters, even in Focus Mode.
      if (isHorizontal) {
          e.preventDefault(); // Prevent default horizontal scroll
          if (e.key === 'ArrowRight') {
             if (isPdf && settings.pdfViewMode !== 'scroll') {
                  navigatePdf('next');
              } else if (!isPdf && book.currentPageIndex < totalUnits - 1) {
                  onPageChange(book.currentPageIndex + 1);
              }
          } else { // ArrowLeft
             if (isPdf && settings.pdfViewMode !== 'scroll') {
                  navigatePdf('prev');
              } else if (!isPdf && book.currentPageIndex > 0) {
                  onPageChange(book.currentPageIndex - 1);
              }
          }
          return;
      }
      
      // 2. Vertical Navigation
      if (isVertical) {
         // Case A: Focus Mode (Paragraph Navigation)
         if (settings.focusMode && !isPdf) {
            e.preventDefault();
            const totalParagraphs = contentRef.current?.querySelectorAll('div[data-index]').length || 0;
            const currentIndex = activeParagraphIndex ?? -1;
            
            const now = Date.now();
            // Simple throttle for paragraph navigation
            if (e.repeat && now - lastKeyTime.current < 100) return; 
            lastKeyTime.current = now;

            if (e.key === 'ArrowDown') {
               scrollToParagraph(Math.min(currentIndex + 1, totalParagraphs - 1));
            } else {
               scrollToParagraph(Math.max(currentIndex - 1, 0));
            }
            return;
         }

         // Case B: Normal Reading - let browser handle natively
         // Native ArrowUp/ArrowDown/Space/PageUp/PageDown scrolling is the smoothest
         return;
      }

      // 3. Other Shortcuts
      if (e.key === 'Escape') {
          if (isTOCOpen) setIsTOCOpen(false);
          else if (activeEntity) setActiveEntity(null);
          else if (contextMenu) setContextMenu(null);
          else if (showControls) onCloseBook();
          else setShowControls(true);
      }

      // 4. Block other page keys in Focus Mode to prevent disorientation
      if (settings.focusMode && !isPdf) {
         if (['Space', ' ', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) {
           e.preventDefault();
         }
      }
    };

    window.addEventListener('keydown', handleKeyDown, { passive: false });
    
    return () => {
        window.removeEventListener('keydown', handleKeyDown);
    };
  }, [book.currentPageIndex, totalUnits, isTOCOpen, activeEntity, settings.focusMode, settings.volumeKeyNav, activeParagraphIndex, scrollToParagraph, showControls, contextMenu, isPdf, settings.pdfViewMode]);

  useEffect(() => {
    if (!settings.focusMode || !contentRef.current || isPdf) return;
    const options = { root: null, rootMargin: '-45% 0px -45% 0px', threshold: 0 };
    const callback: IntersectionObserverCallback = (entries) => {
      if (isAutoScrolling.current) return;
      const visibleEntry = entries.find(entry => entry.isIntersecting);
      if (visibleEntry) {
         const index = Number(visibleEntry.target.getAttribute('data-index'));
         if (!isNaN(index)) setActiveParagraphIndex(index);
      }
    };
    const observer = new IntersectionObserver(callback, options);
    const paragraphs = contentRef.current.querySelectorAll('div[data-index]');
    paragraphs.forEach(p => observer.observe(p));
    return () => observer.disconnect();
  }, [settings.focusMode, currentChapter, isPdf]);

  // Set cursor style for images and attach delegated click handler via wrapper (onClick below)
  useEffect(() => {
    if (!contentRef.current) return;
    const imgs = Array.from(contentRef.current.querySelectorAll('img')) as HTMLImageElement[];
    imgs.forEach(img => {
      img.style.cursor = 'zoom-in';
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
    });
  }, [convertedHtml, book.currentPageIndex]);

  const isParagraphFocused = (index: number) => {
    if (!settings.focusMode || activeParagraphIndex === null) return true;
    const count = settings.focusParagraphCount || 1; 
    const half = Math.floor(count / 2);
    const start = activeParagraphIndex - half;
    const end = activeParagraphIndex + half + (count % 2 === 0 ? -1 : 0);
    return index >= start && index <= end;
  };

  // Simple HTML sanitizer: remove <script> and on* attributes
  const sanitizeHtml = (raw: string) => {
    if (!raw) return '';
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(raw, 'text/html');
      // Remove script and style tags
      doc.querySelectorAll('script, style').forEach(n => n.remove());
      // Remove event handler attributes and javascript: hrefs
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT, null);
      const toProcess: Element[] = [];
      let node = walker.nextNode();
      while (node) {
        toProcess.push(node as Element);
        node = walker.nextNode();
      }
      toProcess.forEach(el => {
        // Remove attributes starting with on (onclick, onload...)
        Array.from(el.attributes).forEach(attr => {
          if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
          if (attr.name === 'href' && attr.value.trim().toLowerCase().startsWith('javascript:')) el.removeAttribute('href');
        });
      });
      return doc.body.innerHTML;
    } catch (e) {
      console.warn('Sanitize failed', e);
      return '';
    }
  };

  const handlePdfPageVisible = useCallback((pageIdx: number) => {
      if (book.currentPageIndex !== pageIdx) {
          onPageChange(pageIdx);
      }
  }, [book.currentPageIndex, onPageChange]);

  if (!currentChapter && !isPdf) return null;

  // Use converted content instead of original chapter content
  const paragraphs = convertedContent ? convertedContent.split('\n').filter(p => p.trim().length > 0) : [];

  // Icon Logic
  const getSyncIcon = () => {
    if (!isSyncConnected) return <CloudOff className="w-3.5 h-3.5 opacity-40" />;
    if (syncStatus === 'syncing') return <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />;
    if (syncStatus === 'success') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
    if (syncStatus === 'error') return <AlertCircle className="w-3.5 h-3.5 text-red-500" />;
    return <Cloud className="w-3.5 h-3.5 opacity-60" />;
  };

  return (
    <div className={`relative min-h-screen flex flex-row transition-colors duration-500 ${themeStyles.bg} ${themeStyles.text} overflow-x-hidden`}>
      
      {/* Definition Popover */}
      {activeEntity && (
        <DefinitionPopover 
          data={activeEntity.data}
          position={activeEntity.position}
          onClose={() => setActiveEntity(null)}
          theme={settings.theme}
          isLoading={activeEntity.isLoading}
        />
      )}

      {/* Context Menu */}
      {contextMenu && (
        <>
        <div className="fixed inset-0 z-[90]" onClick={() => setContextMenu(null)} />
        <div 
           className="fixed z-[100] bg-white/90 backdrop-blur-md shadow-lg shadow-black/5 rounded-full border border-gray-100/50 p-1 flex gap-1 items-center animate-in fade-in zoom-in-95 duration-200"
           style={{ top: contextMenu.top - 50, left: contextMenu.left }} 
        >
           <button 
             onClick={(e) => { e.stopPropagation(); handleAIAction('explain'); }}
             className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-black/5 rounded-full transition-colors flex items-center gap-1.5"
           >
             <StickyNote className="w-3.5 h-3.5 text-amber-500" />
             <span>Explain</span>
           </button>
           <div className="w-px h-3 bg-gray-200"></div>
           <button 
             onClick={(e) => { e.stopPropagation(); handleAIAction('translate'); }}
             className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-black/5 rounded-full transition-colors flex items-center gap-1.5"
           >
             <Languages className="w-3.5 h-3.5 text-blue-500" />
             <span>Translate</span>
           </button>
        </div>
        </>
      )}

      {/* TOP BAR */}
      <div 
        className={`
          fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4
          transition-transform duration-300 ease-[cubic-bezier(0.2,0,0,1)]
          backdrop-blur-xl border-b shadow-sm
          ${themeStyles.text} 
          ${settings.theme === 'dark' ? 'border-white/5' : settings.theme === 'sepia' ? 'border-[#8C857B]/10' : 'border-gray-100'}
          ${showControls ? 'translate-y-0' : '-translate-y-full'}
        `}
        style={{ backgroundColor: accentBg }}
        onClick={handleUserInteraction}
      >
         {/* Left: Back Button */}
         <button 
           onClick={onCloseBook}
           className={`p-2 rounded-full ${themeStyles.hover} transition-all group`}
           title={t.back_to_shelf}
         >
           <ArrowLeft className="w-5 h-5 opacity-70 group-hover:opacity-100" />
         </button>
         
         {/* Center: Title */}
         <div className="flex-1 text-center mx-6">
            <h1 className="text-sm font-bold truncate max-w-lg mx-auto opacity-90 tracking-tight">
               {currentChapter?.title || book.title}
            </h1>
         </div>

         {/* Right: Status Info */}
         <div className="flex items-center gap-3 sm:gap-4 text-xs font-medium opacity-80">
             {/* Sync Status - Icons Only */}
             <div className="flex items-center gap-1.5" title={!isSyncConnected ? 'Local Only' : syncStatus === 'syncing' ? 'Syncing...' : syncStatus === 'success' ? 'Saved' : 'Sync Error'}>
                 {getSyncIcon()}
             </div>
             
             {/* Time */}
             <div className="hidden sm:flex items-center gap-1.5 font-mono" title="Current Time">
                <Clock className="w-3.5 h-3.5 opacity-60" />
                <span>{currentTime}</span>
             </div>

             {/* Progress */}
             <div className="flex items-center gap-1.5 font-mono" title="Reading Progress">
                <BookOpenCheck className="w-3.5 h-3.5 opacity-60" />
                <span>
                  {isPdf && settings.pdfViewMode === 'scroll' 
                      ? `${book.currentPageIndex + 1}/${totalUnits}` 
                      : isPdf 
                      ? `${book.currentPageIndex + 1}/${totalUnits}` 
                      : `${progress}%`
                  }
                </span>
             </div>
         </div>
      </div>

      {/* BOTTOM BAR */}
      <div 
        className={`
          fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4
          transition-transform duration-300 ease-[cubic-bezier(0.2,0,0,1)]
          backdrop-blur-xl border-t shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.02)]
          ${themeStyles.text}
          ${settings.theme === 'dark' ? 'border-white/5' : settings.theme === 'sepia' ? 'border-[#8C857B]/10' : 'border-gray-100'}
          ${showControls ? 'translate-y-0' : 'translate-y-full'}
        `}
        style={{ backgroundColor: accentBg }}
        onClick={handleUserInteraction}
      >
        {isPdf ? (
            /* PDF ENHANCER BAR */
            <div className="w-full flex items-center justify-between max-w-4xl mx-auto">
               <div className="flex items-center gap-2">
                 <button
                   onClick={() => setIsTOCOpen(true)}
                   className={`p-2.5 rounded-full ${themeStyles.hover} transition-colors`}
                   title={t.toc}
                 >
                   <List className="w-5 h-5" />
                 </button>
               </div>

               <div className={`flex items-center gap-4 bg-black/5 rounded-full px-4 py-1.5 ${settings.theme === 'dark' ? 'bg-white/5' : ''}`}>
                   <div className="flex items-center gap-1 border-r border-gray-400/20 pr-4 mr-1">
                      {[
                        { mode: 'scroll', icon: Scroll, label: t.pdf_scroll },
                        { mode: 'single', icon: File, label: t.pdf_single },
                        { mode: 'double', icon: Columns, label: t.pdf_spread },
                      ].map(m => (
                          <button
                            key={m.mode}
                            onClick={() => onUpdateSettings({ pdfViewMode: m.mode as PdfViewMode })}
                            className={`p-2 rounded-full transition-all ${settings.pdfViewMode === m.mode ? 'bg-white shadow-sm text-black' : 'opacity-50 hover:opacity-100'}`}
                            title={m.label}
                          >
                             <m.icon className="w-4 h-4" />
                          </button>
                      ))}
                   </div>
                   
                   <div className="flex items-center gap-2">
                      <button 
                        onClick={() => onUpdateSettings({ pdfFitMode: 'width' })}
                        className={`p-2 rounded-full transition-all ${settings.pdfFitMode === 'width' ? 'bg-white shadow-sm text-black' : 'opacity-50 hover:opacity-100'}`}
                        title="Fit Width"
                      >
                         <Scan className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => onUpdateSettings({ pdfFitMode: 'height' })}
                        className={`p-2 rounded-full transition-all ${settings.pdfFitMode === 'height' ? 'bg-white shadow-sm text-black' : 'opacity-50 hover:opacity-100'}`}
                        title="Fit Page"
                      >
                         <Scaling className="w-4 h-4" />
                      </button>

                      <div className="w-px h-4 bg-gray-400/20 mx-1"></div>

                      <button 
                        onClick={() => onUpdateSettings({ pdfFitMode: 'manual', pdfScale: Math.max(0.2, effectivePdfScale - 0.2) })}
                        className="p-1.5 opacity-60 hover:opacity-100 hover:bg-black/5 rounded-full"
                      >
                         <Minus className="w-3 h-3" />
                      </button>
                      
                      <span className="text-xs font-mono w-10 text-center opacity-80 select-none">
                         {Math.round(effectivePdfScale * 100)}%
                      </span>

                      <button 
                        onClick={() => onUpdateSettings({ pdfFitMode: 'manual', pdfScale: Math.min(5.0, effectivePdfScale + 0.2) })}
                        className="p-1.5 opacity-60 hover:opacity-100 hover:bg-black/5 rounded-full"
                      >
                         <Plus className="w-3 h-3" />
                      </button>
                   </div>
               </div>

               <button 
                 onClick={onOpenSettings}
                 className={`p-2.5 rounded-full ${themeStyles.hover} transition-colors`}
                 title={t.settings_title}
               >
                 <Settings className="w-5 h-5" />
               </button>
            </div>
        ) : (
          /* STANDARD TEXT BAR */
          <>
            <button
              onClick={() => book.currentPageIndex > 0 && onPageChange(book.currentPageIndex - 1)}
              disabled={book.currentPageIndex === 0}
              className={`p-3 rounded-full ${themeStyles.hover} disabled:opacity-30 transition-colors`}
              title={t.prev_chapter}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-6">
              <button
                onClick={() => setIsTOCOpen(true)}
                className={`p-3 rounded-full ${themeStyles.hover} transition-colors disabled:opacity-30`}
                title={t.toc}
              >
                <List className="w-5 h-5" />
              </button>

              <button 
                onClick={onToggleFocusMode}
                className={`p-3 rounded-full transition-colors ${settings.focusMode ? 'bg-blue-100 text-blue-600' : themeStyles.hover} disabled:opacity-30`}
                title={t.focus_mode}
              >
                  <Target className="w-5 h-5" />
              </button>

              <button 
                onClick={onOpenSettings}
                className={`p-3 rounded-full ${themeStyles.hover} transition-colors`}
                title={t.settings_title}
              >
                <Settings className="w-5 h-5" />
              </button>
            </div>

            <button
              onClick={() => book.currentPageIndex < totalUnits - 1 && onPageChange(book.currentPageIndex + 1)}
              disabled={book.currentPageIndex === totalUnits - 1}
              className={`p-3 rounded-full ${themeStyles.hover} disabled:opacity-30 transition-colors`}
              title={t.next_chapter}
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}
      </div>

      {/* MAIN CONTENT */}
      <main 
        onClick={handleContentClick}
        onContextMenu={handleContextMenu}
        className={`
          flex-1 flex justify-center w-full min-h-screen transition-all duration-300
          ${settings.focusMode && !isPdf ? 'py-0' : 'py-20'} 
          cursor-text
        `}
        style={{
           paddingTop: settings.focusMode && !isPdf ? '45vh' : undefined,
           paddingBottom: settings.focusMode && !isPdf ? '45vh' : undefined
        }}
      >
        <article 
          ref={contentRef}
          className={`w-full select-text transition-all duration-300 ease-in-out px-4`}
          style={{ 
            maxWidth: isPdf ? undefined : settings.maxWidth, 
            fontSize: settings.fontSize,
            lineHeight: settings.lineHeight,
            fontFamily: settings.fontFamily === 'elegant' 
              ? 'Lora, "Songti SC", serif' 
              : settings.fontFamily === 'mono'
              ? '"JetBrains Mono", monospace'
              : settings.fontFamily === 'heiti'
              ? 'Inter, "PingFang SC", sans-serif'
              : 'Merriweather, "Songti SC", serif'
          }}
        >
          {isPdf && book.pdfArrayBuffer ? (
              <PdfRenderer 
                data={book.pdfArrayBuffer} 
                pageIndex={book.currentPageIndex}
                scale={effectivePdfScale}
                theme={settings.theme}
                settings={settings}
                onPageVisible={handlePdfPageVisible}
                onLoad={(meta) => setPdfMeta(meta)}
              />
          ) : (
            <>
              {!settings.focusMode && (
                <h1 className="text-3xl font-bold mb-12 text-center opacity-80 pt-10">{currentChapter?.title}</h1>
              )}

              {convertedHtml ? (
                // Render preprocessed chapter HTML
                <div
                  className="prose max-w-none"
                  ref={contentRef}
                  onClick={(e) => {
                    const target = e.target as HTMLElement;
                    if (target && target.tagName === 'IMG') {
                      const src = (target as HTMLImageElement).src;
                      if (src) setImageModalUrl(src);
                    }
                  }}
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(convertedHtml) }}
                />
              ) : (
                paragraphs.map((text, i) => (
                  <Paragraph 
                    key={i}
                    index={i}
                    text={text}
                    isActive={isParagraphFocused(i)}
                    settings={settings}
                  />
                ))
              )}

              {/* Image preview modal */}
              {imageModalUrl && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80" onClick={() => setImageModalUrl(null)}>
                  <img src={imageModalUrl} alt="preview" className="max-w-[95%] max-h-[95%] shadow-lg" />
                </div>
              )}

              {!settings.focusMode && (
                <div className="mt-20 flex justify-between gap-4 max-w-2xl mx-auto px-6 pb-32">
                  <button 
                    onClick={(e) => { e.stopPropagation(); book.currentPageIndex > 0 && onPageChange(book.currentPageIndex - 1); }}
                    disabled={book.currentPageIndex === 0}
                    className={`
                      flex items-center gap-2 px-6 py-3 rounded-full transition-all duration-200 font-medium text-sm
                      bg-black/5 hover:bg-black/10 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-black/5
                    `}
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>{t.prev_chapter}</span>
                  </button>
                  
                  <button 
                    onClick={(e) => { e.stopPropagation(); book.currentPageIndex < totalUnits - 1 && onPageChange(book.currentPageIndex + 1); }}
                    disabled={book.currentPageIndex === totalUnits - 1}
                    className={`
                      flex items-center gap-2 px-6 py-3 rounded-full transition-all duration-200 font-medium text-sm
                      bg-black/5 hover:bg-black/10 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-black/5
                    `}
                  >
                    <span>{t.next_chapter}</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </>
          )}
        </article>
      </main>

      <TOC 
        isOpen={isTOCOpen} 
        onClose={() => setIsTOCOpen(false)}
        chapters={book.chapters}
        currentChapterIndex={book.currentPageIndex}
        onSelectChapter={onPageChange}
        currentTheme={settings.theme}
        language={language}
        toc={book.toc}
      />
    </div>
  );
};