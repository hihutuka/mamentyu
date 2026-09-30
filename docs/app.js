// GANG REIMBURSE — Technology Editorial UI
// データ層: Supabase接続時は共有DB、失敗/未設定時はlocalStorageに自動切替
const CRIME_TYPES = [
  { id: 1, category: "準大型", name: "客船", capacity: 12 },
  { id: 2, category: "準大型", name: "ボブキャット", capacity: 12 },
  { id: 3, category: "準大型", name: "美術館", capacity: 12 },
  { id: 4, category: "大型", name: "飛行場", capacity: 12 },
  { id: 5, category: "大型", name: "アーティファクト", capacity: 15 },
  { id: 6, category: "大型", name: "ユニオン", capacity: 15 },
  { id: 7, category: "大型", name: "カジノ", capacity: 15 },
];
const LS = { jobs: "gang_jobs_v1", claims: "gang_claims_v1", members: "gang_members_v1", pool: "gang_pool_v1", boss: "gang_boss_v1" };
const sb = () => window.supabaseClient;
const loadLS = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const saveLS = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isBoss = () => sessionStorage.getItem(LS.boss) === "1";
const yen = (n) => (Number(n) || 0).toLocaleString("ja-JP") + "円";
const claimTotal = (c) => (Number(c.fine_amount) || 0) + (c.medic_used ? (Number(c.medic_cost) || 0) : 0) + (Number(c.other_cost) || 0);
let crimeFilter = 0;
let MODE = "local";
let CACHE = { members: [], jobs: [], claims: [], pool: [] };

async function notifyDiscord(text) {
  const url = localStorage.getItem("gang_webhook") || window.AppConfig.DISCORD_WEBHOOK_URL;
  if (!url) return;
  try { await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: text }) }); }
  catch (e) { console.warn("discord notify failed", e); }
}

// ---------- store ----------
function loadLocal() {
  CACHE = { members: loadLS(LS.members, []), jobs: loadLS(LS.jobs, []), claims: loadLS(LS.claims, []), pool: loadLS(LS.pool, []) };
}
function persistLocal() {
  saveLS(LS.members, CACHE.members); saveLS(LS.jobs, CACHE.jobs); saveLS(LS.claims, CACHE.claims); saveLS(LS.pool, CACHE.pool);
}
async function pullRemote() {
  const [m, j, p, c, t] = await Promise.all([
    sb().from("members").select("id,name,role,is_active"),
    sb().from("crime_jobs").select("id,crime_type_id,occurred_at,location,memo,status,created_at").order("created_at", { ascending: false }),
    sb().from("job_participants").select("job_id,member_id"),
    sb().from("expense_claims").select("id,job_id,member_id,fine_amount,medic_used,medic_cost,other_cost,status,note,updated_at"),
    sb().from("pool_transactions").select("id,type,amount,memo,claim_id,job_id,created_at").order("created_at", { ascending: true }),
  ]);
  for (const r of [m, j, p, c, t]) if (r.error) throw r.error;
  const byId = Object.fromEntries(m.data.map(x => [x.id, x]));
  const parts = {};
  p.data.forEach(r => { (parts[r.job_id] = parts[r.job_id] || []).push(byId[r.member_id] ? byId[r.member_id].name : "?"); });
  CACHE = {
    members: m.data,
    jobs: j.data.map(x => ({ ...x, participants: parts[x.id] || [] })),
    claims: c.data.map(x => ({ ...x, member_name: byId[x.member_id] ? byId[x.member_id].name : "?" })),
    pool: t.data,
  };
}
async function boot() {
  if (sb()) { try { await pullRemote(); MODE = "remote"; } catch (e) { console.warn("supabase fallback to local", e); loadLocal(); MODE = "local"; } }
  else loadLocal();
}
const poolBalance = () => CACHE.pool.reduce((s, t) => s + (t.type === "入金" ? t.amount : -t.amount), 0);

async function ensureMember(name) {
  name = (name || "").trim();
  if (!name) return null;
  let m = CACHE.members.find(x => x.name === name);
  if (m) return m;
  if (MODE === "remote") {
    const r = await sb().from("members").upsert({ name }, { onConflict: "name" }).select("id,name,role,is_active");
    if (r.error) throw r.error;
    m = r.data[0] || (await sb().from("members").select("id,name,role,is_active").eq("name", name).single()).data;
  } else {
    m = { id: uid(), name, role: "member", is_active: true };
  }
  if (!CACHE.members.some(x => x.name === name)) CACHE.members.push(m);
  if (MODE === "local") persistLocal();
  return m;
}
function crimeName(id) { const t = CRIME_TYPES.find(x => x.id === Number(id)); return t ? `${t.category} ${t.name}` : "-"; }
function memberSelectHTML(field, placeholder) {
  const act = CACHE.members.filter(m => m.is_active !== false);
  if (!act.length) return `<input name="${field}" placeholder="${placeholder}" />`;
  return `<select name="${field}">${act.map(m => `<option value="${esc(m.name)}">${esc(m.name)}（${esc(m.role)}）</option>`).join("")}</select>
  <input name="new${field}" placeholder="新規の場合は入力" style="margin-top:8px;" />`;
}
function statusBadge(s) {
  const cls = s === "完了" || s === "補填済み" ? "b-done" : s === "精算中" || s === "申請中" ? "b-progress" : "b-open";
  return `<span class="badge ${cls}">${esc(s)}</span>`;
}
function setChrome(route) {
  document.getElementById("modeBadge").textContent =
    (MODE === "remote" ? "SUPABASE // SHARED" : "SUPABASE // LOCAL") + " / " + (isBoss() ? "LOGIN中" : "未ログイン");
  const poolEl = document.getElementById("poolBadge");
  if (isBoss()) { poolEl.style.display = ""; poolEl.innerHTML = `POOL <b>${yen(poolBalance())}</b>`; }
  else { poolEl.style.display = "none"; }
  const btn = document.getElementById("loginBtn");
  btn.textContent = isBoss() ? "login中" : "LOGIN";
  btn.classList.toggle("on", isBoss());
  document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("active", a.dataset.nav === route));
}

