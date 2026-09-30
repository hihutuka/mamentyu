// GANG REIMBURSE — Technology Editorial UI (logicはagent.md準拠、localStorage優先)
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
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isBoss = () => sessionStorage.getItem(LS.boss) === "1";
const yen = (n) => (Number(n) || 0).toLocaleString("ja-JP") + "円";
const claimTotal = (c) => (Number(c.fine_amount) || 0) + (c.medic_used ? (Number(c.medic_cost) || 0) : 0) + (Number(c.other_cost) || 0);
let crimeFilter = 0;

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
function crimeName(id) { const t = CRIME_TYPES.find(x => x.id === Number(id)); return t ? `${t.category} ${t.name}` : "-"; }
function statusBadge(s) {
  const cls = s === "完了" || s === "補填済み" ? "b-done" : s === "精算中" || s === "申請中" ? "b-progress" : "b-open";
  return `<span class="badge ${cls}">${esc(s)}</span>`;
}

function setChrome(route) {
  document.getElementById("modeBadge").textContent =
    (window.isSupabaseMode() ? "SUPABASE // CONNECTED" : "SUPABASE // LOCAL TRIAL") + " / " + (isBoss() ? "BOSS:IN" : "BOSS:OUT");
  document.getElementById("poolBadge").innerHTML = `POOL <b>${yen(poolBalance())}</b>`;
  const btn = document.getElementById("loginBtn");
  btn.textContent = isBoss() ? "BOSS:IN" : "BOSS LOGIN";
  btn.classList.toggle("on", isBoss());
  document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("active", a.dataset.nav === route));
}

// ---------- actions ----------
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
  const name = (fd.get("name") || "").trim();
  if (!name) return alert("名前を入力");
  ensureMember(name);
  const claims = load(LS.claims, []);
  const medic_used = fd.get("medic_used") === "on";
  const data = { id: uid(), job_id: jobId, member_name: name, fine_amount: Number(fd.get("fine_amount")) || 0, medic_used, medic_cost: medic_used ? (Number(fd.get("medic_cost")) || 0) : 0, other_cost: Number(fd.get("other_cost")) || 0, status: "申請中", note: fd.get("note") || "", updated_at: new Date().toISOString() };
  const i = claims.findIndex(c => c.job_id === jobId && c.member_name === name);
  if (i >= 0) { data.id = claims[i].id; if (claims[i].status === "補填済み" && !isBoss()) return alert("補填済みのため編集不可（ボスに連絡）"); claims[i] = data; }
  else claims.push(data);
  save(LS.claims, claims);
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
  const name = (fd.get("name") || "").trim();
  if (!name) return;
  const members = load(LS.members, []);
  members.push({ id: uid(), name, role: fd.get("role"), is_active: true });
  save(LS.members, members);
  render();
};
window.setCrimeFilter = (id) => { crimeFilter = crimeFilter === id ? 0 : id; render(); };
window.exportJSON = () => {
  const data = { jobs: load(LS.jobs, []), claims: load(LS.claims, []), members: load(LS.members, []), pool: load(LS.pool, []) };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = "gang-pool.json"; a.click();
};

