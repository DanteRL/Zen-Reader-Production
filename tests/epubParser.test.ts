import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveZipPath } from '../services/parsers/epubParser.js';

describe('epubParser - resolveZipPath', () => {
  it('resolves simple relative paths in the same directory', () => {
    assert.strictEqual(resolveZipPath('OEBPS/content.opf', 'ch01.xhtml'), 'OEBPS/ch01.xhtml');
  });

  it('resolves relative paths going up directory hierarchy with ../', () => {
    assert.strictEqual(resolveZipPath('OEBPS/text/ch01.xhtml', '../images/cover.jpg'), 'OEBPS/images/cover.jpg');
    assert.strictEqual(resolveZipPath('OEBPS/text/sub/ch01.xhtml', '../../images/cover.jpg'), 'OEBPS/images/cover.jpg');
  });

  it('handles absolute or URL paths unchanged', () => {
    assert.strictEqual(resolveZipPath('OEBPS/ch01.xhtml', 'https://example.com/logo.png'), 'https://example.com/logo.png');
    assert.strictEqual(resolveZipPath('OEBPS/ch01.xhtml', 'data:image/png;base64,123'), 'data:image/png;base64,123');
  });

  it('strips anchor hashes and query parameters when resolving zip path', () => {
    assert.strictEqual(resolveZipPath('OEBPS/text/ch1.xhtml', '../images/fig.png#section1'), 'OEBPS/images/fig.png');
    assert.strictEqual(resolveZipPath('OEBPS/text/ch1.xhtml', '../images/fig.png?v=1'), 'OEBPS/images/fig.png');
  });
});
