/* The legislation toolbox: every government's taxes, and a bill screen brought over from the old build.
   A bill is a list of lines; each line sets one sub-policy to a new value. Nothing here touches a saved game. */
let P, GOV = {}, POL = {}, ISSUE_AT = {};
const KEY = "ttcb-legislation-1";
const S = Object.assign({ gov: "fl", tab: "taxes", lines: {}, edit: null, sponsor: "", sel: null, year: 0, changes: {}, pending: [], bills: [], seq: 0 }, JSON.parse(localStorage.getItem(KEY) || "{}"));
const save = () => localStorage.setItem(KEY, JSON.stringify(S));
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const LEVEL = { federal: "Federal", state: "State", county: "County", city: "City", school: "School district" };
const STOPS = ["Raise a lot", "Raise", "Keep", "Lower", "Lower a lot"], STOP_COL = ["#2f558e", "#7d97bf", "#c8ccd1", "#c88783", "#9a3b39"];

/* ---------- numbers ---------- */
const trim = (v, d) => (+(+v).toFixed(d)).toLocaleString("en-US", { maximumFractionDigits: d });
function money(v) { const a = Math.abs(v), s = v < 0 ? "-" : ""; return a >= 1e12 ? `${s}$${trim(a / 1e12, 2)}T` : a >= 1e9 ? `${s}$${trim(a / 1e9, 2)}B` : a >= 1e6 ? `${s}$${trim(a / 1e6, 1)}M` : `${s}$${Math.round(a).toLocaleString("en-US")}`; }
const signed = (v) => (v > 0 ? "+" : "") + money(v);
function show(sub, v) {
  if (v == null) return "";
  switch (sub.unit) { case "percent": return trim(v, 2) + "%"; case "mills": return trim(v, 3) + " mills"; case "cents": return trim(v, 1) + "¢ a gallon"; case "dollars": return money(v);
    case "days": return `${Math.round(v)} days`; case "years": return `${Math.round(v)} years`; case "yesno": return v ? "Yes" : "No"; }
  return String(v);
}

/* ---------- what a government holds ---------- */
const subsOf = (pol, kind) => pol.subs.filter((s) => !s.levels || s.levels.includes(kind));
const holds = (pol, g) => pol.held.includes(g.kind);
function startOf(g, pol) {
  if (!holds(pol, g) || (pol.absent || []).includes(g.kind)) return null;
  const raw = (pol.values || {})[g.kind]; if (!raw) return null;
  const out = {}; for (const s of subsOf(pol, g.kind)) if (raw[s.id] != null) out[s.id] = s.per_pop ? Math.round(raw[s.id] * g.pops / 1000) * 1000 : raw[s.id];
  return out;
}
function createOf(g, pol) { const raw = (pol.create || {})[g.kind] || (pol.values || {})[g.kind] || {}; const out = {}; for (const s of subsOf(pol, g.kind)) out[s.id] = s.per_pop ? Math.round((raw[s.id] || 0) * g.pops / 1000) * 1000 : raw[s.id] != null ? raw[s.id] : s.min || 0; return out; }
const parentOf = (g) => (g.kind === "county" || g.kind === "city" || g.kind === "school" ? GOV.fl : null);
/* the top value a higher level lets this one set */
function limitOf(g, pol, sub, changes) { const up = parentOf(g); if (!up) return null; const cap = pol.subs.find((s) => s.limits && s.limits.sub === sub.id && s.limits.levels.includes(g.kind)); if (!cap) return null; const v = nowOf(up, pol, changes); return v ? v[cap.id] : null; }
function nowOf(g, pol, changes) {
  const ch = ((changes || S.changes)[g.id] || {})[pol.id], st = startOf(g, pol);
  if (!st && !ch) return null;
  const out = { ...(st || {}), ...(ch || {}) };
  for (const s of subsOf(pol, g.kind)) { const lim = limitOf(g, pol, s, changes); if (lim != null && out[s.id] > lim) out[s.id] = lim; }
  return out;
}
const FN = {};
function revenue(g, pol, vals, changes) {
  if (!vals) return 0; const expr = (pol.revenue || {})[g.kind]; if (!expr) return 0;
  const f = FN[pol.id + g.kind] || (FN[pol.id + g.kind] = new Function("b", "v", "up", `with(b){with(v){return ${expr}}}`));
  const up = parentOf(g); return f(g.base, vals, (up && nowOf(up, pol, changes)) || {}) || 0;
}
function rating(g, pol, vals) {
  const bands = (pol.rating || {})[g.kind] || (pol.rating_per_pop || {})[g.kind], words = pol.spend ? P.bands_spend : P.bands_tax;
  if (!vals) return bands ? words[0] : ""; if (!bands) return "";
  const v = vals[pol.main[g.kind]] / (pol.rating_per_pop ? g.pops : 1); return words[bands.filter((t) => v >= t).length];
}
const totalRev = (g, changes) => P.policies.reduce((a, pol) => a + (holds(pol, g) ? revenue(g, pol, nowOf(g, pol, changes), changes) : 0), 0);

