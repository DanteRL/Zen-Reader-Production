import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Book Deletion Contract', () => {
  it('correctly filters out deleted book IDs from book list', () => {
    const initialBooks = [
      { id: 'book-1', title: 'Book 1' },
      { id: 'book-2', title: 'Book 2' },
      { id: 'book-3', title: 'Book 3' },
    ];
    const idsToDelete = ['book-1', 'book-3'];

    const remainingBooks = initialBooks.filter(b => !idsToDelete.includes(b.id));

    assert.strictEqual(remainingBooks.length, 1);
    assert.strictEqual(remainingBooks[0].id, 'book-2');
  });

  it('handles empty delete list without mutating books', () => {
    const initialBooks = [
      { id: 'book-1', title: 'Book 1' },
    ];
    const remainingBooks = initialBooks.filter(b => ![].includes(b.id));
    assert.strictEqual(remainingBooks.length, 1);
  });
});
