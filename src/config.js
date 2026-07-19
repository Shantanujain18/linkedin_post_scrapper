export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3002"
).replace(/\/$/, "");

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

export const IS_PRODUCTION_API = /^https:\/\/reachpod\.vercel\.app$/i.test(API_BASE_URL);