/* ---------- pops: where they stand, from the histogram of their scores ---------- */
/* a pop is a hundred people, and they do not all stand in one place */
const SPREAD = [[-70, 0.06], [-35, 0.24], [0, 0.4], [35, 0.24], [70, 0.06]];
function bins(area, issue) { const n = P.bins.n, h = P.areas[area] || P.areas.all, at = ISSUE_AT[issue] * 3 * n, out = []; for (let p = 0; p < 3; p++) for (let b = 0; b < n; b++) { const w = h[at + p * n + b]; if (w) for (const [d, k] of SPREAD) out.push([P.bins.lo + (b + 0.5) * P.bins.step + d, w * k, "DIR"[p]]); } return out; }
const wantOf = (pol, score) => P.drift * (score - P.issues[ISSUE_AT[pol.position]].keep) / 100 * pol.dir;
const createWish = (pol, score) => (score - P.issues[ISSUE_AT[pol.position]].keep) * pol.dir / 100 - 0.3;
function stand(g, pol, vals) {
  const B = bins(g.area, pol.position), tot = B.reduce((a, b) => a + b[1], 0) || 1, st = startOf(g, pol);
  if (!vals || !st) { const yes = B.reduce((a, [s, w]) => a + (createWish(pol, s) > 0 ? w : 0), 0) / tot; return { create: yes }; }
  const main = pol.main[g.kind], s0 = st[main], c = vals[main], shares = [0, 0, 0, 0, 0], ideals = [];
  for (const [s, w] of B) { const ideal = Math.max(0, s0 * (1 + wantOf(pol, s))), gap = c ? (ideal - c) / c : ideal > 0 ? 1 : 0; shares[gap > 0.3 ? 0 : gap > 0.08 ? 1 : gap >= -0.08 ? 2 : gap >= -0.3 ? 3 : 4] += w / tot; ideals.push([ideal, w]); }
  ideals.sort((a, b) => a[0] - b[0]); let acc = 0, med = ideals.length ? ideals[0][0] : 0; for (const [v, w] of ideals) { acc += w; if (acc >= tot / 2) { med = v; break; } }
  return { shares, median: med };
}
const standBar = (sh) => `<div class="stack pbar">${sh.map((v, i) => `<i style="width:${(100 * v).toFixed(1)}%;background:${STOP_COL[i]}" title="${STOPS[i]} ${Math.round(100 * v)}%"></i>`).join("")}</div>`;

