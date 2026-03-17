
import { getSupabase } from './supabase';

// ============================================================
// Cloud Sync Module — Dual-Track Sync
// ============================================================
//
// Track 1 (Auto): Hash-based. Same file content → same hash → seamless sync.
// Track 2 (Manual): Logical association. User manually links two different
//   files (e.g. EPUB on device A, TXT on device B) to share progress.
//
// Supabase Tables (create via SQL editor in Supabase dashboard):
//
// -- Table: reading_progress
// CREATE TABLE reading_progress (
//   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
//   user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
//   file_hash TEXT NOT NULL,
//   book_title TEXT NOT NULL,
//   author TEXT,
//   current_page_index INTEGER NOT NULL DEFAULT 0,
//   total_pages INTEGER NOT NULL DEFAULT 1,
//   last_read_at BIGINT NOT NULL DEFAULT 0,
//   created_at TIMESTAMPTZ DEFAULT NOW(),
//   updated_at TIMESTAMPTZ DEFAULT NOW(),
//   UNIQUE(user_id, file_hash)
// );
//
// -- Table: book_links (logical association)
// CREATE TABLE book_links (
//   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
//   user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
//   source_hash TEXT NOT NULL,
//   target_hash TEXT NOT NULL,
//   created_at TIMESTAMPTZ DEFAULT NOW(),
//   UNIQUE(user_id, source_hash)
// );
//
// -- RLS Policies (IMPORTANT: enable RLS on both tables)
// ALTER TABLE reading_progress ENABLE ROW LEVEL SECURITY;
// ALTER TABLE book_links ENABLE ROW LEVEL SECURITY;
//
// CREATE POLICY "Users can manage own progress"
//   ON reading_progress FOR ALL USING (auth.uid() = user_id);
//
// CREATE POLICY "Users can manage own links"
//   ON book_links FOR ALL USING (auth.uid() = user_id);
//
// ============================================================

export interface CloudProgress {
  id?: string;
  file_hash: string;
  book_title: string;
  author?: string;
  current_page_index: number;
  total_pages: number;
  last_read_at: number;
}

export interface BookLink {
  id?: string;
  source_hash: string;
  target_hash: string;
}

// ============================================================
// Hash Computation
// ============================================================

/**
 * Compute a SHA-256 hash of a file's content.
 * Uses the Web Crypto API (available in all modern browsers).
 * For large files (e.g. PDFs), we hash the first 1MB + file size for speed.
 */