// ---------- actions ----------
window.createJob = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const row = { crime_type_id: Number(fd.get("crime_type_id")), occurred_at: fd.get("occurred_at") ? new Date(fd.get("occurred_at")).toISOString() : new Date().toISOString(), location: fd.get("location") || "", memo: fd.get("memo") || "", status: "受付中" };
  if (MODE === "remote") {
    const r = await sb().from("crime_jobs").insert(row).select("id,crime_type_id,occurred_at,location,memo,status,created_at").single();
    if (r.error) return alert("作成失敗: " + r.error.message);
    CACHE.jobs.unshift({ ...r.data, participants: [] });
  } else {
    CACHE.jobs.unshift({ id: uid(), ...row, participants: [], created_at: new Date().toISOString() });
    persistLocal();
  }
  location.hash = "#/jobs";
  notifyDiscord(`【枠作成】${crimeName(row.crime_type_id)} / ${(row.occurred_at || "").slice(0, 16)}${row.location ? " / " + row.location : ""}${row.memo ? " / " + row.memo : ""}`);
  render();
};
window.joinJob = async (jobId, e) => {
  e.preventDefault();
  const fd0 = new FormData(e.target);
  const name = ((fd0.get("newname") || "").trim() || (fd0.get("name") || "").trim());
  if (!name) return alert("名前を選択または入力");
  const m = await ensureMember(name);
  if (m.is_active === false && !isBoss()) return alert("無効化されています（ボスに連絡）");
  const j = CACHE.jobs.find(x => String(x.id) === String(jobId));
  if (!j) return;
  if (j.status === "完了" && !isBoss()) return alert("この枠は完了済みです");
  if (MODE === "remote") {
    const r = await sb().from("job_participants").upsert({ job_id: jobId, member_id: m.id }, { onConflict: "job_id,member_id" });
    if (r.error) return alert("参加失敗: " + r.error.message);
    if (j.status === "受付中") await sb().from("crime_jobs").update({ status: "精算中" }).eq("id", jobId);
  }
  if (!j.participants.includes(name)) j.participants.push(name);
  if (j.status === "受付中") j.status = "精算中";
  if (MODE === "local") persistLocal();
  render();
};
window.submitClaim = async (jobId, e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const name = ((fd.get("newname") || "").trim() || (fd.get("name") || "").trim());
  if (!name) return alert("名前を選択または入力");
  const cur = CACHE.claims.find(c => String(c.job_id) === String(jobId) && c.member_name === name);
  if (cur && cur.status === "補填済み" && !isBoss()) return alert("補填済みのため編集不可（ボスに連絡）");
  const jobSt = CACHE.jobs.find(x => String(x.id) === String(jobId));
  if (jobSt && jobSt.status === "完了" && !isBoss()) return alert("この枠は完了済みです（ボスに連絡）");
  const m = await ensureMember(name);
  if (m.is_active === false && !isBoss()) return alert("無効化されています（ボスに連絡）");
  const medic_used = fd.get("medic_used") === "on";
  const row = { job_id: jobId, member_id: m.id, fine_amount: Number(fd.get("fine_amount")) || 0, medic_used, medic_cost: medic_used ? (Number(fd.get("medic_cost")) || 0) : 0, other_cost: Number(fd.get("other_cost")) || 0, status: "申請中", note: fd.get("note") || "" };
  if (MODE === "remote") {
    const r = await sb().from("expense_claims").upsert(row, { onConflict: "job_id,member_id" }).select("id,job_id,member_id,fine_amount,medic_used,medic_cost,other_cost,status,note,updated_at").single();
    if (r.error) return alert("申告失敗: " + r.error.message);
    const i = CACHE.claims.findIndex(c => String(c.job_id) === String(jobId) && c.member_name === name);
    const rec = { ...r.data, member_name: name };
    if (i >= 0) CACHE.claims[i] = rec; else CACHE.claims.push(rec);
    await sb().from("job_participants").upsert({ job_id: jobId, member_id: m.id }, { onConflict: "job_id,member_id" });
    const j = CACHE.jobs.find(x => String(x.id) === String(jobId));
    if (j && !j.participants.includes(name)) j.participants.push(name);
  } else {
    const rec = { id: cur ? cur.id : uid(), ...row, member_name: name, updated_at: new Date().toISOString() };
    const i = CACHE.claims.findIndex(c => String(c.job_id) === String(jobId) && c.member_name === name);
    if (i >= 0) CACHE.claims[i] = rec; else CACHE.claims.push(rec);
    const j = CACHE.jobs.find(x => String(x.id) === String(jobId));
    if (j && !j.participants.includes(name)) j.participants.push(name);
    persistLocal();
  }
  const sj = CACHE.jobs.find(x => String(x.id) === String(jobId));
  notifyDiscord(`【申告】${sj ? crimeName(sj.crime_type_id) : ""} / ${name} / 合計${yen(claimTotal(row))}（罰金${yen(row.fine_amount)} 個人医${row.medic_used ? yen(row.medic_cost) : "なし"} 他${yen(row.other_cost)}）`);
  render();
};
async function markPaidRemote(c) {
  const r = await sb().from("expense_claims").update({ status: "補填済み" }).eq("id", c.id);
  if (r.error) return alert("更新失敗: " + r.error.message);
  const exists = await sb().from("pool_transactions").select("id").eq("claim_id", c.id).limit(1);
  if (!exists.error && exists.data.length === 0) {
    const boss = CACHE.members.find(x => x.role === "boss" || x.role === "underboss");
    await sb().from("pool_transactions").insert({ type: "出金", amount: claimTotal(c), claim_id: c.id, job_id: c.job_id, handled_by: boss ? boss.id : null, memo: c.member_name + " 補填" });
  }
  const rest = await sb().from("expense_claims").select("status").eq("job_id", c.job_id);
  if (!rest.error && rest.data.length && rest.data.every(x => x.status === "補填済み")) {
    await sb().from("crime_jobs").update({ status: "完了" }).eq("id", c.job_id);
    const j = CACHE.jobs.find(x => String(x.id) === String(c.job_id));
    if (j) j.status = "完了";
  }
  await pullRemote();
}
window.markPaid = async (claimId) => {
  if (!isBoss()) return alert("ボス-loginが必要");
  const c = CACHE.claims.find(x => String(x.id) === String(claimId));
  if (!c) return;
  const need = claimTotal(c);
  if (poolBalance() < need && !confirm(`プール残高${yen(poolBalance())}に対し${yen(need)}必要です。残高不足ですが続行しますか？`)) return;
  if (MODE === "remote") { await markPaidRemote(c); }
  else {
    c.status = "補填済み"; c.updated_at = new Date().toISOString();
    if (!CACHE.pool.some(t => t.claim_id === claimId)) {
      const boss = CACHE.members.find(x => x.role === "boss" || x.role === "underboss");
      CACHE.pool.push({ id: uid(), type: "出金", amount: claimTotal(c), claim_id: claimId, job_id: c.job_id, handled_by: boss ? boss.name : "boss", memo: c.member_name + " 補填", created_at: new Date().toISOString() });
    }
    const j = CACHE.jobs.find(x => String(x.id) === String(c.job_id));
    if (j) {
      const js = CACHE.claims.filter(x => String(x.job_id) === String(j.id));
      if (js.length && js.every(x => x.status === "補填済み")) j.status = "完了";
      else if (j.status === "受付中") j.status = "精算中";
    }
    persistLocal();
  }
  const pj = CACHE.jobs.find(x => String(x.id) === String(c.job_id));
  notifyDiscord(`【補填済み】${pj ? crimeName(pj.crime_type_id) : ""} / ${c.member_name} / ${yen(need)}`);
  render();
};
window.markAllPaid = async (jobId) => {
  if (!isBoss()) return alert("ボス-loginが必要");
  const targets = CACHE.claims.filter(c => String(c.job_id) === String(jobId) && c.status !== "補填済み");
  const need = targets.reduce((s, c) => s + claimTotal(c), 0);
  if (need > 0 && poolBalance() < need && !confirm(`プール残高${yen(poolBalance())}に対し${yen(need)}必要です。残高不足ですが続行しますか？`)) return;
  if (MODE === "remote") {
    const r = await sb().from("expense_claims").update({ status: "補填済み" }).eq("job_id", jobId);
    if (r.error) return alert("更新失敗: " + r.error.message);
    await sb().from("crime_jobs").update({ status: "完了" }).eq("id", jobId);
    const claims = CACHE.claims.filter(c => String(c.job_id) === String(jobId));
    for (const c of claims) {
      const exists = await sb().from("pool_transactions").select("id").eq("claim_id", c.id).limit(1);
      if (!exists.error && exists.data.length === 0) {
        await sb().from("pool_transactions").insert({ type: "出金", amount: claimTotal(c), claim_id: c.id, job_id: jobId, handled_by: null, memo: c.member_name + " 一括補填" });
      }
    }
    await pullRemote();
  } else {
    CACHE.claims.forEach(c => { if (String(c.job_id) === String(jobId)) { c.status = "補填済み"; c.updated_at = new Date().toISOString(); } });
    const j = CACHE.jobs.find(x => String(x.id) === String(jobId));
    if (j) j.status = "完了";
    CACHE.claims.filter(c => String(c.job_id) === String(jobId) && !CACHE.pool.some(t => t.claim_id === c.id)).forEach(c => CACHE.pool.push({ id: uid(), type: "出金", amount: claimTotal(c), claim_id: c.id, job_id: jobId, handled_by: "boss", memo: c.member_name + " 一括補填", created_at: new Date().toISOString() }));
    persistLocal();
  }
  const aj = CACHE.jobs.find(x => String(x.id) === String(jobId));
  if (need > 0) notifyDiscord(`【一括補填】${aj ? crimeName(aj.crime_type_id) : ""} / ${targets.length}件 / 合計${yen(need)}`);
  render();
};
window.addPool = async (e) => {
  e.preventDefault();
  if (!isBoss()) return alert("ボス-loginが必要");
  const fd = new FormData(e.target);
  const row = { type: fd.get("type"), amount: Number(fd.get("amount")) || 0, memo: fd.get("memo") || "" };
  if (!row.amount) return alert("金額を入力");
  if (MODE === "remote") {
    const r = await sb().from("pool_transactions").insert(row).select("id,type,amount,memo,claim_id,job_id,created_at").single();
    if (r.error) return alert("登録失敗: " + r.error.message);
    CACHE.pool.push(r.data);
  } else {
    CACHE.pool.push({ id: uid(), ...row, created_at: new Date().toISOString() });
    persistLocal();
  }
  render();
};
window.addMember = async (e) => {
  e.preventDefault();
  if (!isBoss()) return alert("ボス-loginが必要");
  const fd = new FormData(e.target);
  const name = (fd.get("name") || "").trim();
  if (!name) return;
  const role = fd.get("role");
  if (MODE === "remote") {
    const r = await sb().from("members").upsert({ name, role }, { onConflict: "name" }).select("id,name,role,is_active");
    if (r.error) return alert("追加失敗: " + r.error.message);
    await pullRemote();
  } else {
    CACHE.members.push({ id: uid(), name, role, is_active: true });
    persistLocal();
  }
  render();
};
window.updateJob = async (jobId, e) => {
  e.preventDefault();
  if (!isBoss()) return alert("ボス-loginが必要");
  const fd = new FormData(e.target);
  const row = { crime_type_id: Number(fd.get("crime_type_id")), location: fd.get("location") || "", memo: fd.get("memo") || "" };
  if (fd.get("occurred_at")) row.occurred_at = new Date(fd.get("occurred_at")).toISOString();
  const j = CACHE.jobs.find(x => String(x.id) === String(jobId));
  if (!j) return;
  if (MODE === "remote") {
    const r = await sb().from("crime_jobs").update(row).eq("id", jobId);
    if (r.error) return alert("更新失敗: " + r.error.message);
    Object.assign(j, row);
  } else { Object.assign(j, row); persistLocal(); }
  render();
};
window.deleteJob = async (jobId) => {
  if (!isBoss()) return alert("ボス-loginが必要");
  if (!confirm("この枠を削除しますか？申告も一緒に消えます（台帳の出金記録は残ります）。")) return;
  if (MODE === "remote") {
    await sb().from("pool_transactions").update({ job_id: null, claim_id: null }).eq("job_id", jobId);
    const r = await sb().from("crime_jobs").delete().eq("id", jobId);
    if (r.error) return alert("削除失敗: " + r.error.message);
    await pullRemote();
  } else {
    CACHE.pool.forEach(t => { if (String(t.job_id) === String(jobId)) { t.job_id = null; t.claim_id = null; } });
    CACHE.jobs = CACHE.jobs.filter(x => String(x.id) !== String(jobId));
    CACHE.claims = CACHE.claims.filter(c => String(c.job_id) !== String(jobId));
    persistLocal();
  }
  location.hash = "#/jobs";
  render();
};
window.leaveJob = async (jobId) => {
  const who = (prompt("離脱する名前を入力") || "").trim();
  if (!who) return;
  const j = CACHE.jobs.find(x => String(x.id) === String(jobId));
  if (!j || !j.participants.includes(who)) return alert("参加者にいません");
  if (!confirm(`${who} を離脱させますか？（申告は残ります）`)) return;
  if (MODE === "remote") {
    const m = CACHE.members.find(x => x.name === who);
    if (m) {
      const r = await sb().from("job_participants").delete().eq("job_id", jobId).eq("member_id", m.id);
      if (r.error) return alert("離脱失敗: " + r.error.message);
    }
  }
  j.participants = j.participants.filter(p => p !== who);
  if (MODE === "local") persistLocal();
  render();
};
window.toggleMember = async (mid) => {
  if (!isBoss()) return alert("ボス-loginが必要");
  const m = CACHE.members.find(x => String(x.id) === String(mid));
  if (!m) return;
  const next = !(m.is_active !== false);
  if (MODE === "remote") {
    const r = await sb().from("members").update({ is_active: next }).eq("id", mid);
    if (r.error) return alert("更新失敗: " + r.error.message);
    await pullRemote();
  } else { m.is_active = next; persistLocal(); }
  render();
};
window.setMemberRole = async (mid, role) => {
  if (!isBoss()) return alert("ボス-loginが必要");
  if (MODE === "remote") {
    const r = await sb().from("members").update({ role }).eq("id", mid);
    if (r.error) return alert("更新失敗: " + r.error.message);
    await pullRemote();
  } else {
    const m = CACHE.members.find(x => String(x.id) === String(mid));
    if (m) m.role = role;
    persistLocal();
  }
  render();
};
window.exportCSV = (kind) => {
  const rows = kind === "claims"
    ? [["日時", "犯罪", "名前", "罰金", "個人医利用", "個人医代", "その他", "合計", "状態", "備考"],
       ...CACHE.claims.map(c => {
         const j = CACHE.jobs.find(x => String(x.id) === String(c.job_id));
         return [(j ? (j.occurred_at || "") : "").slice(0, 16), j ? crimeName(j.crime_type_id) : "", c.member_name, c.fine_amount, c.medic_used ? "あり" : "なし", c.medic_cost, c.other_cost, claimTotal(c), c.status, (c.note || "").replace(/\n/g, " ")];
       })]
    : [["種別", "金額", "メモ", "日時"],
       ...CACHE.pool.map(t => [t.type, t.amount, (t.memo || "").replace(/\n/g, " "), (t.created_at || "").slice(0, 16)])];
  const csv = "﻿" + rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = kind === "claims" ? "claims.csv" : "pool.csv"; a.click();
};
window.saveWebhook = (e) => {
  e.preventDefault();
  if (!isBoss()) return alert("ボス-loginが必要");
  const v = (new FormData(e.target).get("url") || "").trim();
  if (v) localStorage.setItem("gang_webhook", v); else localStorage.removeItem("gang_webhook");
  alert("保存しました（この端末のみ有効）");
  render();
};
window.reopenJob = async (jobId) => {
  if (!isBoss()) return alert("ボス-loginが必要");
  if (!confirm("この枠を精算中に戻しますか？")) return;
  if (MODE === "remote") {
    const r = await sb().from("crime_jobs").update({ status: "精算中" }).eq("id", jobId);
    if (r.error) return alert("更新失敗: " + r.error.message);
    await pullRemote();
  } else {
    const j = CACHE.jobs.find(x => String(x.id) === String(jobId));
    if (j) j.status = "精算中";
    persistLocal();
  }
  render();
};
window.remindUnclaimed = (jobId) => {
  if (!isBoss()) return alert("ボス-loginが必要");
  const j = CACHE.jobs.find(x => String(x.id) === String(jobId));
  if (!j) return;
  const missing = j.participants.filter(p => !CACHE.claims.some(c => String(c.job_id) === String(jobId) && c.member_name === p));
  if (!missing.length) return alert("未申告者はいません");
  notifyDiscord(`【未申告リマインド】${crimeName(j.crime_type_id)} / 未申告: ${missing.join("、")} / 申告してください`);
  alert("Discordに投稿しました");
};
let jobSearch = "", statusFilter = "";
window.setJobSearch = (e) => { e.preventDefault(); jobSearch = (new FormData(e.target).get("q") || "").trim(); render(); };
window.clearJobSearch = () => { jobSearch = ""; statusFilter = ""; crimeFilter = 0; render(); };
window.setStatusFilter = (v) => { statusFilter = v; render(); };
window.setCrimeFilter = (id) => { crimeFilter = crimeFilter === id ? 0 : id; render(); };
window.exportJSON = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(CACHE, null, 2)], { type: "application/json" }));
  a.download = "gang-pool.json"; a.click();
};

