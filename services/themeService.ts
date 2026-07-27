import { ReaderSettings } from '../types';

/**
 * Service for applying theme CSS custom variables and mobile status bar colors to the DOM.
 */
export class ThemeService {
  static applyTheme(themeName: string) {
    const isDark = themeName === 'dark';
    const isSepia = themeName === 'sepia';

    document.documentElement.classList.toggle('dark', isDark);

    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
      const color = isDark ? '#1a1a1a' : isSepia ? '#fbf0d9' : '#ffffff';
      themeColorMeta.setAttribute('content', color);
    }
  }

  /**
   * Computes average accent color from an image element or URL using off-screen canvas.
   */
  static async computeAccentColor(imageUrl?: string): Promise<string | null> {
    if (!imageUrl) return null;

    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 50;
          canvas.height = 50;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(img, 0, 0, 50, 50);
          const data = ctx.getImageData(0, 0, 50, 50).data;

          let r = 0, g = 0, b = 0, count = 0;
          for (let i = 0; i < data.length; i += 16) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count++;
          }

          if (count === 0) {
            resolve(null);
            return;
          }

          r = Math.round(r / count);
          g = Math.round(g / count);
          b = Math.round(b / count);

          resolve(`rgb(${r}, ${g}, ${b})`);
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = imageUrl;
    });
  }
}