export const computeFileHash = async (file: File): Promise<string> => {
  const CHUNK_SIZE = 1024 * 1024; // 1MB
  let buffer: ArrayBuffer;

  if (file.size <= CHUNK_SIZE) {
    buffer = await file.arrayBuffer();
  } else {
    // For large files, hash first 1MB + last 1MB + file size
    const firstChunk = await file.slice(0, CHUNK_SIZE).arrayBuffer();
    const lastChunk = await file.slice(-CHUNK_SIZE).arrayBuffer();
    const sizeBytes = new TextEncoder().encode(file.size.toString());

    const combined = new Uint8Array(firstChunk.byteLength + lastChunk.byteLength + sizeBytes.byteLength);
    combined.set(new Uint8Array(firstChunk), 0);
    combined.set(new Uint8Array(lastChunk), firstChunk.byteLength);
    combined.set(sizeBytes, firstChunk.byteLength + lastChunk.byteLength);
    buffer = combined.buffer;
  }

  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Compute hash from ArrayBuffer (for books already loaded into memory, e.g. PDF).
 */
export const computeBufferHash = async (arrayBuffer: ArrayBuffer, fileSize: number): Promise<string> => {
  const CHUNK_SIZE = 1024 * 1024;
  let buffer: ArrayBuffer;

  if (arrayBuffer.byteLength <= CHUNK_SIZE) {
    buffer = arrayBuffer;
  } else {
    const firstChunk = arrayBuffer.slice(0, CHUNK_SIZE);
    const lastChunk = arrayBuffer.slice(-CHUNK_SIZE);
    const sizeBytes = new TextEncoder().encode(fileSize.toString());

    const combined = new Uint8Array(firstChunk.byteLength + lastChunk.byteLength + sizeBytes.byteLength);
    combined.set(new Uint8Array(firstChunk), 0);
    combined.set(new Uint8Array(lastChunk), firstChunk.byteLength);
    combined.set(sizeBytes, firstChunk.byteLength + lastChunk.byteLength);
    buffer = combined.buffer;
  }

  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

// ============================================================
// Track 1: Auto Sync (Hash-based)
// ============================================================

/**
 * Push local reading progress to the cloud.
 * Uses UPSERT so it creates or updates.
 */
export const pushProgress = async (
  userId: string,
  progress: CloudProgress
): Promise<boolean> => {
  const supabase = getSupabase();
  if (!supabase) return false;

  const { error } = await supabase
    .from('reading_progress')
    .upsert(
      {
        user_id: userId,
        file_hash: progress.file_hash,
        book_title: progress.book_title,
        author: progress.author || null,
        current_page_index: progress.current_page_index,
        total_pages: progress.total_pages,
        last_read_at: progress.last_read_at,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,file_hash' }
    );

  if (error) {
    console.error('[CloudSync] Push progress failed:', error.message);
    return false;
  }
  return true;
};

/**
 * Pull reading progress from the cloud for a specific file hash.
 * Also checks book_links for logical associations.
 */
export const pullProgress = async (
  userId: string,
  fileHash: string
): Promise<CloudProgress | null> => {
  const supabase = getSupabase();
  if (!supabase) return null;

  // 1. Direct hash match
  const { data: directMatch, error: directError } = await supabase
    .from('reading_progress')
    .select('*')
    .eq('user_id', userId)
    .eq('file_hash', fileHash)
    .single();

  if (directMatch && !directError) {
    return {
      id: directMatch.id,
      file_hash: directMatch.file_hash,
      book_title: directMatch.book_title,
      author: directMatch.author,
      current_page_index: directMatch.current_page_index,
      total_pages: directMatch.total_pages,
      last_read_at: directMatch.last_read_at,
    };
  }

  // 2. Check book_links for logical association
  const { data: link } = await supabase
    .from('book_links')
    .select('target_hash')
    .eq('user_id', userId)
    .eq('source_hash', fileHash)
    .single();

  if (link?.target_hash) {
    const { data: linkedMatch } = await supabase
      .from('reading_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('file_hash', link.target_hash)
      .single();

    if (linkedMatch) {
      return {
        id: linkedMatch.id,
        file_hash: linkedMatch.file_hash,
        book_title: linkedMatch.book_title,
        author: linkedMatch.author,
        current_page_index: linkedMatch.current_page_index,
        total_pages: linkedMatch.total_pages,
        last_read_at: linkedMatch.last_read_at,
      };
    }
  }

  // 3. Also check reverse links (if THIS hash is the target of another source)
  const { data: reverseLink } = await supabase
    .from('book_links')
    .select('source_hash')
    .eq('user_id', userId)
    .eq('target_hash', fileHash)
    .single();

  if (reverseLink?.source_hash) {
    const { data: reverseMatch } = await supabase
      .from('reading_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('file_hash', reverseLink.source_hash)
      .single();

    if (reverseMatch) {
      return {
        id: reverseMatch.id,
        file_hash: reverseMatch.file_hash,
        book_title: reverseMatch.book_title,
        author: reverseMatch.author,
        current_page_index: reverseMatch.current_page_index,
        total_pages: reverseMatch.total_pages,
        last_read_at: reverseMatch.last_read_at,
      };
    }
  }

  return null;
};

// ============================================================
// Track 2: Manual Sync (Logical Association)
// ============================================================

/**
 * Fetch all recent reading progress entries for the user.
 * Used to display in the "Link Progress" UI.
 */
export const fetchAllProgress = async (
  userId: string
): Promise<CloudProgress[]> => {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('reading_progress')
    .select('*')
    .eq('user_id', userId)
    .order('last_read_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[CloudSync] Fetch all progress failed:', error.message);
    return [];
  }

  return (data || []).map((d: any) => ({
    id: d.id,
    file_hash: d.file_hash,
    book_title: d.book_title,
    author: d.author,
    current_page_index: d.current_page_index,
    total_pages: d.total_pages,
    last_read_at: d.last_read_at,
  }));
};

/**
 * Create a logical link between two file hashes.
 * source_hash = the current local file's hash
 * target_hash = the cloud progress entry's file hash to link to
 */
export const createBookLink = async (
  userId: string,
  sourceHash: string,
  targetHash: string
): Promise<boolean> => {
  const supabase = getSupabase();
  if (!supabase) return false;

  const { error } = await supabase
    .from('book_links')
    .upsert(
      {
        user_id: userId,
        source_hash: sourceHash,
        target_hash: targetHash,
      },
      { onConflict: 'user_id,source_hash' }
    );

  if (error) {
    console.error('[CloudSync] Create book link failed:', error.message);
    return false;
  }
  return true;
};

/**
 * Remove a logical link.
 */
export const removeBookLink = async (
  userId: string,
  sourceHash: string
): Promise<boolean> => {
  const supabase = getSupabase();
  if (!supabase) return false;

  const { error } = await supabase
    .from('book_links')
    .delete()
    .eq('user_id', userId)
    .eq('source_hash', sourceHash);

  if (error) {
    console.error('[CloudSync] Remove book link failed:', error.message);
    return false;
  }
  return true;
};

/**
 * Delete a progress entry from the cloud.
 */
export const deleteCloudProgress = async (
  userId: string,
  fileHash: string
): Promise<boolean> => {
  const supabase = getSupabase();
  if (!supabase) return false;

  const { error } = await supabase
    .from('reading_progress')
    .delete()
    .eq('user_id', userId)
    .eq('file_hash', fileHash);

  if (error) {
    console.error('[CloudSync] Delete progress failed:', error.message);
    return false;
  }
  return true;
};

// ============================================================
// Bulk Sync — Push all local books' progress to cloud
// ============================================================

export interface LocalBookForSync {
  fileHash: string;
  title: string;
  author?: string;
  currentPageIndex: number;
  totalPages: number;
  lastReadAt: number;
}

/**
 * Sync all local books to the cloud.
 * Strategy: "Last Write Wins" — whichever timestamp is newer takes precedence.
 */
export const syncAllProgress = async (
  userId: string,
  localBooks: LocalBookForSync[]
): Promise<{
  pulled: { fileHash: string; pageIndex: number; lastReadAt: number }[];
  pushed: number;
  errors: number;
}> => {
  const supabase = getSupabase();
  if (!supabase) return { pulled: [], pushed: 0, errors: 0 };

  const result = { pulled: [] as { fileHash: string; pageIndex: number; lastReadAt: number }[], pushed: 0, errors: 0 };

  // 1. Fetch all cloud progress for this user
  const { data: cloudData, error: fetchError } = await supabase
    .from('reading_progress')
    .select('*')
    .eq('user_id', userId);

  if (fetchError) {
    console.error('[CloudSync] Bulk fetch failed:', fetchError.message);
    return { pulled: [], pushed: 0, errors: 1 };
  }

  const cloudMap = new Map<string, any>();
  (cloudData || []).forEach((item: any) => {
    cloudMap.set(item.file_hash, item);
  });

  // 2. Also fetch all book_links for this user to resolve associations
  const { data: linksData } = await supabase
    .from('book_links')
    .select('*')
    .eq('user_id', userId);

  const linksMap = new Map<string, string>(); // source -> target
  const reverseLinksMap = new Map<string, string>(); // target -> source
  (linksData || []).forEach((link: any) => {
    linksMap.set(link.source_hash, link.target_hash);
    reverseLinksMap.set(link.target_hash, link.source_hash);
  });

  // 3. For each local book, merge with cloud
  for (const local of localBooks) {
    if (!local.fileHash) continue;

    // Find cloud progress: direct match or via link
    let cloudEntry = cloudMap.get(local.fileHash);
    if (!cloudEntry) {
      const linkedTarget = linksMap.get(local.fileHash);
      if (linkedTarget) cloudEntry = cloudMap.get(linkedTarget);
    }
    if (!cloudEntry) {
      const linkedSource = reverseLinksMap.get(local.fileHash);
      if (linkedSource) cloudEntry = cloudMap.get(linkedSource);
    }

    if (cloudEntry) {
      const cloudTime = cloudEntry.last_read_at || 0;
      const localTime = local.lastReadAt || 0;

      if (cloudTime > localTime) {
        // Cloud is newer → pull
        result.pulled.push({
          fileHash: local.fileHash,
          pageIndex: cloudEntry.current_page_index,
          lastReadAt: cloudEntry.last_read_at,
        });
      } else if (localTime > cloudTime) {
        // Local is newer → push
        const ok = await pushProgress(userId, {
          file_hash: local.fileHash,
          book_title: local.title,
          author: local.author,
          current_page_index: local.currentPageIndex,
          total_pages: local.totalPages,
          last_read_at: local.lastReadAt,
        });
        if (ok) result.pushed++;
        else result.errors++;
      }
      // If equal, do nothing
    } else {
      // No cloud entry → push local
      const ok = await pushProgress(userId, {
        file_hash: local.fileHash,
        book_title: local.title,
        author: local.author,
        current_page_index: local.currentPageIndex,
        total_pages: local.totalPages,
        last_read_at: local.lastReadAt,
      });
      if (ok) result.pushed++;
      else result.errors++;
    }
  }

  return result;
};
