import * as OpenCC from 'opencc-js';

/**
 * TextConverter Module
 * Provides cached OpenCC converters for Traditional and Simplified Chinese conversion.
 */
export class TextConverter {
  private static s2tConverter: ((text: string) => string) | null = null;
  private static t2sConverter: ((text: string) => string) | null = null;

  static convert(text: string, mode: 'original' | 's2t' | 't2s'): string {
    if (!text || mode === 'original') return text;

    if (mode === 's2t') {
      if (!this.s2tConverter) {
        this.s2tConverter = OpenCC.Converter({ from: 'cn', to: 'hk' });
      }
      return this.s2tConverter(text);
    }

    if (mode === 't2s') {
      if (!this.t2sConverter) {
        this.t2sConverter = OpenCC.Converter({ from: 'hk', to: 'cn' });
      }
      return this.t2sConverter(text);
    }

    return text;
  }
}