/* ---------- a bill ---------- */
const lineKey = (pol, sub) => pol.id + "." + sub;
const linesOf = (lines) => Object.entries(lines).map(([k, v]) => { const [p, s] = k.split("."); return { key: k, pol: POL[p], sub: s === "@" ? null : POL[p].subs.find((x) => x.id === s), v }; });
/* the government's values if these lines were law */
function withLines(g, lines) { const ch = JSON.parse(JSON.stringify(S.changes)); ch[g.id] = ch[g.id] || {}; for (const L of linesOf(lines)) { if (!L.sub) continue; ch[g.id][L.pol.id] = { ...(nowOf(g, L.pol) || {}), ...(ch[g.id][L.pol.id] || {}), [L.sub.id]: L.v }; } return ch; }
function changed(g, lines) { return linesOf(lines).filter((L) => { if (!L.sub) return true; const now = nowOf(g, L.pol); return !now || Math.abs(L.v - now[L.sub.id]) > 1e-9; }); }
/* how much closer a line brings the law to what someone with this score wants: -1 to 1 */
function gain(g, L, score) {
  const pol = L.pol, now = nowOf(g, pol);
  if (!L.sub) return clamp(createWish(pol, score), -1, 1) * 0.6;
  if (!now) return 0;
  const sub = L.sub, w = wantOf(pol, score) * (sub.dir || 1), c = now[sub.id], main = pol.main[g.kind] === sub.id, k = main ? 1 : sub.limits ? 0.3 : 0.5;
  if (sub.unit === "yesno") { const pref = w > 0.04 ? 1 : w < -0.04 ? 0 : null; return pref == null ? 0 : 0.15 * k * ((+L.v === pref) - (+c === pref)); }
  const s0 = (startOf(g, pol) || createOf(g, pol))[sub.id], t = Math.max(0, s0 * (1 + w)) + (s0 ? 0 : w > 0 ? (sub.scale || 1) * w : 0), scale = Math.max(Math.abs(c), sub.scale || Math.abs(s0) || 1);
  return k * clamp((Math.abs(t - c) - Math.abs(t - L.v)) / scale, -1, 1);
}
const billGain = (g, ch, scoreOf) => ch.reduce((a, L) => a + gain(g, L, scoreOf(L.pol.position)), 0);
function popsFor(g, ch, area) {
  /* every pop is one score per issue here, so a bill that crosses positions is read position by position */
  const out = { all: [0, 0, 0], D: [0, 0, 0], I: [0, 0, 0], R: [0, 0, 0] }, byPos = {};
  for (const L of ch) (byPos[L.pol.position] = byPos[L.pol.position] || []).push(L);
  const n = Object.keys(byPos).length || 1;
  for (const [pos, Ls] of Object.entries(byPos)) for (const [s, w, p] of bins(area, pos)) { const u = Ls.reduce((a, L) => a + gain(g, L, s), 0), k = u > 0.004 ? 0 : u < -0.004 ? 1 : 2; out.all[k] += w / n; out[p][k] += w / n; }
  const pct = (r) => { const t = r[0] + r[1] + r[2] || 1; return [100 * r[0] / t, 100 * r[1] / t]; };
  return { all: pct(out.all), D: pct(out.D), I: pct(out.I), R: pct(out.R), mean: (area2) => { let a = 0, t = 0; for (const [pos, Ls] of Object.entries(byPos)) for (const [s, w] of bins(area2, pos)) { a += w * Ls.reduce((x, L) => x + gain(g, L, s), 0); t += w / Object.keys(byPos).length; } return t ? a / t : 0; } };
}
function memberView(g, ch, m, pf) {
  const R = [], sc = (pos) => m[4 + ISSUE_AT[pos]];
  const hash = [...(m[1] + ch.map((L) => L.key).join())].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 9973, 7) % 9 - 4;
  R.push(["Their beliefs", clamp(300 * billGain(g, ch, sc), -70, 70) + hash]);
  R.push(["Their district", clamp(180 * pf.mean(m[3]), -40, 40)]);
  if (S.sponsor) R.push(["The sponsor", S.sponsor === m[2] ? 5 : m[2] === "I" ? 0 : -5]);
  return { op: clamp(R.reduce((a, r) => a + r[1], 0), -100, 100), reasons: R };
}
function billView(g, lines) {
  const ch = changed(g, lines), pf = popsFor(g, ch, g.area);
  const chambers = g.chambers.map((c) => { const ops = c.seats.map((m) => (ch.length ? memberView(g, ch, m, pf) : { op: 0, reasons: [] })); const yes = ops.filter((o) => o.op > 2).length, no = ops.filter((o) => o.op < -2).length; return { c, ops, yes, no, needed: Math.floor(c.seats.length / 2) + 1 }; });
  return { ch, pf, chambers, passes: ch.length > 0 && chambers.every((x) => x.yes >= x.needed) };
}
function billTitle(g, ch) {
  const parts = ch.map((L) => { if (!L.sub) return `create ${L.pol.name.toLowerCase()}`; const now = nowOf(g, L.pol); if (!now) return null; const n = L.sub.name[0].toLowerCase() + L.sub.name.slice(1); return L.sub.unit === "yesno" ? `${L.v ? "begin" : "end"}: ${n}` : `${L.v > now[L.sub.id] ? "raise" : "lower"} the ${L.pol.name.toLowerCase()} ${n}`; }).filter(Boolean);
  const t = parts.length > 3 ? `Change ${parts.length} tax lines` : parts.join(" and "); return t ? t[0].toUpperCase() + t.slice(1) : "A tax bill";
}
const HEAD = { federal: () => ["AN ACT OF THE CONGRESS OF THE UNITED STATES", "act"], state: () => ["AN ACT OF THE LEGISLATURE OF THE STATE OF FLORIDA", "act"], county: (g) => [`AN ORDINANCE OF THE BOARD OF COUNTY COMMISSIONERS OF ${g.name.toUpperCase()}`, "ordinance"],
  city: (g) => [`AN ORDINANCE OF THE COUNCIL OF ${g.name.toUpperCase()}`, "ordinance"], school: (g) => [`A RESOLUTION OF THE SCHOOL BOARD OF ${g.county.toUpperCase()}`, "resolution"] };

/* ---------- the seating chart, from the old build ---------- */
function hemi(n, W, H, big) { const rows = n <= 7 ? 1 : n <= 30 ? 3 : n <= 70 ? 5 : 7, dot = n <= 7 ? big : big * (n <= 30 ? .5 : .33), R = Math.min(W / 2, H) - dot / 2 - 2, r0 = rows === 1 ? R * .92 : R * .42, radii = [];
  for (let i = 0; i < rows; i++) radii.push(rows === 1 ? r0 : r0 + (R - r0) * i / (rows - 1)); const sum = radii.reduce((a, b) => a + b, 0), per = radii.map((x) => Math.round(n * x / sum)); per[rows - 1] += n - per.reduce((a, b) => a + b, 0);
  const pts = []; radii.forEach((rad, ri) => { const k = per[ri]; for (let j = 0; j < k; j++) { const th = k === 1 ? Math.PI / 2 : Math.PI * (1 - j / (k - 1)); pts.push({ x: W / 2 + rad * Math.cos(th), y: H - dot / 2 - 2 - rad * Math.sin(th) * (rows === 1 ? .75 : 1), th, rad }); } });
  pts.sort((a, b) => b.th - a.th || a.rad - b.rad); return { pts, dot }; }
