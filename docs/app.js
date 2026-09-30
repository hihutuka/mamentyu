// ギャング補填管理 MVP (localStorage優先、Supabase接続時は将来拡張)
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
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isBoss = () => sessionStorage.getItem(LS.boss) === "1";
const yen = (n) => (Number(n) || 0).toLocaleString("ja-JP") + "円";
const claimTotal = (c) => (Number(c.fine_amount) || 0) + (c.medic_used ? (Number(c.medic_cost) || 0) : 0) + (Number(c.other_cost) || 0);

function poolBalance() {
  const txs = load(LS.pool, []);
  return txs.reduce((s, t) => s + (t.type === "入金" ? t.amount : -t.amount), 0);
}
function seedMembers() {
  let m = load(LS.members, null);
  if (!m) { m = []; save(LS.members, m); }
  return m;
}
function ensureMember(name) {
  name = (name || "").trim();
  if (!name) return null;
  const members = load(LS.members, []);
  let m = members.find(x => x.name === name);
  if (!m) { m = { id: uid(), name, role: "member", is_active: true }; members.push(m); save(LS.members, members); }
  return m;
}

function setModeBadge() {
  const el = document.getElementById("modeBadge");
  el.textContent = window.isSupabaseMode() ? "Supabase接続" : "ローカル試運転";
  document.getElementById("poolBadge").textContent = "プール残高 " + yen(poolBalance());
  document.getElementById("loginBtn").textContent = isBoss() ? "ボス:IN" : "ボス-login";
}

// ---------- actions (global) ----------
window.createJob = (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const jobs = load(LS.jobs, []);
  jobs.unshift({ id: uid(), crime_type_id: Number(fd.get("crime_type_id")), occurred_at: fd.get("occurred_at") || new Date().toISOString(), location: fd.get("location") || "", memo: fd.get("memo") || "", status: "受付中", participants: [], created_at: new Date().toISOString() });
  save(LS.jobs, jobs);
  location.hash = "#/jobs";
  render();
};
window.joinJob = (jobId, e) => {
  e.preventDefault();
  const name = new FormData(e.target).get("name").trim();
  if (!name) return alert("名前を入力");
  ensureMember(name);
  const jobs = load(LS.jobs, []);
  const j = jobs.find(x => x.id === jobId);
  if (j && !j.participants.includes(name)) { j.participants.push(name); if (j.status === "受付中") j.status = "精算中"; save(LS.jobs, jobs); }
  render();
};
window.submitClaim = (jobId, e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const name = fd.get("name").trim();
  if (!name) return alert("名前を入力");
  ensureMember(name);
  const claims = load(LS.claims, []);
  const medic_used = fd.get("medic_used") === "on";
  const data = { id: uid(), job_id: jobId, member_name: name, fine_amount: Number(fd.get("fine_amount")) || 0, medic_used, medic_cost: medic_used ? (Number(fd.get("medic_cost")) || 0) : 0, other_cost: Number(fd.get("other_cost")) || 0, status: "申請中", note: fd.get("note") || "", updated_at: new Date().toISOString() };
  const i = claims.findIndex(c => c.job_id === jobId && c.member_name === name);
  if (i >= 0) { data.id = claims[i].id; if (claims[i].status === "補填済み" && !isBoss()) return alert("補填済みのため編集不可（ボスに連絡）"); claims[i] = data; }
  else claims.push(data);
  save(LS.claims, claims);
  // 参加にも追加
  const jobs = load(LS.jobs, []);
  const j = jobs.find(x => x.id === jobId);
  if (j && !j.participants.includes(name)) { j.participants.push(name); save(LS.jobs, jobs); }
  render();
};
window.markPaid = (claimId) => {
  if (!isBoss()) return alert("ボス-loginが必要");
  const claims = load(LS.claims, []);
  const c = claims.find(x => x.id === claimId);
  if (!c) return;
  c.status = "補填済み"; c.updated_at = new Date().toISOString();
  save(LS.claims, claims);
  const txs = load(LS.pool, []);
  if (!txs.some(t => t.claim_id === claimId)) {
    const members = load(LS.members, []);
    const boss = members.find(m => m.role === "boss" || m.role === "underboss");
    txs.push({ id: uid(), type: "出金", amount: claimTotal(c), claim_id: claimId, job_id: c.job_id, handled_by: boss ? boss.name : "boss", memo: c.member_name + " 補填", created_at: new Date().toISOString() });
    save(LS.pool, txs);
  }
  // 全員対応済みなら枠完了
  const jobs = load(LS.jobs, []);
  const j = jobs.find(x => x.id === c.job_id);
  if (j) {
    const js = claims.filter(x => x.job_id === j.id);
    if (js.length && js.every(x => x.status === "補填済み")) j.status = "完了";
    else if (j.status === "受付中") j.status = "精算中";
    save(LS.jobs, jobs);
  }
  render();
};
window.markAllPaid = (jobId) => {
  if (!isBoss()) return alert("ボス-loginが必要");
  const claims = load(LS.claims, []).map(c => c.job_id === jobId ? { ...c, status: "補填済み", updated_at: new Date().toISOString() } : c);
  save(LS.claims, claims);
  const jobs = load(LS.jobs, []);
  const j = jobs.find(x => x.id === jobId);
  if (j) { j.status = "完了"; save(LS.jobs, jobs); }
  // 台帳一括
  const txs = load(LS.pool, []);
  claims.filter(c => c.job_id === jobId && !txs.some(t => t.claim_id === c.id)).forEach(c => txs.push({ id: uid(), type: "出金", amount: claimTotal(c), claim_id: c.id, job_id: jobId, handled_by: "boss", memo: c.member_name + " 一括補填", created_at: new Date().toISOString() }));
  save(LS.pool, txs);
  render();
};
window.addPool = (e) => {
  e.preventDefault();
  if (!isBoss()) return alert("ボス-loginが必要");
  const fd = new FormData(e.target);
  const txs = load(LS.pool, []);
  txs.push({ id: uid(), type: fd.get("type"), amount: Number(fd.get("amount")) || 0, memo: fd.get("memo") || "", created_at: new Date().toISOString() });
  save(LS.pool, txs);
  render();
};
window.addMember = (e) => {
  e.preventDefault();
  if (!isBoss()) return alert("ボス-loginが必要");
  const fd = new FormData(e.target);
  const members = load(LS.members, []);
  members.push({ id: uid(), name: fd.get("name").trim(), role: fd.get("role"), is_active: true });
  save(LS.members, members);
  render();
};
window.exportJSON = () => {
  const data = { jobs: load(LS.jobs, []), claims: load(LS.claims, []), members: load(LS.members, []), pool: load(LS.pool, []) };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = "gang-pool.json"; a.click();
};

