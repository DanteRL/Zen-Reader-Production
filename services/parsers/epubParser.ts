import JSZip from 'jszip';
import { Chapter, BookData } from '../../types';

/**
 * No-op function maintained for backwards compatibility.
 * EPUB parsing now uses local bundled JSZip, eliminating CDN dependencies.
 */
export const ensureEpubLibrariesLoaded = async (): Promise<void> => {
  return Promise.resolve();
};

/**
 * Safely fetches a file from JSZip with case-insensitive fallback.
 */
function getZipFile(zip: JSZip, zipPath: string): JSZip.JSZipObject | null {
  let file = zip.file(zipPath);
  if (!file) {
    const lowerPath = zipPath.toLowerCase();
    const entryName = Object.keys(zip.files).find(k => k.toLowerCase() === lowerPath);
    if (entryName) {
      file = zip.file(entryName);
    }
  }
  return file;
}

/**
 * Resolves relative file paths within an EPUB zip archive.
 * E.g., resolveZipPath('OEBPS/text/ch1.xhtml', '../images/fig1.jpg') -> 'OEBPS/images/fig1.jpg'
 */
export function resolveZipPath(basePath: string, relativePath: string): string {
  if (
    !relativePath ||
    relativePath.startsWith('http://') ||
    relativePath.startsWith('https://') ||
    relativePath.startsWith('data:')
  ) {
    return relativePath;
  }

  // Strip query parameters and anchor hashes
  const cleanRelative = relativePath.split('#')[0].split('?')[0];
  if (!cleanRelative) return '';

  if (cleanRelative.startsWith('/')) {
    return cleanRelative.slice(1);
  }

  const stack = basePath && basePath.includes('/') ? basePath.split('/').slice(0, -1) : [];
  const parts = cleanRelative.split('/');

  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      if (stack.length > 0) stack.pop();
    } else {
      stack.push(part);
    }
  }

  return stack.join('/');
}

/**
 * Returns the MIME type based on file extension.
 */
function getMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png': return 'image/png';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'svg': return 'image/svg+xml';
    case 'jpg':
    case 'jpeg':
    default:
      return 'image/jpeg';
  }
}

/**
 * Resolves asset URLs in CSS (e.g. url(../images/bg.png)) to base64 Data URLs.
 */
