import { Chapter, BookData } from '../../types';

const loadScript = (src: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
};

export const ensurePdfLibraryLoaded = async () => {
  if (!(window as any).pdfjsLib) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    await new Promise(r => setTimeout(r, 100));
    const pdfjsLib = (window as any).pdfjsLib;
    if (pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
  } else {
    const pdfjsLib = (window as any).pdfjsLib;
    if (pdfjsLib && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
  }
};

export const parsePdfFile = async (file: File): Promise<Partial<BookData>> => {
  await ensurePdfLibraryLoaded();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target?.result;
        if (!arrayBuffer || !(arrayBuffer instanceof ArrayBuffer)) {
          reject("Invalid PDF file data");
          return;
        }

        const pdfjsLib = (window as any).pdfjsLib;
        const bufferForPdf = arrayBuffer.slice(0);

        const loadingTask = pdfjsLib.getDocument(new Uint8Array(bufferForPdf));
        const pdf = await loadingTask.promise;
        const pageCount = pdf.numPages;

        let fullText = '';
        let author = 'Unknown';
        let docTitle = file.name.replace(/\.[^/.]+$/, "");
        let coverImage = undefined;
        let chapters: Chapter[] = [];

        try {
          const metadata = await pdf.getMetadata();
          if (metadata && metadata.info) {
            if (metadata.info.Author) author = metadata.info.Author;
            if (metadata.info.Title) docTitle = metadata.info.Title;
          }
        } catch (metaErr) {
          console.warn("PDF metadata extraction failed", metaErr);
        }

        try {
          const page1 = await pdf.getPage(1);
          const viewport = page1.getViewport({ scale: 1.0 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          if (context) {
            await page1.render({ canvasContext: context, viewport: viewport }).promise;
            coverImage = canvas.toDataURL('image/jpeg', 0.8);
          }
        } catch (coverErr) {
          console.warn("PDF cover generation failed", coverErr);
        }

        try {
          const outline = await pdf.getOutline();
          if (outline && outline.length > 0) {
            const processOutlineItem = async (item: any): Promise<Chapter | null> => {
              let pageIndex = 0;
              try {
                let dest = item.dest;
                if (typeof dest === 'string') {
                  dest = await pdf.getDestination(dest);
                }
                if (Array.isArray(dest)) {
                  const ref = dest[0];
                  pageIndex = await pdf.getPageIndex(ref);
                }
              } catch (e) {
                console.warn("Could not resolve outline destination", e);
              }

              return {
                title: item.title,
                content: '',
                pageNumber: pageIndex + 1
              };
            };

            for (const item of outline) {
              const chapter = await processOutlineItem(item);
              if (chapter) {
                chapters.push(chapter);
                if (item.items && item.items.length > 0) {
                  for (const subItem of item.items) {
                    const subChapter = await processOutlineItem(subItem);
                    if (subChapter) {
                      subChapter.title = "  " + subChapter.title;
                      chapters.push(subChapter);
                    }
                  }
                }
              }
            }
          }
        } catch (tocErr) {
          console.warn("PDF Outline extraction failed", tocErr);
        }

        if (chapters.length === 0) {
          chapters = [{ title: "Full Document", content: "", pageNumber: 1 }];
        }

        const maxPagesToExtract = Math.min(pdf.numPages, 10);
        for (let i = 1; i <= maxPagesToExtract; i++) {
          try {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item: any) => item.str).join(' ');
            fullText += pageText + "\n\n";
          } catch (e) {}
        }

        if (pdf.numPages > 10) {
          fullText += "\n...[Remaining PDF text not indexed for performance]...";
        }

        resolve({
          title: docTitle,
          author,
          content: fullText,
          pdfArrayBuffer: arrayBuffer,
          coverImage,
          pageCount,
          chapters,
          format: 'pdf',
        });
      } catch (err) {
        console.error("PDF Parse Error", err);
        reject(err);
      }
    };
    reader.onerror = () => reject("Error reading PDF file");
    reader.readAsArrayBuffer(file);
  });
};
