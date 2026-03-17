
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
        flowType: 'implicit',  // Use implicit flow - token returned directly in URL hash
      },
    });
  }
  return supabaseInstance;
};

export const isSupabaseConfigured = (): boolean => {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
};

// Initialize and handle OAuth callback errors
export const initAuth = async (): Promise<void> => {
  const supabase = getSupabase();
  if (!supabase) return;
  
  // Check if there's an error in the URL hash (OAuth callback error)
  const hashParams = new URLSearchParams(window.location.hash.substring(1));
  const error = hashParams.get('error');
  const errorDescription = hashParams.get('error_description');
  
  if (error) {
    console.error('[Auth] OAuth error:', error, errorDescription);
    // Clear the hash to prevent repeated errors
    window.history.replaceState(null, '', window.location.pathname);
    return;
  }
  
  // Try to get the session from the URL (OAuth callback)
  try {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      console.error('[Auth] Session error:', sessionError.message);
    } else if (data.session) {
      console.log('[Auth] Session restored successfully');
    }
  } catch (e) {
    console.error('[Auth] Failed to get session:', e);
  }
  
  // Clear the URL hash after processing
  if (window.location.hash.includes('access_token') || window.location.hash.includes('error')) {
    window.history.replaceState(null, '', window.location.pathname);
  }
};

// ============================================================
// Auth Helpers
// ============================================================

/**
 * Get the redirect URL for OAuth callbacks.
 * Priority:
 * 1. REDIRECT_URL from env (for production)
 * 2. window.location.origin + pathname (fallback)
 */
const getRedirectURL = (): string => {
  const envRedirect = (process.env as any).REDIRECT_URL;
  console.log('[Auth] REDIRECT_URL from env:', envRedirect);
  console.log('[Auth] Fallback URL:', window.location.origin + window.location.pathname);
  if (envRedirect) {
    console.log('[Auth] Using env REDIRECT_URL:', envRedirect);
    return envRedirect;
  }
  // Fallback to current URL
  console.log('[Auth] Using fallback URL');
  return window.location.origin + window.location.pathname;
};

export const signInWithGitHub = async (): Promise<void> => {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: getRedirectURL(),
    },
  });
};

export const signInWithGoogle = async (): Promise<void> => {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: getRedirectURL(),
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
