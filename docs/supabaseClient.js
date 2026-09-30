// Supabase接続設定。値を埋めると自動でSupabaseモードになる。空ならlocalStorageモックで動作。
const SUPABASE_URL = "https://wetaatzpljkxxznbtfpq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_zSQuzuDenurtfEVt1y5JgA_gM2lDaE_";
// ボス用合言葉（Supabase未接続時のモック用。本番はSupabase Authに置き換え）
const BOSS_PASSCODE = "豆人あずき";

window.AppConfig = { SUPABASE_URL, SUPABASE_ANON_KEY, BOSS_PASSCODE };
window.supabaseClient = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
window.isSupabaseMode = () => !!window.supabaseClient;