// ---------- views ----------
function viewDashboard() {
  if (!isBoss()) return `<section class="tech-section"><span class="sec-num">01</span><h2>Dashboard</h2>
    <div class="lock-note">ダッシュボードはボス / アンダーボスのみ。右上からログインしてください。一般参加は「02 Operations」から登録できます。</div></section>`;
  const jobs = load(LS.jobs, []), claims = load(LS.claims, []), txs = load(LS.pool, []);
  const unpaid = claims.filter(c => c.status !== "補填済み");
  const unpaidSum = unpaid.reduce((s, c) => s + claimTotal(c), 0);
  const monthSum = txs.filter(t => t.type === "出金" && new Date(t.created_at).getMonth() === new Date().getMonth()).reduce((s, t) => s + t.amount, 0);
  const open = jobs.filter(j => j.status !== "完了");
  return `<section class="tech-section"><span class="sec-num">01</span><h2>Dashboard</h2>
  <div class="grid grid-3">
    <div class="data-panel"><span class="panel-label">Pool Balance</span><div class="big-num">${yen(poolBalance())}</div><div class="sub">プール残高</div></div>
    <div class="data-panel"><span class="panel-label">Unpaid</span><div class="big-num">${unpaid.length}件 / ${yen(unpaidSum)}</div><div class="sub">未補填の申告</div></div>
    <div class="data-panel"><span class="panel-label">Monthly Out</span><div class="big-num">${yen(monthSum)}</div><div class="sub">今月の出金</div></div>
  </div></section>
  <section class="tech-section"><span class="sec-num">02</span><h2>Open Operations</h2>
  <div class="grid grid-3">${open.map((j, i) => jobCard(j, i)).join("") || '<p class="sub">なし</p>'}</div></section>`;
}
function jobCard(j, i) {
  const claims = load(LS.claims, []).filter(c => c.job_id === j.id);
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
  const jobs = load(LS.jobs, []).filter(j => !crimeFilter || Number(j.crime_type_id) === crimeFilter);
  return `<section class="tech-section"><span class="sec-num">01</span><h2>Targets</h2>${targetMatrix()}</section>
  <section class="tech-section"><span class="sec-num">02</span><h2>New Operation</h2>
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
  </form></div></section>
  <section class="tech-section"><span class="sec-num">03</span><h2>Operations</h2>
  <div style="margin-bottom:12px;"><button onclick="exportJSON()" class="btn-ghost">JSON出力</button></div>
  <div class="grid grid-3">${jobs.map((j, i) => jobCard(j, i)).join("") || '<p class="sub">まだ枠がありません</p>'}</div></section>`;
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
  const jobs = load(LS.jobs, []);
  const j = jobs.find(x => x.id === id);
  if (!j) return `<p>枠が見つかりません</p><a href="#/jobs">戻る</a>`;
  const claims = load(LS.claims, []).filter(c => c.job_id === id);
  return `<a href="#/jobs" style="font-size:12px;">← OPERATIONSへ戻る</a>
  <section class="tech-section" style="margin-top:16px;"><span class="sec-num">01</span><h2>${esc(crimeName(j.crime_type_id))}</h2>
  <div class="data-panel"><span class="panel-label">Operation Detail</span>
    <div>${statusBadge(j.status)} <span class="card-meta">${esc(j.occurred_at || "")} / ${esc(j.location || "")} / ${esc(j.memo || "")}</span></div>
    ${hexProgress(j, claims)}
    <div style="margin-top:8px;">${j.participants.map(p => `<span class="chip">${esc(p)}</span>`).join("") || '<span class="sub">参加者なし</span>'}</div>
    ${isBoss() ? `<div style="margin-top:12px;"><button onclick="markAllPaid('${j.id}')" class="btn-accent">全員を一括補填済みにする</button></div>` : ""}
  </div></section>
  <section class="tech-section"><span class="sec-num">02</span><h2>Join / Claim</h2>
  <div class="form-row c2">
    <div class="data-panel"><span class="panel-label">Join</span>
      <form onsubmit="joinJob('${j.id}',event)" class="tech-form"><div class="field"><label>名前</label><input name="name" placeholder="参加する名前" /></div>
      <div style="margin-top:12px;"><button class="btn-primary">参加</button></div></form></div>
    <div class="data-panel"><span class="panel-label">Claim</span>
      <form onsubmit="submitClaim('${j.id}',event)" class="tech-form">
        <div class="field"><label>自分の名前</label><input name="name" placeholder="自分の名前" /></div>
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
  const txs = load(LS.pool, []).slice().reverse();
  return `<section class="tech-section"><span class="sec-num">01</span><h2>Pool</h2>
  <div class="data-panel"><span class="panel-label">Balance</span><div class="big-num">${yen(poolBalance())}</div><div class="sub">プール残高</div></div>
  ${isBoss() ? `<div class="data-panel" style="margin-top:24px;"><span class="panel-label">In / Out</span>
    <form onsubmit="addPool(event)" class="tech-form"><div class="form-row c2">
      <div class="field"><label>種別</label><select name="type"><option>入金</option><option>出金</option></select></div>
      <div class="field"><label>金額</label><input name="amount" type="number" min="1" placeholder="金額" /></div></div>
      <div class="field" style="margin-top:12px;"><label>メモ</label><input name="memo" placeholder="上納金 / 分配金など" /></div>
      <div style="margin-top:12px;"><button class="btn-primary">登録</button></div></form></div>`
  : `<p class="lock-note">入出金登録はボス-loginが必要。閲覧は全員可。</p>`}
  </section>
  <section class="tech-section"><span class="sec-num">02</span><h2>Ledger</h2>
  <table class="tech-table"><tr><th>種別</th><th>金額</th><th>メモ</th><th>日時</th></tr>
  ${txs.map(t => `<tr><td>${statusBadge(t.type === "入金" ? "申請中" : "補填済み")} ${esc(t.type)}</td><td><b>${yen(t.amount)}</b></td><td>${esc(t.memo || "")}</td><td style="font-size:12px;">${esc((t.created_at || "").slice(0, 16))}</td></tr>`).join("") || '<tr><td colspan="4">履歴なし</td></tr>'}</table></section>`;
}
function viewMembers() {
  const members = load(LS.members, []);
  return `<section class="tech-section"><span class="sec-num">01</span><h2>Members</h2>
  ${isBoss() ? `<div class="data-panel"><span class="panel-label">Add Member</span>
    <form onsubmit="addMember(event)" class="tech-form"><div class="form-row c2">
      <div class="field"><label>名前</label><input name="name" placeholder="名前" /></div>
      <div class="field"><label>役職</label><select name="role"><option value="member">構成員</option><option value="underboss">アンダーボス</option><option value="boss">ボス</option></select></div></div>
      <div style="margin-top:12px;"><button class="btn-primary">追加</button></div></form></div>`
  : `<p class="lock-note">メンバー編集はボスのみ。閲覧は全員可。参加・申告時に自動追加されます。</p>`}
  <table class="tech-table" style="margin-top:24px;"><tr><th>NO</th><th>名前</th><th>役職</th></tr>
  ${members.map((m, i) => `<tr><td class="num">${String(i + 1).padStart(2, "0")}</td><td><b>${esc(m.name)}</b></td><td>${esc(m.role)}</td></tr>`).join("") || '<tr><td colspan="3">メンバー未登録</td></tr>'}</table></section>`;
}

function render() {
  seedMembers();
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
document.getElementById("loginBtn").onclick = () => document.getElementById("loginModal").classList.remove("hidden");
document.getElementById("loginClose").onclick = () => document.getElementById("loginModal").classList.add("hidden");
document.getElementById("loginGo").onclick = () => {
  const v = document.getElementById("loginPass").value;
  if (v === window.AppConfig.BOSS_PASSCODE) { sessionStorage.setItem(LS.boss, "1"); document.getElementById("loginModal").classList.add("hidden"); document.getElementById("loginPass").value = ""; render(); }
  else alert("合言葉が違います");
};
document.getElementById("logoutBtn").onclick = () => { sessionStorage.removeItem(LS.boss); document.getElementById("loginModal").classList.add("hidden"); render(); };
if (!location.hash) location.hash = "#/jobs";
render();