const supCol = (op) => (op >= 40 ? "#1e6b33" : op >= 12 ? "#43a35c" : op > 2 ? "#a5d6a7" : op >= -2 ? "#c8ccd1" : op > -12 ? "#f4b6b3" : op > -40 ? "#d9534f" : "#9b1c1c");
const VOTE_COL = { Aye: "#1e6b33", Nay: "#9b1c1c", Abstain: "#a2a9b1" }, PARTY = { D: "Democrat", R: "Republican", I: "Independent" };
const fmtOp = (v) => (v > 0 ? "+" : "") + Math.round(v);

/* ---------- drawing ---------- */
function draw() {
  const g = GOV[S.gov] || GOV.fl; S.gov = g.id; save();
  const tabs = [["taxes", "Taxes"], ["bill", "Bill"], ["passed", `Passed${S.bills.length ? ` (${S.bills.length})` : ""}`]];
  const kinds = Object.keys(LEVEL), places = P.govs.filter((x) => x.kind === g.kind).sort((a, b) => a.name.localeCompare(b.name));
  $("page").innerHTML = `<div class="bhead"><div class="bht">${esc(g.name)}</div><div class="pt">${LEVEL[g.kind]} · ${g.pops.toLocaleString("en-US")} pops · ${S.year}</div><div style="flex:1"></div>
      <select id="lv" aria-label="Level">${kinds.map((k) => `<option value="${k}"${k === g.kind ? " selected" : ""}>${LEVEL[k]}</option>`).join("")}</select>
      <select id="pl" aria-label="Government"${places.length < 2 ? " disabled" : ""}>${places.map((x) => `<option value="${esc(x.id)}"${x.id === g.id ? " selected" : ""}>${esc(x.name)}${x.kind === "city" ? ` (${esc(x.county.replace(" County", ""))})` : ""}</option>`).join("")}</select></div>
    <div class="ent-tabs" role="tablist">${tabs.map(([k, n]) => `<button role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${n}</button>`).join("")}</div><div id="body"></div>`;
  $("lv").onchange = (e) => { const first = P.govs.filter((x) => x.kind === e.target.value).sort((a, b) => a.name.localeCompare(b.name))[0]; pick(first.id); };
  $("pl").onchange = (e) => pick(e.target.value);
  document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; draw(); }));
  ({ taxes: drawTaxes, bill: drawBill, passed: drawPassed })[S.tab](g);
}
function pick(id) { S.gov = id; S.lines = {}; S.edit = null; S.sel = null; draw(); }

function drawTaxes(g) {
  const groups = P.issues.map((i) => [i, P.policies.filter((p) => p.position === i.id && holds(p, g))]).filter((x) => x[1].length);
  const others = (pol) => ["federal", "state", "county"].filter((k) => k !== g.kind && pol.held.includes(k)).map((k) => { const o = k === "federal" ? GOV.us : k === "state" ? GOV.fl : P.govs.find((x) => x.kind === "county" && x.name === g.county); if (!o) return ""; const v = nowOf(o, pol), sub = pol.subs.find((s) => s.id === pol.main[k]); return v ? `${LEVEL[k]} ${show(sub, v[sub.id])}` : ""; }).filter(Boolean).join(" · ");
  const row = (pol) => {
    const v = nowOf(g, pol), st = stand(g, pol, v), barred = (pol.barred || {})[g.kind], main = pol.subs.find((s) => s.id === pol.main[g.kind]), o = others(pol);
    if (!v) return `<tr class="absent"><td><b>${esc(pol.name)}</b>${o ? `<div class="pt">${o}</div>` : ""}</td><td>${rating(g, pol, null)}</td><td>${barred ? `<span class="pt">Barred by the ${esc(barred)}</span>` : `<button class="btn" data-create="${pol.id}">Create</button>`}</td><td class="n"></td>
      <td><div class="stack pbar"><i style="width:${(100 * st.create).toFixed(1)}%;background:${STOP_COL[0]}"></i><i style="width:${(100 - 100 * st.create).toFixed(1)}%;background:${STOP_COL[2]}"></i></div><div class="pt">Create ${Math.round(100 * st.create)}% · Don’t create ${Math.round(100 - 100 * st.create)}%</div></td></tr>`;
    const top = STOPS[st.shares.indexOf(Math.max(...st.shares))];
    return `<tr><td><b>${esc(pol.name)}</b>${o ? `<div class="pt">${o}</div>` : ""}</td><td>${rating(g, pol, v)}</td>
      <td>${subsOf(pol, g.kind).map((s) => `<div class="subv"><span>${esc(s.name)}</span><button class="bnum" data-add="${lineKey(pol, s.id)}">${show(s, v[s.id])}</button></div>`).join("")}</td>
      <td class="n">${money(revenue(g, pol, v))}</td>
      <td>${standBar(st.shares)}<div class="pos1">${top} <span class="pt">${Math.round(100 * Math.max(...st.shares))}%</span></div><div class="pt ideal">Median ideal ${show(main, st.median)}</div></td></tr>`;
  };
  $("body").innerHTML = `<div class="tsum"><div><div class="blab">Tax revenue a year${g.kind === "federal" ? ", from Florida" : ""}</div><div class="bneed">${money(totalRev(g))}</div></div><div><div class="blab">A year per pop</div><div class="bneed">${money(totalRev(g) / g.pops)}</div></div>
      <div class="vkey">${STOPS.map((s, i) => `<span><i style="background:${STOP_COL[i]};border-radius:0"></i>${s}</span>`).join("")}</div></div>
    ${groups.map(([i, pols]) => `<h2>${esc(i.name)}</h2><table class="dir tax"><thead><tr><th>Policy</th><th>Rating</th><th>Sub-policies</th><th>A year</th><th>Pops</th></tr></thead><tbody>${pols.map(row).join("")}</tbody></table>`).join("")}`;
  document.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => addLine(g, b.dataset.add)));
  document.querySelectorAll("[data-create]").forEach((b) => (b.onclick = () => addCreate(g, b.dataset.create)));
}
function addLine(g, key) { const [p, s] = key.split("."), now = nowOf(g, POL[p]); if (!now) return addCreate(g, p); if (!(key in S.lines)) S.lines[key] = now[s]; S.edit = key; S.tab = "bill"; draw(); }
function addCreate(g, p) { const pol = POL[p]; if ((pol.barred || {})[g.kind]) return; S.lines[p + ".@"] = 1; for (const [k, v] of Object.entries(createOf(g, pol))) S.lines[p + "." + k] = v; S.tab = "bill"; draw(); }

