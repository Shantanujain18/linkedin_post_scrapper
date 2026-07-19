import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js";

const SESSION_KEY = "reachpodSession";

export function createSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in the extension env.");
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

export async function getStoredSession() {
  const { [SESSION_KEY]: session } = await chrome.storage.local.get(SESSION_KEY);
  return session || null;
}

export async function setStoredSession(session) {
  if (!session) {
    await chrome.storage.local.remove(SESSION_KEY);
    return;
  }
  await chrome.storage.local.set({
    [SESSION_KEY]: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      user: session.user
        ? {
            id: session.user.id,
            email: session.user.email,
            name: session.user.user_metadata?.name || session.user.email?.split("@")[0] || ""
          }
        : null
    }
  });
}

export async function clearStoredSession() {
  await chrome.storage.local.remove(SESSION_KEY);
}

export async function refreshStoredSession() {
  const stored = await getStoredSession();
  if (!stored?.refresh_token) return null;
  const supabase = createSupabase();
  const { data, error } = await supabase.auth.setSession({
    access_token: stored.access_token,
    refresh_token: stored.refresh_token
  });
  if (error || !data.session) {
    await clearStoredSession();
    return null;
  }
  await setStoredSession(data.session);
  return data.session;
}

export async function getValidAccessToken() {
  let stored = await getStoredSession();
  if (!stored?.access_token) return null;

  const expiresAtMs = (stored.expires_at || 0) * 1000;
  if (expiresAtMs && Date.now() > expiresAtMs - 60_000) {
    const refreshed = await refreshStoredSession();
    if (!refreshed) return null;
    stored = await getStoredSession();
  }
  return stored?.access_token || null;
}

export async function signIn(email, password) {
  const supabase = createSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password
  });
  if (error) throw error;
  if (!data.session) throw new Error("Sign in did not return a session.");
  await setStoredSession(data.session);
  return data.session;
}

export async function signOut() {
  try {
    const supabase = createSupabase();
    const stored = await getStoredSession();
    if (stored?.access_token) {
      await supabase.auth.setSession({
        access_token: stored.access_token,
        refresh_token: stored.refresh_token
      });
      await supabase.auth.signOut();
    }
  } catch {
    // Still clear local session.
  }
  await clearStoredSession();
}
