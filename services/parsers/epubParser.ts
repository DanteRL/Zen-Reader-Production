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

export const ensureEpubLibrariesLoaded = async () => {
  if (!(window as any).JSZip) {
    await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
  }
  if (!(window as any).ePub) {
    await loadScript('https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js');
    await new Promise(r => setTimeout(r, 100));
  }
};

export const parseEpubFile = async (file: File): Promise<Partial<BookData>> => {
  await ensureEpubLibrariesLoaded();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target?.result;
        if (!arrayBuffer) {
          reject("Empty file");
          return;
        }

        const ePubLib = (window as any).ePub;
        if (!ePubLib) {
          throw new Error("EPUB library failed to initialize.");
        }

        const book = ePubLib(arrayBuffer);
        await book.ready;

        const metadata = await book.loaded.metadata;
        const author = metadata.creator || metadata.publisher || 'Unknown';
        const title = metadata.title || file.name.replace(/\.[^/.]+$/, "");

        const chapters: Chapter[] = [];
        const spineItems = book.spine.items;

        for (const item of spineItems) {
          if (!item.href) continue;

          const doc = await book.load(item.href);
          let text = '';
          let html = '';
          if (typeof doc === 'string') {
            const parser = new DOMParser();
            const htmlDoc = parser.parseFromString(doc, 'text/html');
            html = htmlDoc.body.innerHTML || '';
            text = htmlDoc.body.textContent || '';
          } else if (doc instanceof Document) {
            html = doc.body.innerHTML || '';
            text = doc.body.textContent || '';
          } else if (doc && doc.textContent) {
            text = doc.textContent;
          }

          text = (text || '').trim();

          if (text.length > 50) {
            let chapterTitle = "Chapter";
            const navItem = book.navigation?.toc?.find((n: any) => n.href && item.href && n.href.includes(item.href));
            if (navItem) {
              chapterTitle = navItem.label.trim();
            } else {
              const firstLine = text.split('\n')[0].substring(0, 50);
              if (firstLine.length > 0 && firstLine.length < 50) chapterTitle = firstLine;
            }

            if (html && html.length > 0) {
              try {
                const parser = new DOMParser();
                const docHtml = parser.parseFromString(html, 'text/html');
                const imgs = Array.from(docHtml.querySelectorAll('img')) as HTMLImageElement[];

                await Promise.all(imgs.map(async (img) => {
                  try {
                    const src = img.getAttribute('src') || img.src;
                    if (!src || src.startsWith('data:')) return;

                    let fetched: Response | null = null;
                    try {
                      fetched = await fetch(src);
                    } catch (e) {
                      try {
                        const base = item.href || '';
                        const baseParts = base.split('/').slice(0, -1).join('/');
                        const resolved = baseParts ? `${baseParts}/${src}` : src;
                        fetched = await fetch(resolved);
                      } catch (e2) {
                        fetched = null;
                      }
                    }

                    if (fetched && fetched.ok) {
                      const blob = await fetched.blob();
                      const dataUrl = await new Promise<string>((res) => {
                        const r = new FileReader();
                        r.onloadend = () => res(r.result as string);
                        r.readAsDataURL(blob);
                      });
                      img.setAttribute('src', dataUrl);
                      return;
                    }

                    if ((book as any).resources && typeof (book as any).resources.get === 'function') {
                      const res = await (book as any).resources.get(src);
                      if (res) {
                        let blobFromRes: Blob | null = null;
                        if (res instanceof Blob) blobFromRes = res;
                        else if (res instanceof ArrayBuffer) blobFromRes = new Blob([res]);
                        else if (res.buffer && res.buffer instanceof ArrayBuffer) blobFromRes = new Blob([res.buffer]);

                        if (blobFromRes) {
                          const dataUrl = await new Promise<string>((res) => {
                            const r = new FileReader();
                            r.onloadend = () => res(r.result as string);
                            r.readAsDataURL(blobFromRes as Blob);
                          });
                          img.setAttribute('src', dataUrl);
                        }
                      }
                    }
                  } catch (imgErr) {
                    console.warn('Image processing failed', imgErr);
                  }
                }));

                html = docHtml.body.innerHTML || html;
              } catch (procErr) {
                console.warn('Failed to process chapter HTML images', procErr);
              }
            }

            chapters.push({
              title: chapterTitle,
              content: text,
              html: html || undefined,
              href: item.href
            });
          }
        }

        let coverImage: string | undefined;
        try {
          const coverUrl = await book.coverUrl();
          if (coverUrl) {
            const response = await fetch(coverUrl);
            const blob = await response.blob();
            coverImage = await new Promise((res) => {
              const r = new FileReader();
              r.onloadend = () => res(r.result as string);
              r.readAsDataURL(blob);
            });
          }
        } catch (coverErr) {
          console.warn("Could not extract cover image", coverErr);
        }

        if (chapters.length === 0) {
          reject("No readable text content found in EPUB");
          return;
        }

        resolve({
          title,
          author,
          chapters,
          coverImage,
          format: 'epub',
        });
      } catch (err) {
        console.error("EPUB Parse Error", err);
        reject(err);
      }
    };
    reader.onerror = () => reject("Error reading file");
    reader.readAsArrayBuffer(file);
  });
};
