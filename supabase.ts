
import { createClient, SupabaseClient, Session, User } from '@supabase/supabase-js';

// ============================================================
// Supabase Configuration
// ============================================================
// These values are safe to expose in client-side code.
// Row Level Security (RLS) on the Supabase project ensures
// that users can only access their own data.
// ============================================================

const SUPABASE_URL = (process.env as any).SUPABASE_URL || '';
const SUPABASE_ANON_KEY = (process.env as any).SUPABASE_ANON_KEY || '';

let supabaseInstance: SupabaseClient | null = null;

export const getSupabase = (): SupabaseClient | null => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return null;
  }
  if (!supabaseInstance) {
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  }
  return supabaseInstance;
};

export const isSupabaseConfigured = (): boolean => {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
};

// ============================================================
// Auth Helpers
// ============================================================

export const signInWithGitHub = async (): Promise<void> => {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: window.location.origin,
    },
  });
};

export const signInWithGoogle = async (): Promise<void> => {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
    },
  });
};

export const signInWithEmail = async (email: string, password: string): Promise<{ error: string | null }> => {
  const supabase = getSupabase();
  if (!supabase) return { error: 'Supabase not configured' };
  
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // If sign-in fails, try sign-up
    if (error.message?.includes('Invalid login credentials')) {
      const { error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) return { error: signUpError.message };
      return { error: null };
    }
    return { error: error.message };
  }
  return { error: null };
};

export const signOut = async (): Promise<void> => {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
};

export const getCurrentSession = async (): Promise<Session | null> => {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
};

export const getCurrentUser = async (): Promise<User | null> => {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user;
};

export const onAuthStateChange = (callback: (session: Session | null) => void) => {
  const supabase = getSupabase();
  if (!supabase) return { data: { subscription: { unsubscribe: () => {} } } };
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
};

export type { Session, User };