// ---------- views ----------
function viewDashboard() {
  if (!isBoss()) return `<div class="bg-amber-950 border border-amber-800 rounded p-4 text-sm">ダッシュボードはボス/アンダーボスのみ。右上からログインしてください。一般参加は「犯罪枠」から登録できます。</div>`;
  const jobs = load(LS.jobs, []), claims = load(LS.claims, []), txs = load(LS.pool, []);
  const unpaid = claims.filter(c => c.status !== "補填済み");
  const unpaidSum = unpaid.reduce((s, c) => s + claimTotal(c), 0);
  const monthSum = txs.filter(t => t.type === "出金" && new Date(t.created_at).getMonth() === new Date().getMonth()).reduce((s, t) => s + t.amount, 0);
  return `<div class="grid grid-cols-3 gap-2 text-center">
    <div class="bg-slate-900 border border-slate-800 rounded p-3"><div class="text-xs text-slate-400">プール残高</div><div class="font-bold text-emerald-300">${yen(poolBalance())}</div></div>
    <div class="bg-slate-900 border border-slate-800 rounded p-3"><div class="text-xs text-slate-400">未補填</div><div class="font-bold text-amber-300">${unpaid.length}件 ${yen(unpaidSum)}</div></div>
    <div class="bg-slate-900 border border-slate-800 rounded p-3"><div class="text-xs text-slate-400">今月出金</div><div class="font-bold">${yen(monthSum)}</div></div></div>
    <h3 class="font-bold mt-4 mb-2">受付中/精算中の枠 (${jobs.filter(j => j.status !== "完了").length})</h3>
    <div class="space-y-2">${jobs.filter(j => j.status !== "完了").map(jobCard).join("") || '<p class="text-sm text-slate-400">なし</p>'}</div>`;
}
function crimeName(id) { const t = CRIME_TYPES.find(x => x.id === Number(id)); return t ? `${t.category} ${t.name}` : "-"; }
function jobCard(j) {
  const claims = load(LS.claims, []).filter(c => c.job_id === j.id);
  const unpaid = claims.filter(c => c.status !== "補填済み").length;
  return `<a href="#/jobs/${j.id}" class="block bg-slate-900 border border-slate-800 rounded p-3">
    <div class="flex justify-between text-sm"><span class="font-bold">${esc(crimeName(j.crime_type_id))}</span><span class="text-xs px-2 py-0.5 rounded ${j.status === "完了" ? "bg-slate-700" : "bg-amber-900"}">${esc(j.status)}</span></div>
    <div class="text-xs text-slate-400 mt-1">${esc((j.occurred_at || "").slice(0, 16))} / 参加${j.participants.length}人 / 未補填${unpaid}件</div></a>`;
}
function viewJobs() {
  const jobs = load(LS.jobs, []);
  return `<form onsubmit="createJob(event)" class="bg-slate-900 border border-slate-800 rounded p-3 space-y-2">
    <h3 class="font-bold text-sm">犯罪枠を作成（誰でも可）</h3>
    <div class="grid grid-cols-2 gap-2">
    <select name="crime_type_id" class="bg-slate-800 rounded p-2 text-sm">${CRIME_TYPES.map(t => `<option value="${t.id}">${t.category} ${t.name} (${t.capacity}人)</option>`).join("")}</select>
    <input name="occurred_at" type="datetime-local" class="bg-slate-800 rounded p-2 text-sm" />
    </div>
    <input name="location" placeholder="場所（任意）" class="w-full bg-slate-800 rounded p-2 text-sm" />
    <input name="memo" placeholder="メモ（例: 22時集合）" class="w-full bg-slate-800 rounded p-2 text-sm" />
    <button class="w-full bg-emerald-700 rounded py-2 text-sm">枠を立てる</button></form>
    <div class="flex justify-between items-center mt-4 mb-2"><h3 class="font-bold">枠一覧</h3><button onclick="exportJSON()" class="text-xs underline text-slate-400">JSON出力</button></div>
    <div class="space-y-2">${jobs.map(jobCard).join("") || '<p class="text-sm text-slate-400">まだ枠がありません</p>'}</div>`;
}
function viewJobDetail(id) {
  const jobs = load(LS.jobs, []);
  const j = jobs.find(x => x.id === id);
  if (!j) return `<p>枠が見つかりません</p><a href="#/jobs" class="underline">戻る</a>`;
  const claims = load(LS.claims, []).filter(c => c.job_id === id);
  return `<a href="#/jobs" class="text-xs underline text-slate-400">← 一覧へ</a>
  <div class="bg-slate-900 border border-slate-800 rounded p-3 mt-2">
  <div class="font-bold">${esc(crimeName(j.crime_type_id))} <span class="text-xs font-normal px-2 py-0.5 rounded bg-slate-800">${esc(j.status)}</span></div>
  <div class="text-xs text-slate-400">${esc(j.occurred_at)} / ${esc(j.location)} / ${esc(j.memo)}</div>
  <div class="text-xs mt-1">参加: ${j.participants.map(esc).join(", ") || "なし"}</div>
  ${isBoss() ? `<button onclick="markAllPaid('${j.id}')" class="mt-2 w-full bg-amber-700 rounded py-2 text-sm">全員を一括補填済みにする</button>` : ""}
  </div>
  <form onsubmit="joinJob('${j.id}',event)" class="flex gap-2 mt-3">
    <input name="name" placeholder="参加する名前" class="flex-1 bg-slate-800 rounded p-2 text-sm" />
    <button class="bg-slate-700 rounded px-4 text-sm">参加</button></form>
  <form onsubmit="submitClaim('${j.id}',event)" class="bg-slate-900 border border-slate-800 rounded p-3 mt-3 space-y-2">
    <h4 class="font-bold text-sm">被害申告（各自・ログイン不要）</h4>
    <input name="name" placeholder="自分の名前" class="w-full bg-slate-800 rounded p-2 text-sm" />
    <div class="grid grid-cols-3 gap-2">
      <label class="text-xs">罰金<input name="fine_amount" type="number" min="0" value="0" class="w-full bg-slate-800 rounded p-2 text-sm" /></label>
      <label class="text-xs">個人医代<input name="medic_cost" type="number" min="0" value="0" class="w-full bg-slate-800 rounded p-2 text-sm" /></label>
      <label class="text-xs">その他<input name="other_cost" type="number" min="0" value="0" class="w-full bg-slate-800 rounded p-2 text-sm" /></label>
    </div>
    <label class="text-xs flex items-center gap-2"><input name="medic_used" type="checkbox" /> 個人医を利用した</label>
    <input name="note" placeholder="備考" class="w-full bg-slate-800 rounded p-2 text-sm" />
    <button class="w-full bg-emerald-700 rounded py-2 text-sm">申告する</button></form>
  <h4 class="font-bold text-sm mt-4 mb-2">申告一覧 (${claims.length})</h4>
  <div class="space-y-2">${claims.map(c => `<div class="bg-slate-900 border border-slate-800 rounded p-2 text-sm flex justify-between items-center">
    <div><span class="font-bold">${esc(c.member_name)}</span> <span class="text-xs px-1 rounded ${c.status === "補填済み" ? "bg-slate-700" : "bg-amber-900"}">${esc(c.status)}</span>
    <div class="text-xs text-slate-400">罰金${yen(c.fine_amount)} 個人医${c.medic_used ? yen(c.medic_cost) : "なし"} 他${yen(c.other_cost)} 合計${yen(claimTotal(c))}</div></div>
    ${c.status !== "補填済み" && isBoss() ? `<button onclick="markPaid('${c.id}')" class="bg-amber-700 rounded px-3 py-1 text-xs">補填済み</button>` : ""}
  </div>`).join("") || '<p class="text-xs text-slate-400">申告なし</p>'}</div>`;
}
function viewPool() {
  const txs = load(LS.pool, []).slice().reverse();
  return `<div class="bg-slate-900 border border-slate-800 rounded p-3 text-center">残高 <span class="font-bold text-emerald-300 text-lg">${yen(poolBalance())}</span></div>
  ${isBoss() ? `<form onsubmit="addPool(event)" class="bg-slate-900 border border-slate-800 rounded p-3 mt-3 space-y-2">
    <h4 class="font-bold text-sm">入出金登録（ボスのみ）</h4>
    <div class="grid grid-cols-2 gap-2">
    <select name="type" class="bg-slate-800 rounded p-2 text-sm"><option>入金</option><option>出金</option></select>
    <input name="amount" type="number" min="1" placeholder="金額" class="bg-slate-800 rounded p-2 text-sm" /></div>
    <input name="memo" placeholder="メモ（上納金/分配金など）" class="w-full bg-slate-800 rounded p-2 text-sm" />
    <button class="w-full bg-emerald-700 rounded py-2 text-sm">登録</button></form>`
  : `<p class="text-xs text-slate-400 mt-2">入出金登録はボス-loginが必要。閲覧は全員可。</p>`}
  <div class="space-y-1 mt-3">${txs.map(t => `<div class="text-sm bg-slate-900 border border-slate-800 rounded p-2 flex justify-between"><span>${t.type} ${yen(t.amount)} <span class="text-xs text-slate-400">${esc(t.memo || "")}</span></span><span class="text-xs text-slate-500">${esc((t.created_at || "").slice(0, 16))}</span></div>`).join("") || '<p class="text-xs text-slate-400">履歴なし</p>'}</div>`;
}
function viewMembers() {
  const members = load(LS.members, []);
  return `${isBoss() ? `<form onsubmit="addMember(event)" class="bg-slate-900 border border-slate-800 rounded p-3 flex gap-2">
    <input name="name" placeholder="名前" class="flex-1 bg-slate-800 rounded p-2 text-sm" />
    <select name="role" class="bg-slate-800 rounded p-2 text-sm"><option value="member">構成員</option><option value="underboss">アンダーボス</option><option value="boss">ボス</option></select>
    <button class="bg-emerald-700 rounded px-4 text-sm">追加</button></form>` : `<p class="text-xs text-slate-400">メンバー編集はボスのみ。閲覧は全員可。</p>`}
  <div class="mt-3 space-y-1">${members.map(m => `<div class="text-sm bg-slate-900 border border-slate-800 rounded p-2">${esc(m.name)} <span class="text-xs text-slate-400">${esc(m.role)}</span></div>`).join("") || '<p class="text-xs text-slate-400">メンバー未登録。参加時に自動追加されます。</p>'}</div>`;
}

