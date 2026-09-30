// Supabase接続設定。値を埋めると自動でSupabaseモードになる。空ならlocalStorageモックで動作。
const SUPABASE_URL = "https://wetaatzpljkxxznbtfpq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_zSQuzuDenurtfEVt1y5JgA_gM2lDaE_";
// Discord通知先（公開JSに埋め込むため荒らし耐性なし。専用チャンネル推奨）
const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1554720923180077078/vDMsrVyIiNjS9z3mB6co0fGCB2bZPbEj0jxUoaPiteAuwiS1PzPBEuUJKX8E_NAldBcr";

window.AppConfig = { SUPABASE_URL, SUPABASE_ANON_KEY, DISCORD_WEBHOOK_URL };
window.supabaseClient = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
window.isSupabaseMode = () => !!window.supabaseClient;