// ---------- views ----------
function memberAgg() {
  const map = {};
  CACHE.claims.forEach(c => {
    const m = map[c.member_name] = map[c.member_name] || { name: c.member_name, paid: 0, unpaid: 0, count: 0 };
    m.count++;
    if (c.status === "補填済み") m.paid += claimTotal(c); else m.unpaid += claimTotal(c);
  });
  return Object.values(map).sort((a, b) => (b.paid + b.unpaid) - (a.paid + a.unpaid));
}
function monthAgg() {
  const map = {};
  CACHE.pool.filter(t => t.type === "出金").forEach(t => {
    const k = (t.created_at || "").slice(0, 7);
    if (k) map[k] = (map[k] || 0) + t.amount;
  });
  return Object.keys(map).sort().reverse().slice(0, 6).map(k => ({ month: k, total: map[k] }));
}
function viewDashboard() {
  if (!isBoss()) return `<section class="tech-section"><span class="sec-num">01</span><h2>Dashboard</h2>
    <div class="lock-note">ダッシュボードを開くにはログインが必要です。右上からログインしてください。参加登録、補填は「Operations」から可能です。</div></section>`;
  const unpaid = CACHE.claims.filter(c => c.status !== "補填済み");
  const unpaidSum = unpaid.reduce((s, c) => s + claimTotal(c), 0);
  const monthSum = CACHE.pool.filter(t => t.type === "出金" && new Date(t.created_at).getMonth() === new Date().getMonth()).reduce((s, t) => s + t.amount, 0);
  const open = CACHE.jobs.filter(j => j.status !== "完了");
  const warn = unpaidSum > poolBalance()
    ? `<div class="data-panel" style="border-color:var(--tech-accent);margin-bottom:24px;"><span class="panel-label" style="background:var(--tech-accent);">Warning</span>未補填${yen(unpaidSum)}がプール残高${yen(poolBalance())}を上回っています。上納を促してください。</div>` : "";
  const members = memberAgg();
  const months = monthAgg();
  const remindRows = CACHE.jobs.filter(j => j.status !== "完了").map(j => ({ j, missing: j.participants.filter(p => !CACHE.claims.some(c => String(c.job_id) === String(j.id) && c.member_name === p)) })).filter(x => x.missing.length);
  return `<section class="tech-section"><span class="sec-num">01</span><h2>Dashboard</h2>${warn}
  <div class="grid grid-3">
    <div class="data-panel"><span class="panel-label">Pool Balance</span><div class="big-num">${yen(poolBalance())}</div><div class="sub">プール残高</div></div>
    <div class="data-panel"><span class="panel-label">Unpaid</span><div class="big-num">${unpaid.length}件 / ${yen(unpaidSum)}</div><div class="sub">未補填の申告</div></div>
    <div class="data-panel"><span class="panel-label">Monthly Out</span><div class="big-num">${yen(monthSum)}</div><div class="sub">今月の出金</div></div></div></section>
  <section class="tech-section"><span class="sec-num">02</span><h2>Open Operations</h2>
  <div class="grid grid-3">${open.map((j, i) => jobCard(j, i)).join("") || '<p class="sub">なし</p>'}</div></section>
  <section class="tech-section"><span class="sec-num">03</span><h2>By Member</h2>
  <table class="tech-table"><tr><th>名前</th><th>申告件数</th><th>補填済み</th><th>未補填</th></tr>
  ${members.map(m => `<tr><td><b>${esc(m.name)}</b></td><td>${m.count}</td><td>${yen(m.paid)}</td><td>${yen(m.unpaid)}</td></tr>`).join("") || '<tr><td colspan="4">なし</td></tr>'}</table></section>
  <section class="tech-section"><span class="sec-num">04</span><h2>Monthly Out</h2>
  <table class="tech-table"><tr><th>月</th><th>出金合計</th></tr>
  ${months.map(m => `<tr><td>${esc(m.month)}</td><td><b>${yen(m.total)}</b></td></tr>`).join("") || '<tr><td colspan="2">なし</td></tr>'}</table>
  <div style="margin-top:12px;display:flex;gap:8px;"><button onclick="exportCSV('claims')" class="btn-ghost">申告CSV</button><button onclick="exportCSV('pool')" class="btn-ghost">台帳CSV</button></div></section>
  <section class="tech-section"><span class="sec-num">05</span><h2>Unclaimed</h2>
  ${remindRows.map(({ j, missing }) => `<div class="data-panel" style="margin-bottom:12px;"><span class="panel-label">${esc(crimeName(j.crime_type_id))}</span><div style="margin-top:8px;">${missing.map(esc).join("、")} <span class="sub">が未申告</span></div><div style="margin-top:8px;"><button onclick="remindUnclaimed('${j.id}')" class="btn-ghost">Discordに投稿</button></div></div>`).join("") || '<p class="sub">未申告者なし</p>'}</section>
  <section class="tech-section"><span class="sec-num">06</span><h2>Notify</h2>
  <div class="data-panel"><span class="panel-label">Discord Webhook</span>
    <div class="sub" style="margin-bottom:12px;">現在: ${esc(((localStorage.getItem("gang_webhook") || window.AppConfig.DISCORD_WEBHOOK_URL || "未設定")).slice(0, 60))}...</div>
    <form onsubmit="saveWebhook(event)" class="tech-form"><div class="field"><label>URL（空で既定に戻す、この端末のみ）</label><input name="url" placeholder="https://discord.com/api/webhooks/..." /></div>
    <div style="margin-top:12px;"><button class="btn-primary">保存</button></div></form></div></section>`;
}
function jobCard(j, i) {
  const claims = CACHE.claims.filter(c => String(c.job_id) === String(j.id));
  const unpaid = claims.filter(c => c.status !== "補填済み").length;
  const t = CRIME_TYPES.find(x => x.id === Number(j.crime_type_id));
  return `<a href="#/jobs/${j.id}" class="tech-card">
    <div class="card-top"><span class="diag-num">${String(i + 1).padStart(2, "0")}</span>${statusBadge(j.status)}</div>
    <div class="card-title">${esc(crimeName(j.crime_type_id))}</div>
    <div class="card-meta">${esc((j.occurred_at || "").slice(0, 16))} / 参加${j.participants.length}人 / 未補填${unpaid}件</div>
    <div style="margin-top:8px;"><span class="chip">${esc(t ? t.category : "")}</span><span class="chip">定員${t ? t.capacity : "-"}人</span></div>
  </a>`;
}
function targetMatrix() {
  return `<div class="skill-matrix">${CRIME_TYPES.map(t =>
    `<div class="skill-cell ${crimeFilter === t.id ? "sel" : ""}" onclick="setCrimeFilter(${t.id})">
      <div class="cell-name">${esc(t.name)}</div><div class="cell-sub">${esc(t.category)} / ${t.capacity}人</div>
    </div>`).join("")}</div>
  <p class="sub" style="font-size:12px;color:var(--tech-gray);">TARGETS — 選択で絞り込み（再クリックで解除）</p>`;
}
function viewJobs() {
  const q = jobSearch;
  const jobs = CACHE.jobs.filter(j => (!crimeFilter || Number(j.crime_type_id) === crimeFilter) && (!statusFilter || j.status === statusFilter) && (!q || (crimeName(j.crime_type_id) + " " + (j.location || "") + " " + (j.memo || "")).includes(q)));
  return `<section class="tech-section"><span class="sec-num">01</span><h2>Targets</h2>${targetMatrix()}</section>
  <section class="tech-section"><span class="sec-num">02</span><h2>Operations</h2>
  <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
    <form onsubmit="setJobSearch(event)" style="display:flex;gap:8px;"><input name="q" placeholder="検索（犯罪・場所・メモ）" value="${esc(jobSearch)}" style="background:#fff;border:1px solid var(--tech-blue);padding:8px;color:var(--tech-dark);" /><button class="btn-ghost">検索</button></form>
    <select onchange="setStatusFilter(this.value)" style="background:#fff;border:1px solid var(--tech-blue);padding:8px;color:var(--tech-dark);">
      <option value="">全部</option>${["受付中", "精算中", "完了"].map(s => `<option ${statusFilter === s ? "selected" : ""}>${s}</option>`).join("")}
    </select>
    ${(jobSearch || statusFilter || crimeFilter) ? `<button onclick="clearJobSearch()" class="btn-ghost">解除</button>` : ""}
    <button onclick="exportJSON()" class="btn-ghost">JSON出力</button>
  </div>
  <div class="grid grid-3">${jobs.map((j, i) => jobCard(j, i)).join("") || '<p class="sub">まだ枠がありません</p>'}</div></section>
  <section class="tech-section"><span class="sec-num">03</span><h2>New Operation</h2>
  <div class="data-panel"><span class="panel-label">Create Frame</span>
  <form onsubmit="createJob(event)" class="tech-form">
    <div class="form-row c2">
      <div class="field"><label>Target</label><select name="crime_type_id">${CRIME_TYPES.map(t => `<option value="${t.id}" ${crimeFilter === t.id ? "selected" : ""}>${t.category} ${t.name} (${t.capacity}人)</option>`).join("")}</select></div>
      <div class="field"><label>Date</label><input name="occurred_at" type="datetime-local" /></div>
    </div>
    <div class="form-row c2" style="margin-top:12px;">
      <div class="field"><label>Location</label><input name="location" placeholder="場所（任意）" /></div>
      <div class="field"><label>Memo</label><input name="memo" placeholder="例: 22時集合" /></div>
    </div>
    <div style="margin-top:12px;"><button class="btn-primary">枠を立てる</button></div>
  </form></div></section>`;
}
function hexProgress(j, claims) {
  const hasP = j.participants.length > 0;
  const hasC = claims.length > 0;
  const allPaid = hasC && claims.every(c => c.status === "補填済み");
  const steps = [
    { n: "01", l: "枠作成", done: true },
    { n: "02", l: "参加", done: hasP },
    { n: "03", l: "申告", done: hasC },
    { n: "04", l: "補填", done: allPaid },
  ];
  return `<div class="hex-progress"><div class="hex-row">${steps.map(s =>
    `<div class="hex-step ${s.done ? "done" : ""}"><div class="hex">${s.n}</div><div class="hex-label">${s.l}</div></div>`).join("")}</div></div>`;
}
function viewJobDetail(id) {
  const j = CACHE.jobs.find(x => String(x.id) === String(id));
  if (!j) return `<p>枠が見つかりません</p><a href="#/jobs">戻る</a>`;
  const claims = CACHE.claims.filter(c => String(c.job_id) === String(id));
  return `<a href="#/jobs" style="font-size:12px;">← OPERATIONSへ戻る</a>
  <section class="tech-section" style="margin-top:16px;"><span class="sec-num">01</span><h2>${esc(crimeName(j.crime_type_id))}</h2>
  <div class="data-panel"><span class="panel-label">Operation Detail</span>
    <div>${statusBadge(j.status)} <span class="card-meta">${esc(j.occurred_at || "")} / ${esc(j.location || "")} / ${esc(j.memo || "")}</span></div>
    ${hexProgress(j, claims)}
    <div style="margin-top:8px;">${j.participants.map(p => `<span class="chip">${esc(p)}</span>`).join("") || '<span class="sub">参加者なし</span>'}
    ${j.participants.length ? `<button onclick="leaveJob('${j.id}')" class="btn-ghost" style="padding:4px 12px;font-size:12px;margin-left:8px;">離脱する</button>` : ""}</div>
    ${isBoss() ? `<div style="margin-top:12px;"><button onclick="markAllPaid('${j.id}')" class="btn-accent">全員を一括補填済みにする</button></div>` : ""}
    ${isBoss() && j.status === "完了" ? `<div style="margin-top:12px;"><button onclick="reopenJob('${j.id}')" class="btn-ghost">精算中に戻す</button></div>` : ""}
  </div>
  ${isBoss() ? `<div class="data-panel" style="margin-top:24px;"><span class="panel-label">Edit Frame</span>
  <form onsubmit="updateJob('${j.id}',event)" class="tech-form">
    <div class="form-row c2">
      <div class="field"><label>Target</label><select name="crime_type_id">${CRIME_TYPES.map(t => `<option value="${t.id}" ${Number(j.crime_type_id) === t.id ? "selected" : ""}>${t.category} ${t.name} (${t.capacity}人)</option>`).join("")}</select></div>
      <div class="field"><label>Date</label><input name="occurred_at" type="datetime-local" value="${esc((j.occurred_at || "").slice(0, 16))}" /></div>
    </div>
    <div class="form-row c2" style="margin-top:12px;">
      <div class="field"><label>Location</label><input name="location" value="${esc(j.location || "")}" /></div>
      <div class="field"><label>Memo</label><input name="memo" value="${esc(j.memo || "")}" /></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;"><button class="btn-primary" style="width:auto;flex:1;">更新</button><button type="button" onclick="deleteJob('${j.id}')" class="btn-accent">枠を削除</button></div>
  </form></div>` : ""}</section>
  <section class="tech-section"><span class="sec-num">02</span><h2>Join / Claim</h2>
  <div class="form-row c2">
    <div class="data-panel"><span class="panel-label">Join</span>
      <form onsubmit="joinJob('${j.id}',event)" class="tech-form"><div class="field"><label>名前</label>${memberSelectHTML("name", "参加する名前")}</div>
      <div style="margin-top:12px;"><button class="btn-primary">参加</button></div></form></div>
    <div class="data-panel"><span class="panel-label">Claim</span>
      <form onsubmit="submitClaim('${j.id}',event)" class="tech-form">
        <div class="field"><label>自分の名前</label>${memberSelectHTML("name", "自分の名前")}</div>
        <div class="form-row c3" style="margin-top:12px;">
          <div class="field"><label>罰金</label><input name="fine_amount" type="number" min="0" value="0" /></div>
          <div class="field"><label>個人医代</label><input name="medic_cost" type="number" min="0" value="0" /></div>
          <div class="field"><label>その他</label><input name="other_cost" type="number" min="0" value="0" /></div>
        </div>
        <label style="font-size:13px;display:flex;gap:8px;align-items:center;margin-top:8px;"><input name="medic_used" type="checkbox" style="width:auto;" /> 個人医を利用した</label>
        <div class="field" style="margin-top:8px;"><label>備考</label><input name="note" placeholder="備考" /></div>
        <div style="margin-top:12px;"><button class="btn-primary">申告する</button></div>
      </form></div>
  </div></section>
  <section class="tech-section"><span class="sec-num">03</span><h2>Claims (${claims.length})</h2>
  <table class="tech-table"><tr><th>NO</th><th>名前</th><th>内訳</th><th>合計</th><th>状態</th><th></th></tr>
  ${claims.map((c, i) => `<tr><td class="num">${String(i + 1).padStart(2, "0")}</td><td><b>${esc(c.member_name)}</b></td>
    <td style="font-size:12px;">罰金${yen(c.fine_amount)} / 個人医${c.medic_used ? yen(c.medic_cost) : "なし"} / 他${yen(c.other_cost)}</td>
    <td><b>${yen(claimTotal(c))}</b></td><td>${statusBadge(c.status)}</td>
    <td>${c.status !== "補填済み" && isBoss() ? `<button onclick="markPaid('${c.id}')" class="btn-accent" style="padding:6px 12px;font-size:12px;">補填済み</button>` : ""}</td></tr>`).join("") || '<tr><td colspan="6">申告なし</td></tr>'}</table></section>`;
}
function viewPool() {
  if (!isBoss()) return `<section class="tech-section"><span class="sec-num">01</span><h2>Pool</h2>
  <div class="lock-note">プールを開くにはログインが必要です。右上からログインしてください。</div></section>`;
  const txs = CACHE.pool.slice().reverse();
  return `<section class="tech-section"><span class="sec-num">01</span><h2>Pool</h2>
  <div class="data-panel"><span class="panel-label">Balance</span><div class="big-num">${isBoss() ? yen(poolBalance()) : "***"}</div><div class="sub">プール残高</div></div>
  ${isBoss() ? `<div class="data-panel" style="margin-top:24px;"><span class="panel-label">In / Out</span>
    <form onsubmit="addPool(event)" class="tech-form"><div class="form-row c2">
      <div class="field"><label>種別</label><select name="type"><option>入金</option><option>出金</option></select></div>
      <div class="field"><label>金額</label><input name="amount" type="number" min="1" placeholder="金額" /></div></div>
      <div class="field" style="margin-top:12px;"><label>メモ</label><input name="memo" placeholder="上納金 / 分配金など" /></div>
      <div style="margin-top:12px;"><button class="btn-primary">登録</button></div></form></div>`
  : `<p class="lock-note">入出金登録にはloginが必要です。</p>`}
  </section>
  <section class="tech-section"><span class="sec-num">02</span><h2>Ledger</h2>
  <table class="tech-table"><tr><th>種別</th><th>金額</th><th>メモ</th><th>日時</th></tr>
  ${txs.map(t => `<tr><td>${statusBadge(t.type === "入金" ? "申請中" : "補填済み")} ${esc(t.type)}</td><td><b>${yen(t.amount)}</b></td><td>${esc(t.memo || "")}</td><td style="font-size:12px;">${esc((t.created_at || "").slice(0, 16))}</td></tr>`).join("") || '<tr><td colspan="4">履歴なし</td></tr>'}</table></section>`;
}
function viewMembers() {
  return `<section class="tech-section"><span class="sec-num">01</span><h2>Members</h2>
  ${isBoss() ? `<div class="data-panel"><span class="panel-label">Add Member</span>
    <form onsubmit="addMember(event)" class="tech-form"><div class="form-row c2">
      <div class="field"><label>名前</label><input name="name" placeholder="名前" /></div>
      <div class="field"><label>役職</label><select name="role"><option value="member">構成員</option><option value="underboss">アンダーボス</option><option value="boss">ボス</option></select></div></div>
      <div style="margin-top:12px;"><button class="btn-primary">追加</button></div></form></div>`
  : `<p class="lock-note">メンバー編集にはloginが必要です</p>`}
  <table class="tech-table" style="margin-top:24px;"><tr><th>NO</th><th>名前</th><th>役職</th><th>状態</th><th></th></tr>
  ${CACHE.members.map((m, i) => `<tr><td class="num">${String(i + 1).padStart(2, "0")}</td><td><b>${esc(m.name)}</b></td>
    <td>${isBoss() ? `<select onchange="setMemberRole('${m.id}',this.value)" style="background:var(--tech-dark);color:#fff;border:1px solid var(--tech-cyan);padding:4px;">${["member", "underboss", "boss"].map(r => `<option value="${r}" ${m.role === r ? "selected" : ""}>${r}</option>`).join("")}</select>` : esc(m.role)}</td>
    <td>${m.is_active !== false ? "有効" : "無効"}</td>
    <td>${isBoss() ? `<button onclick="toggleMember('${m.id}')" class="btn-ghost" style="padding:4px 12px;font-size:12px;">${m.is_active !== false ? "無効化" : "有効化"}</button>` : ""}</td></tr>`).join("") || '<tr><td colspan="5">メンバー未登録</td></tr>'}</table></section>`;
}

