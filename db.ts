
import { BookData } from './types';

const DB_NAME = 'ZenReaderDB';
const DB_VERSION = 6; // Stable version with fileHash support
const STORE_NAME = 'books';
const HANDLE_STORE_NAME = 'handles';

// Helper to open DB with schema management
// This ensures that ANY time we open the DB, the onupgradeneeded logic is available
// preventing the "object store not found" error if the DB version was bumped but stores weren't created.
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error("DB Open Error:", (event.target as IDBOpenDBRequest).error);
      reject('Error opening database');
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      // Ensure 'books' store exists
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      
      // Ensure 'handles' store exists
      if (!db.objectStoreNames.contains(HANDLE_STORE_NAME)) {
        db.createObjectStore(HANDLE_STORE_NAME);
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
};

export const initDB = async (): Promise<void> => {
  const db = await openDB();
  db.close();
};

export const saveBook = async (book: BookData): Promise<void> => {
  const db = await openDB();
  try {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(book);
        
        transaction.oncomplete = () => resolve();
        transaction.onerror = (e) => reject(`Error saving book: ${(e.target as IDBRequest).error}`);
    });
  } finally {
    db.close();
  }
};

export const getAllBooks = async (): Promise<BookData[]> => {
  const db = await openDB();
  try {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        
        request.onsuccess = () => {
             const books = request.result as BookData[];
             // Sort by last read (descending)
             books.sort((a, b) => b.lastReadAt - a.lastReadAt);
             resolve(books);
        };
        request.onerror = (e) => reject(`Error fetching books: ${(e.target as IDBRequest).error}`);
    });
  } finally {
    db.close();
  }
};

export const updateBookProgress = async (id: string, pageIndex: number): Promise<void> => {
  const db = await openDB();
  try {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const data = getRequest.result as BookData;
        if (data) {
          data.currentPageIndex = pageIndex;
          data.lastReadAt = Date.now();
          store.put(data);
        }
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = (e) => reject(`Error updating progress: ${(e.target as IDBRequest).error}`);
    });
  } finally {
    db.close();
  }
};

export const deleteBook = async (id: string): Promise<void> => {
  const db = await openDB();
  try {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.delete(id);
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = (e) => reject(`Error deleting book: ${(e.target as IDBRequest).error}`);
    });
  } finally {
    db.close();
  }
};

export const saveDirectoryHandle = async (handle: any): Promise<void> => {
  const db = await openDB();
  try {
    return new Promise((resolve, reject) => {
       const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite');
       tx.objectStore(HANDLE_STORE_NAME).put(handle, 'syncDir');
       tx.oncomplete = () => resolve();
       tx.onerror = () => reject('Failed to save handle');
    });
  } finally {
    db.close();
  }
};

export const getDirectoryHandle = async (): Promise<any> => {
  // If the store doesn't exist yet (very first run on old DB), openDB will create it
  const db = await openDB();
  try {
    return new Promise((resolve, reject) => {
       const tx = db.transaction(HANDLE_STORE_NAME, 'readonly');
       const getReq = tx.objectStore(HANDLE_STORE_NAME).get('syncDir');
       getReq.onsuccess = () => resolve(getReq.result);
       getReq.onerror = () => resolve(null);
    });
  } catch (err) {
    return null;
  } finally {
    db.close();
  }
};
