declare const process: {
  env: Record<string, string | undefined>;
};

export const supabasePublicConfig = {
  url: process.env.EXPO_PUBLIC_SUPABASE_URL,
  anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
};

export const isSupabaseConfigured = Boolean(
  supabasePublicConfig.url && supabasePublicConfig.anonKey,
);