function render() {
  seedMembers(); setModeBadge();
  const app = document.getElementById("app");
  const h = location.hash || "#/jobs";
  if (h.startsWith("#/dashboard")) app.innerHTML = viewDashboard();
  else if (h.startsWith("#/jobs/")) app.innerHTML = viewJobDetail(h.split("/")[2]);
  else if (h.startsWith("#/jobs")) app.innerHTML = viewJobs();
  else if (h.startsWith("#/pool")) app.innerHTML = viewPool();
  else if (h.startsWith("#/members")) app.innerHTML = viewMembers();
  else app.innerHTML = viewJobs();
}
window.addEventListener("hashchange", render);
document.getElementById("loginBtn").onclick = () => document.getElementById("loginModal").classList.remove("hidden");
document.getElementById("loginClose").onclick = () => document.getElementById("loginModal").classList.add("hidden");
document.getElementById("loginGo").onclick = () => {
  const v = document.getElementById("loginPass").value;
  if (v === window.AppConfig.BOSS_PASSCODE) { sessionStorage.setItem(LS.boss, "1"); document.getElementById("loginModal").classList.add("hidden"); render(); }
  else alert("合言葉が違います");
};
document.getElementById("logoutBtn").onclick = () => { sessionStorage.removeItem(LS.boss); document.getElementById("loginModal").classList.add("hidden"); render(); };
if (!location.hash) location.hash = "#/jobs";
render();