function drawBill(g) {
  const view = billView(g, S.lines), ch = view.ch, all = linesOf(S.lines), ch2 = withLines(g, S.lines);
  const rev0 = totalRev(g), rev1 = totalRev(g, ch2), dRev = rev1 - rev0, [head, word] = HEAD[g.kind](g);
  const groups = P.issues.map((i) => [i, P.policies.filter((p) => p.position === i.id && holds(p, g))]).filter((x) => x[1].length);
  const left = `<h2 class="bh2">Add to the bill</h2>${groups.map(([i, pols]) => `<label class="bcat"><span class="blab">${esc(i.name)}</span><select data-addline><option value="">Add…</option>${pols.map((pol) => { const v = nowOf(g, pol), barred = (pol.barred || {})[g.kind];
      return v || (pol.id + ".@") in S.lines ? `<optgroup label="${esc(pol.name)}">${subsOf(pol, g.kind).map((s) => `<option value="${lineKey(pol, s.id)}"${lineKey(pol, s.id) in S.lines ? " disabled" : ""}>${esc(s.name)}</option>`).join("")}</optgroup>` : `<option value="${pol.id}.@"${barred ? " disabled" : ""}>Create: ${esc(pol.name)}</option>`; }).join("")}</select></label>`).join("")}
    <label class="bcat"><span class="blab">Sponsor</span><select id="sponsor"><option value="">Nobody</option><option value="D"${S.sponsor === "D" ? " selected" : ""}>A Democrat</option><option value="R"${S.sponsor === "R" ? " selected" : ""}>A Republican</option></select></label>`;
  const sec = (L, i) => {
    const pol = L.pol, now = nowOf(g, pol), lead = i ? "" : `Beginning the first week of ${S.year + 1}, `, cap = (t) => (i ? t[0].toUpperCase() + t.slice(1) : t);
    if (!L.sub) return `<div class="bsec"><button class="bx" data-rm="${L.key}" aria-label="Remove">×</button><div class="blab">Section ${i + 1} · ${esc(P.issues[ISSUE_AT[pol.position]].name)}</div><div class="btext">${lead}${cap(`${pol.name.toLowerCase()} ${pol.name.endsWith('s') ? 'are' : 'is'} created.`)}</div></div>`;
    const sub = L.sub, n0 = now ? now[sub.id] : null, lim = limitOf(g, pol, sub), per = sub.per_pop ? (startOf(g, pol) || createOf(g, pol))[sub.id] || 1000 * g.pops : 0;
    const lo = sub.min || 0, hi = Math.min(sub.per_pop ? Math.max(per * sub.max_mult, 1e5) : sub.max, lim != null ? lim : Infinity), step = sub.per_pop ? Math.max(1000, Math.round(per * sub.step_mult / 1000) * 1000) : sub.step;
    const name = `the ${pol.name.toLowerCase()} ${sub.name[0].toLowerCase() + sub.name.slice(1)}`, dir = n0 == null ? "" : Math.abs(L.v - n0) < 1e-9 ? `, unchanged at ${show(sub, n0)}` : `, ${L.v > n0 ? "raised" : "cut"} from ${show(sub, n0)}`;
    const text = sub.unit === "yesno" ? `${lead}${cap(sub.name[0].toLowerCase() + sub.name.slice(1))} under the ${pol.name.toLowerCase()}: <button class="bnum" data-flip="${L.key}">${show(sub, L.v)}</button>${n0 == null ? "" : +L.v === +n0 ? ", unchanged" : `, changed from ${show(sub, n0)}`}.`
      : `${lead}${cap(name)} shall be <button class="bnum" data-num="${L.key}">${show(sub, L.v)}</button>${dir}.`;
    return `<div class="bsec"><button class="bx" data-rm="${L.key}" aria-label="Remove">×</button><div class="blab">Section ${i + 1} · ${esc(P.issues[ISSUE_AT[pol.position]].name)}</div><div class="btext">${text}</div>
      ${S.edit === L.key && sub.unit !== "yesno" ? `<div class="bslide"><span class="pt">${show(sub, lo)}</span><input type="range" min="${lo}" max="${hi}" step="${step}" value="${L.v}" data-slide="${L.key}" aria-label="${esc(sub.name)}"><span class="pt">${show(sub, hi)}</span><input type="number" min="${lo}" max="${hi}" step="${step}" value="${L.v}" data-numin="${L.key}" aria-label="${esc(sub.name)}"><button class="btn" data-num="${L.key}">Done</button></div>` : ""}
      ${lim != null && sub.unit !== "yesno" ? `<div class="pt">State top ${show(sub, lim)}</div>` : ""}</div>`;
  };
  const middle = `<h2 class="bh2">${ch.length ? esc(billTitle(g, ch)) : "The bill"}</h2><div class="bdoc"><div class="bdt">${esc(head)}</div><div class="bds">relating to taxation; providing an effective date</div></div>
    ${all.length ? all.map(sec).join("") : `<div class="bsec pt" style="text-align:center;padding:24px">Nothing in the bill yet.</div>`}
    <div class="bacts"><button class="btn primary" id="vote"${ch.length ? "" : " disabled"}>Call the vote</button><button class="btn" id="clear">Start over</button></div>`;
  /* the money */
  const fig = (l, v, c) => `<div class="bfig"><span>${l}</span><span class="${c || "zero"}">${v}</span></div>`;
  const eff = [], byPol = {};
  for (const L of ch) byPol[L.pol.id] = L.pol;
  for (const pol of Object.values(byPol)) {
    const a = nowOf(g, pol), b = nowOf(g, pol, ch2), d = revenue(g, pol, b, ch2) - revenue(g, pol, a);
    if (Math.abs(d) >= 1) eff.push(`${pol.name} will ${pol.spend ? (d < 0 ? "cost" : "save") : d > 0 ? "bring in" : "lose"} ${money(Math.abs(d))} ${pol.spend ? (d < 0 ? "more" : "") : d > 0 ? "more" : ""} a year.`.replace("  ", " "));
    const r0 = rating(g, pol, a), r1 = rating(g, pol, b); if (r0 !== r1 && r1) eff.push(`${pol.name}: ${r0 || "None"} to ${r1}.`);
    if (a && b) { const s0 = stand(g, pol, a).shares, s1 = stand(g, pol, b).shares, low0 = s0[3] + s0[4], low1 = s1[3] + s1[4], up0 = s0[0] + s0[1], up1 = s1[0] + s1[1];
      if (Math.abs(low1 - low0) >= 0.02) eff.push(`Pops who want it lowered: ${Math.round(100 * low0)}% to ${Math.round(100 * low1)}%.`); if (Math.abs(up1 - up0) >= 0.02) eff.push(`Pops who want it raised: ${Math.round(100 * up0)}% to ${Math.round(100 * up1)}%.`); }
  }
  let below = 0; if (g.kind === "state" && ch.length) for (const o of P.govs) if (parentOf(o)) below += totalRev(o, ch2) - totalRev(o);
  if (Math.abs(below) >= 1) eff.push(`Counties, cities and school districts will ${below > 0 ? "bring in" : "lose"} ${money(Math.abs(below))} ${below > 0 ? "more " : ""}a year.`);
  const moneyCol = `<h2 class="bh2">The money</h2><div class="bmoney"><div class="blab">Current</div>${fig("Tax revenue", money(rev0))}${fig("A year per pop", money(rev0 / g.pops))}
      <div class="bsep"></div><div class="blab">If it passes</div>${fig("Tax revenue", money(rev1), dRev > 0 ? "pos" : dRev < 0 ? "neg" : "zero")}${fig("Change", signed(dRev), dRev > 0 ? "pos" : dRev < 0 ? "neg" : "zero")}${fig("A year per pop", signed(dRev / g.pops), dRev > 0 ? "pos" : dRev < 0 ? "neg" : "zero")}</div>
    <div class="blab">What should happen</div>${eff.length ? eff.map((t) => `<p class="beff">${esc(t)}</p>`).join("") : `<p class="beff pt">Nothing changes yet.</p>`}`;
  /* how they'd vote */
  const charts = view.chambers.map((x, ci) => {
    const order = x.c.seats.map((m, i) => i).sort((a, b) => x.ops[b].op - x.ops[a].op), W = 424, H = view.chambers.length > 1 ? 150 : 190, h = hemi(order.length, W, H, order.length <= 7 ? 50 : 40);
    const dots = order.map((mi, i) => { const p = h.pts[i], on = S.sel === ci + ":" + mi; return `<button class="vdot" data-dot="${ci}:${mi}" style="left:${p.x.toFixed(1)}px;top:${p.y.toFixed(1)}px;width:${h.dot}px;height:${h.dot}px;background:${ch.length ? supCol(x.ops[mi].op) : "#c8ccd1"};${on ? "outline:2px solid #202122;outline-offset:3px;" : ""}" aria-label="${esc(x.c.seats[mi][1])}"></button>`; }).join("");
    const n = { D: 0, R: 0, I: 0 }; x.c.seats.forEach((m) => n[m[2]]++);
    return `<div class="bpanel"><div class="wh"><b>${esc(x.c.name)}</b><span class="pt">${["R", "D", "I"].filter((k) => n[k]).map((k) => `${n[k]} ${PARTY[k]}${n[k] > 1 ? "s" : ""}`).join(" · ")}</span></div>
      <div class="vchart" style="width:${W}px;height:${H + 58}px">${dots}<div class="vtally"><div class="vt1">${ch.length ? `${x.yes} for · ${x.no} against` : `${x.needed} of ${x.c.seats.length} to pass`}</div><div class="${!ch.length ? "pt" : x.yes >= x.needed ? "pos" : "neg"}">${!ch.length ? "" : x.yes >= x.needed ? "Would pass today" : `${x.needed - x.yes} more to pass`}</div></div></div></div>`; }).join("");
  let selBox = "";
  if (S.sel && ch.length) { const [ci, mi] = S.sel.split(":").map(Number), x = view.chambers[ci]; if (x && x.c.seats[mi]) { const m = x.c.seats[mi], o = x.ops[mi];
    selBox = `<div class="bpanel wsel"><div class="wh"><b>${esc(m[1])}</b><span class="${o.op > 0 ? "pos" : o.op < 0 ? "neg" : "zero"}">${fmtOp(o.op)}</span></div><div class="pt">${esc(x.c.name)}${m[0] ? " · " + esc(m[0]) : ""} · ${PARTY[m[2]]}</div>${o.reasons.map(([l, v]) => `<div class="bfig"><span>${l}</span><span class="${v > 0.5 ? "pos" : v < -0.5 ? "neg" : "zero"}">${fmtOp(v)}</span></div>`).join("")}</div>`; } }
  const sup = [["Everyone", "all"], ["Democrats", "D"], ["Republicans", "R"], ["Independents", "I"]];
  const right = `<h2 class="bh2">How they’d vote today</h2>${charts}
    <div class="vkey"><span><i style="background:#1e6b33"></i>Strongly for</span><span><i style="background:#a5d6a7"></i>Leaning for</span><span><i style="background:#c8ccd1"></i>Abstain</span><span><i style="background:#f4b6b3"></i>Leaning against</span><span><i style="background:#9b1c1c"></i>Strongly against</span></div>${selBox}
    <div class="bpanel"><div class="blab">Pops for it · against it</div>${ch.length ? sup.map(([n, k]) => `<div class="vsup"><span>${n}</span><div class="vbar two"><i style="width:${view.pf[k][0].toFixed(1)}%;background:#43a35c"></i><i style="left:auto;right:0;width:${view.pf[k][1].toFixed(1)}%;background:#d9534f"></i></div><b>${Math.round(view.pf[k][0])}·${Math.round(view.pf[k][1])}</b></div>`).join("") : `<div class="pt">Nothing to weigh yet.</div>`}</div>`;
  $("body").innerHTML = `<div class="bgrid"><div class="bcol">${left}</div><div class="bcol">${middle}</div><div class="bcol">${moneyCol}</div><div class="bcol">${right}</div></div>`;
  document.querySelectorAll("[data-addline]").forEach((s) => (s.onchange = () => { const k = s.value; if (!k) return; if (k.endsWith(".@")) return addCreate(g, k.split(".")[0]); addLine(g, k); }));
  $("sponsor").onchange = (e) => { S.sponsor = e.target.value; draw(); };
  document.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { const k = b.dataset.rm, p = k.split(".")[0]; if (k.endsWith(".@") || !nowOf(g, POL[p])) { for (const x of Object.keys(S.lines)) if (x.startsWith(p + ".")) delete S.lines[x]; } else delete S.lines[k]; S.edit = null; draw(); }));
  document.querySelectorAll("[data-num]").forEach((b) => (b.onclick = () => { S.edit = S.edit === b.dataset.num ? null : b.dataset.num; draw(); }));
  document.querySelectorAll("[data-flip]").forEach((b) => (b.onclick = () => { S.lines[b.dataset.flip] = S.lines[b.dataset.flip] ? 0 : 1; draw(); }));
  document.querySelectorAll("[data-slide]").forEach((r) => { r.oninput = () => { S.lines[r.dataset.slide] = +r.value; const n = document.querySelector(`[data-numin="${r.dataset.slide}"]`); if (n) n.value = r.value; }; r.onchange = () => draw(); });
  document.querySelectorAll("[data-numin]").forEach((n) => (n.onchange = () => { S.lines[n.dataset.numin] = clamp(+n.value, +n.min, +n.max); draw(); }));
  document.querySelectorAll("[data-dot]").forEach((b) => (b.onclick = () => { S.sel = S.sel === b.dataset.dot ? null : b.dataset.dot; draw(); }));
  $("clear").onclick = () => { S.lines = {}; S.edit = null; S.sel = null; draw(); };
  $("vote").onclick = () => callVote(g, view);
}