function render() {
  const h = location.hash || "#/jobs";
  const app = document.getElementById("app");
  let route = "jobs";
  if (h.startsWith("#/dashboard")) { route = "dashboard"; app.innerHTML = `<div class="fade-in">${viewDashboard()}</div>`; }
  else if (h.startsWith("#/jobs/")) { route = "jobs"; app.innerHTML = `<div class="fade-in">${viewJobDetail(h.split("/")[2])}</div>`; }
  else if (h.startsWith("#/pool")) { route = "pool"; app.innerHTML = `<div class="fade-in">${viewPool()}</div>`; }
  else if (h.startsWith("#/members")) { route = "members"; app.innerHTML = `<div class="fade-in">${viewMembers()}</div>`; }
  else { route = "jobs"; app.innerHTML = `<div class="fade-in">${viewJobs()}</div>`; }
  setChrome(route);
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", render);
document.getElementById("loginBtn").onclick = () => {
  if (isBoss()) { sessionStorage.removeItem(LS.boss); render(); return; }
  document.getElementById("logoutBtn").style.display = "none";
  document.getElementById("loginModal").classList.remove("hidden");
};
document.getElementById("loginClose").onclick = () => document.getElementById("loginModal").classList.add("hidden");
window.doLogin = (e) => {
  if (e) e.preventDefault();
  const v = document.getElementById("loginPass").value;
  if (v === window.AppConfig.BOSS_PASSCODE) { sessionStorage.setItem(LS.boss, "1"); document.getElementById("loginModal").classList.add("hidden"); document.getElementById("loginPass").value = ""; render(); }
  else alert("合言葉が違います");
};
document.getElementById("logoutBtn").onclick = () => { sessionStorage.removeItem(LS.boss); document.getElementById("loginModal").classList.add("hidden"); render(); };
if (!location.hash) location.hash = "#/jobs";
boot().then(render);