async function resolveCssUrls(cssText: string, cssZipPath: string, zip: JSZip): Promise<string> {
  const urlRegex = /url\((['"]?)([^'"\)]+)\1\)/g;
  let match: RegExpExecArray | null;
  const replacements: { original: string; dataUrl: string }[] = [];

  while ((match = urlRegex.exec(cssText)) !== null) {
    const rawUrl = match[2];
    if (rawUrl.startsWith('data:') || rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      continue;
    }

    const imgZipPath = resolveZipPath(cssZipPath, rawUrl);
    const imgZipFile = getZipFile(zip, imgZipPath);
    if (imgZipFile) {
      try {
        const base64 = await imgZipFile.async('base64');
        const mime = getMimeType(imgZipPath);
        replacements.push({
          original: match[0],
          dataUrl: `url("data:${mime};base64,${base64}")`
        });
      } catch (e) {
        console.warn(`Failed to convert CSS asset ${imgZipPath}`, e);
      }
    }
  }

  let resolvedCss = cssText;
  for (const rep of replacements) {
    resolvedCss = resolvedCss.split(rep.original).join(rep.dataUrl);
  }
  return resolvedCss;
}

interface ManifestItem {
  id: string;
  href: string;
  fullZipPath: string;
  mediaType: string;
  properties?: string;
}

/**
 * Best Practice EPUB File Parser.
 * Uses JSZip to extract OPF package, metadata, manifest, spine reading order,
 * EPUB 2 NCX / EPUB 3 NAV Table of Contents, inlines CSS and images as Data URLs.
 */
export const parseEpubFile = async (file: File): Promise<Partial<BookData>> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // 1. Locate OPF Rootfile from META-INF/container.xml
    let opfPath = '';
    const containerFile = getZipFile(zip, 'META-INF/container.xml');
    if (containerFile) {
      const containerXml = await containerFile.async('text');
      const parser = new DOMParser();
      const doc = parser.parseFromString(containerXml, 'text/xml');
      const rootfile = doc.querySelector('rootfile');
      if (rootfile) {
        opfPath = rootfile.getAttribute('full-path') || '';
      }
    }

    // Fallback: search zip entries for any .opf file
    if (!opfPath) {
      const opfEntry = Object.keys(zip.files).find(name => name.toLowerCase().endsWith('.opf'));
      if (opfEntry) {
        opfPath = opfEntry;
      } else {
        throw new Error('Invalid EPUB: META-INF/container.xml or OPF package document not found.');
      }
    }

    const opfFile = getZipFile(zip, opfPath);
    if (!opfFile) {
      throw new Error(`OPF document missing at path: ${opfPath}`);
    }

    // 2. Parse OPF XML
    const opfXml = await opfFile.async('text');
    const parser = new DOMParser();
    const opfDoc = parser.parseFromString(opfXml, 'text/xml');

    // 3. Extract Metadata
    const titleEl = opfDoc.querySelector('metadata > title, metadata > dc\\:title');
    const title = titleEl?.textContent?.trim() || file.name.replace(/\.[^/.]+$/, "");

    const creatorEl = opfDoc.querySelector('metadata > creator, metadata > dc\\:creator');
    const publisherEl = opfDoc.querySelector('metadata > publisher, metadata > dc\\:publisher');
    const author = creatorEl?.textContent?.trim() || publisherEl?.textContent?.trim() || 'Unknown Author';

    // 4. Build Manifest Map
    const manifestMap = new Map<string, ManifestItem>();
    const manifestElements = Array.from(opfDoc.querySelectorAll('manifest > item'));

    for (const el of manifestElements) {
      const id = el.getAttribute('id');
      const href = el.getAttribute('href');
      const mediaType = el.getAttribute('media-type') || '';
      const properties = el.getAttribute('properties') || '';

      if (id && href) {
        const fullZipPath = resolveZipPath(opfPath, href);
        manifestMap.set(id, { id, href, fullZipPath, mediaType, properties });
      }
    }

    // 5. Extract Cover Image
    let coverImage: string | undefined = undefined;
    try {
      let coverZipPath: string | null = null;

      // Check EPUB 3 cover-image property
      for (const item of manifestMap.values()) {
        if (item.properties && item.properties.includes('cover-image')) {
          coverZipPath = item.fullZipPath;
          break;
        }
      }

      // Check EPUB 2 meta cover attribute
      if (!coverZipPath) {
        const metaCover = opfDoc.querySelector('metadata > meta[name="cover"]');
        const coverId = metaCover?.getAttribute('content');
        if (coverId && manifestMap.has(coverId)) {
          coverZipPath = manifestMap.get(coverId)!.fullZipPath;
        }
      }

      // Fallback heuristic: search manifest items matching image/* with "cover" in id/href
      if (!coverZipPath) {
        for (const item of manifestMap.values()) {
          if (
            item.mediaType.startsWith('image/') &&
            (item.id.toLowerCase().includes('cover') || item.href.toLowerCase().includes('cover'))
          ) {
            coverZipPath = item.fullZipPath;
            break;
          }
        }
      }

      if (coverZipPath) {
        const coverFile = getZipFile(zip, coverZipPath);
        if (coverFile) {
          const base64 = await coverFile.async('base64');
          const mime = getMimeType(coverZipPath);
          coverImage = `data:${mime};base64,${base64}`;
        }
      }
    } catch (coverErr) {
      console.warn("Cover image extraction failed:", coverErr);
    }

    // 6. Build Table of Contents (TOC) Map: fullZipPath -> title
    const tocTitleMap = new Map<string, string>();

    // Try EPUB 3 NAV document
    const navItem = Array.from(manifestMap.values()).find(i => i.properties && i.properties.includes('nav'));
    if (navItem) {
      const navFile = getZipFile(zip, navItem.fullZipPath);
      if (navFile) {
        const navContent = await navFile.async('text');
        const navDoc = parser.parseFromString(navContent, 'text/html');
        const tocNav = navDoc.querySelector('nav[epub\\:type="toc"], nav#toc, nav');
        if (tocNav) {
          const links = Array.from(tocNav.querySelectorAll('a'));
          for (const link of links) {
            const href = link.getAttribute('href');
            const label = link.textContent?.trim();
            if (href && label) {
              const fullZipPath = resolveZipPath(navItem.fullZipPath, href);
              if (!tocTitleMap.has(fullZipPath)) {
                tocTitleMap.set(fullZipPath, label);
              }
            }
          }
        }
      }
    }

    // Try EPUB 2 NCX document if NAV map is empty
    if (tocTitleMap.size === 0) {
      const ncxItem = Array.from(manifestMap.values()).find(
        i => i.mediaType.includes('ncx') || i.id.toLowerCase().includes('ncx')
      );
      if (ncxItem) {
        const ncxFile = getZipFile(zip, ncxItem.fullZipPath);
        if (ncxFile) {
          const ncxContent = await ncxFile.async('text');
          const ncxDoc = parser.parseFromString(ncxContent, 'text/xml');
          const navPoints = Array.from(ncxDoc.querySelectorAll('navPoint'));
          for (const np of navPoints) {
            const labelEl = np.querySelector('navLabel > text');
            const contentEl = np.querySelector('content');
            const label = labelEl?.textContent?.trim();
            const href = contentEl?.getAttribute('src');
            if (href && label) {
              const fullZipPath = resolveZipPath(ncxItem.fullZipPath, href);
              if (!tocTitleMap.has(fullZipPath)) {
                tocTitleMap.set(fullZipPath, label);
              }
            }
          }
        }
      }
    }

    // 7. Parse Spine Items in Reading Order
    const itemrefs = Array.from(opfDoc.querySelectorAll('spine > itemref'));
    const chapters: Chapter[] = [];

    for (let i = 0; i < itemrefs.length; i++) {
      const idref = itemrefs[i].getAttribute('idref');
      const linear = itemrefs[i].getAttribute('linear');
      if (linear === 'no') continue;

      if (!idref || !manifestMap.has(idref)) continue;
      const manifestItem = manifestMap.get(idref)!;
      const zipFile = getZipFile(zip, manifestItem.fullZipPath);
      if (!zipFile) continue;

      const rawHtml = await zipFile.async('text');
      const doc = parser.parseFromString(rawHtml, 'text/html');

      // A. Inline CSS Stylesheets
      const linkStyles = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'));
      for (const link of linkStyles) {
        const href = link.getAttribute('href');
        if (href) {
          const cssZipPath = resolveZipPath(manifestItem.fullZipPath, href);
          const cssFile = getZipFile(zip, cssZipPath);
          if (cssFile) {
            try {
              let cssText = await cssFile.async('text');
              cssText = await resolveCssUrls(cssText, cssZipPath, zip);
              const styleEl = doc.createElement('style');
              styleEl.textContent = cssText;
              link.replaceWith(styleEl);
            } catch (cssErr) {
              console.warn(`Failed to process stylesheet ${cssZipPath}`, cssErr);
            }
          }
        }
      }

      // B. Resolve & Inline Images (<img src="..."> and <image xlink:href="...">)
      const images = Array.from(doc.querySelectorAll('img, image'));
      for (const img of images) {
        const srcAttr = img.getAttribute('src') || img.getAttribute('xlink:href');
        if (!srcAttr || srcAttr.startsWith('data:')) continue;

        const imgZipPath = resolveZipPath(manifestItem.fullZipPath, srcAttr);
        const imgZipFile = getZipFile(zip, imgZipPath);
        if (imgZipFile) {
          try {
            const base64 = await imgZipFile.async('base64');
            const mime = getMimeType(imgZipPath);
            const dataUrl = `data:${mime};base64,${base64}`;
            if (img.hasAttribute('src')) img.setAttribute('src', dataUrl);
            if (img.hasAttribute('xlink:href')) img.setAttribute('xlink:href', dataUrl);
          } catch (imgErr) {
            console.warn(`Failed to convert image ${imgZipPath}`, imgErr);
          }
        }
      }

      // C. Extract Chapter Title
      let chapterTitle = tocTitleMap.get(manifestItem.fullZipPath);
      if (!chapterTitle) {
        const heading = doc.querySelector('h1, h2, h3, header');
        if (heading && heading.textContent?.trim()) {
          chapterTitle = heading.textContent.trim();
        } else {
          const docTitle = doc.querySelector('title');
          if (docTitle && docTitle.textContent?.trim() && docTitle.textContent.trim() !== 'Untitled') {
            chapterTitle = docTitle.textContent.trim();
          }
        }
      }

      // D. Extract Text and HTML Content (including all <style> tags from <head> and <body>)
      const body = doc.body;
      if (!body) continue;

      const textContent = (body.textContent || '').trim();
      const hasImages = doc.querySelectorAll('img, svg').length > 0;

      // Skip completely empty pages without text or images
      if (textContent.length < 5 && !hasImages) {
        continue;
      }

      const styleElements = Array.from(doc.querySelectorAll('style'));
      const stylesHtml = styleElements.map(s => s.outerHTML).join('\n');
      const bodyHtml = body.innerHTML || '';
      const htmlContent = stylesHtml ? `${stylesHtml}\n${bodyHtml}` : bodyHtml;

      chapters.push({
        title: chapterTitle || `Chapter ${chapters.length + 1}`,
        content: textContent,
        html: htmlContent,
        href: manifestItem.href
      });
    }

    if (chapters.length === 0) {
      throw new Error("No readable text or content chapters found in EPUB file.");
    }

    return {
      title,
      author,
      chapters,
      coverImage,
      format: 'epub',
    };
  } catch (err) {
    console.error("EPUB Parse Error:", err);
    throw err;
  }
};