function callVote(g, view) {
  const lines = {}; for (const L of view.ch) lines[L.key] = L.v;
  for (const L of linesOf(S.lines)) if (L.sub && (L.pol.id + ".@") in S.lines) lines[L.key] = L.v;     /* a created policy carries all its sub-policies */
  const was = {}; for (const L of view.ch) if (L.sub) { const now = nowOf(g, L.pol); was[L.key] = now ? now[L.sub.id] : null; }
  const bill = { id: "B" + ++S.seq, gov: g.id, title: billTitle(g, view.ch), lines, was, year: S.year, passed: view.passes,
    chambers: view.chambers.map((x) => ({ name: x.c.name, aye: x.yes, nay: x.no, abstain: x.c.seats.length - x.yes - x.no, needed: x.needed, roll: x.c.seats.map((m, i) => [m[1], m[2], m[0], x.ops[i].op > 2 ? "Aye" : x.ops[i].op < -2 ? "Nay" : "Abstain"]) })) };
  S.bills.unshift(bill); if (bill.passed) S.pending.push(bill.id);
  S.lines = {}; S.edit = null; S.sel = null; S.tab = "passed"; S.open = bill.id; draw();
}
function drawPassed(g) {
  const state = (b) => (!b.passed ? "Failed" : S.pending.includes(b.id) ? `Passed · in force the first week of ${b.year + 1}` : `In force since ${b.year + 1}`);
  const line = (b, k, v) => { const [p, s] = k.split("."), pol = POL[p]; if (s === "@") return `${pol.name} created`; const sub = pol.subs.find((x) => x.id === s); return `${pol.name}, ${sub.name[0].toLowerCase() + sub.name.slice(1)}: ${b.was[k] != null ? show(sub, b.was[k]) + " to " : ""}<b>${show(sub, v)}</b>`; };
  $("body").innerHTML = `<div class="bacts" style="margin:10px 0"><button class="btn primary" id="next">Advance to ${S.year + 1}</button><button class="btn" id="reset">Reset everything</button><span class="pt">${S.pending.length ? `${S.pending.length} waiting for ${S.year + 1}` : ""}</span></div>
    ${S.bills.length ? S.bills.map((b) => { const o = GOV[b.gov]; return `<details class="board"${S.open === b.id ? " open" : ""}><summary><b>${esc(b.title)}</b> <span class="pt">· ${esc(o ? o.name : b.gov)} · ${b.year} · </span><span class="${b.passed ? "pos" : "neg"}">${state(b)}</span></summary><div style="padding:8px 10px">
      ${Object.entries(b.lines).map(([k, v]) => `<div>${line(b, k, v)}</div>`).join("")}
      ${b.chambers.map((c) => `<h3>${esc(c.name)}: ${c.aye} for, ${c.nay} against, ${c.abstain} abstaining <span class="pt">(${c.needed} needed)</span></h3><div class="roll">${c.roll.map(([n, p, seat, v]) => `<span title="${esc(seat)} · ${PARTY[p]}"><i style="background:${VOTE_COL[v]}"></i>${esc(n)} <span class="pt">${p}</span></span>`).join("")}</div>`).join("")}</div></details>`; }).join("") : `<p class="pt">No bills yet.</p>`}`;
  $("next").onclick = () => { for (const id of S.pending) { const b = S.bills.find((x) => x.id === id), o = GOV[b.gov]; if (!o) continue; S.changes[o.id] = S.changes[o.id] || {}; for (const L of linesOf(b.lines)) { if (!L.sub) continue; S.changes[o.id][L.pol.id] = { ...(nowOf(o, L.pol) || {}), ...(S.changes[o.id][L.pol.id] || {}), [L.sub.id]: L.v }; } } S.pending = []; S.year++; draw(); };
  $("reset").onclick = () => { Object.assign(S, { lines: {}, edit: null, sel: null, changes: {}, pending: [], bills: [], seq: 0, year: P.year, open: null }); draw(); };
}

fetch("data/policies.json?v=20261125a").then((r) => r.json()).then((j) => {
  P = j; for (const g of P.govs) GOV[g.id] = g; for (const p of P.policies) POL[p.id] = p; P.issues.forEach((i, k) => (ISSUE_AT[i.id] = k));
  if (!S.year) S.year = P.year; draw();
});
