/* Election toolbox: pits made-up candidates against each other on the game's pops, with every weight adjustable. Nothing here is saved to the seed.
   A pop's party members (and its independents) keep a ledger of points for each candidate; the gap between ledgers decides how their votes split.
   Data comes from build/toolbox.py (docs/data/toolbox.json and toolbox.bin) and docs/data/traits.json. */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (v) => (v * 100).toFixed(1) + "%";
const signed = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1);

const WEIGHTS = [
  ["steep", "Lead that takes two votes in three", 5, 0.5], ["party", "Their party", 20, 1], ["issues", "Issues, standing exactly with them", 10, 1],
  ["reach", "Distance where an issue turns against", 40, 5], ["closest", "Closest on an issue", 0.25, 0.05], ["furthest", "Furthest on an issue", 0.25, 0.05],
  ["camp", "Same camp", 3, 0.5], ["partner", "Partner camp", 1, 0.5], ["traits", "Traits, multiplied by", 1, 0.25], ["name", "Name ID, fully known", 4, 0.5],
  ["incumbent", "Incumbent", 2, 0.5], ["home", "Home county", 1, 0.5], ["luck", "Luck", 1, 0.25], ["general", "General turnout, multiplied by", 1, 0.05], ["primary", "Primary turnout, multiplied by", 0.35, 0.05]];
const OFFICES = [["Governor", "state", 1], ["US Senate", "state", 2], ["US House", "congress", 2], ["State Senate", "senate", 1], ["State House", "house", 1],
  ["County office", "county", 0], ["County commission", "district", 0], ["City office", "muni", 0]];
const KINDS = [["dem", "Democratic primary"], ["rep", "Republican primary"], ["general", "General election"]];
const PARTY = { dem: ["Democrat", "#2f558e"], rep: ["Republican", "#a95450"], ind: ["Independent", "#8a8f94"] };
const SLICES = ["dem", "ind", "rep"], SLICE_NAME = { dem: "Democrats", ind: "Independents", rep: "Republicans" };
const SPARE = ["#d46c1e", "#555555", "#c9a227", "#1b9e9e", "#b0527a", "#7b3fa0", "#3a78c9", "#8a1f22", "#2e8b4f", "#9a9a9a", "#6b4f2a", "#0b7a75"];
const AUDIENCE = { no_college: ["education", [0]], college: ["education", [2]], low_income: ["income", [0]], high_income: ["income", [3]], rural: ["area", [2, 4]], small_town: ["area", [3]],
  urban: ["area", [0]], suburban: ["area", [1]], young: ["age", [0]], old: ["age", [3]], farm: ["work", [6]], blue_collar: ["work", [3, 4, 7]], service: ["work", [2]], government: ["work", [5]] };
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/* map layers: what a neighbourhood belongs to in each, as that layer's feature id in the tiles */
const LAYERS = [["county", "Counties", (h) => T.counties[h[1]][0], (h) => T.counties[h[1]][1]], ["district", "Commission districts", (h) => (h[2] ? T.counties[h[1]][2] + "-D" + h[2] : null), (h) => `${T.counties[h[1]][1]}, District ${h[2]}`],
  ["muni", "Municipal", (h) => (h[6] < 0 ? null : T.munis[h[6]][0]), (h) => T.munis[h[6]][1]], ["hood", "Neighbourhoods", (h) => h[0], (h) => h[0]],
  ["house", "State House", (h) => h[3] || null, (h) => "State House District " + h[3]], ["senate", "State Senate", (h) => h[4] || null, (h) => "State Senate District " + h[4]], ["congress", "Congress", (h) => h[5] || null, (h) => "Congressional District " + h[5]]];
const layer = () => LAYERS.find((l) => l[0] === S.layer);
let T, BOOK, COL = {}, REST, N, NI, map, mapReady = false, LAST = null, PICK = null;
const S = { kind: "dem", office: 0, place: "", closed: true, w: {}, cands: [], show: "win", layer: "county", lines: ["county"], tab: "result", many: null };
for (const [k, , v] of WEIGHTS) S.w[k] = v;
try { const saved = JSON.parse(localStorage.getItem("ttcb-toolbox") || "null"); if (saved) { Object.assign(S.w, saved.w || {}); if (typeof saved.closed === "boolean") S.closed = saved.closed; } } catch (e) { /* storage is a convenience only */ }
const keep = () => { try { localStorage.setItem("ttcb-toolbox", JSON.stringify({ w: S.w, closed: S.closed })); } catch (e) { /* ignore */ } };

/* ---------- the race ---------- */
function places(kind) {
  if (kind === "state") return [["", "Florida"]];
  if (kind === "county") return T.counties.map((c, i) => [String(i), c[1]]);
  if (kind === "muni") return T.munis.map((m, i) => [String(i), `${m[1]} (${T.counties[m[2]][1].replace(" County", "")})`]).sort((a, b) => a[1].localeCompare(b[1]));
  if (kind === "district") { const seen = new Set(), out = []; for (const h of T.hoods) { const key = h[1] + "-" + h[2]; if (h[2] && !seen.has(key)) { seen.add(key); out.push([key, `${T.counties[h[1]][1]}, District ${h[2]}`, h[1], h[2]]); } }
    return out.sort((a, b) => a[2] - b[2] || a[3] - b[3]); }
  const at = { house: 3, senate: 4, congress: 5 }[kind], nums = [...new Set(T.hoods.map((h) => h[at]).filter(Boolean))].sort((a, b) => a - b);
  return nums.map((n) => [String(n), "District " + n]);
}
function inPlace(kind, id) {   // which neighbourhoods are in the race
  if (kind === "state") return () => true;
  if (kind === "county") return (h) => h[1] === +id;
  if (kind === "muni") return (h) => h[6] === +id;
  if (kind === "district") { const [c, d] = id.split("-").map(Number); return (h) => h[1] === c && h[2] === d; }
  const at = { house: 3, senate: 4, congress: 5 }[kind]; return (h) => h[at] === +id;
}
const stopsOf = (camp) => (camp ? camp.stops.slice() : null);
function blank(party, camp) {
  const c = T.camps.find((x) => x.id === camp);
  return { name: "", party, camp: camp || "", stops: stopsOf(c) || T.usual[party].slice(), traits: [], known: 50, incumbent: false, home: "", extra: 0 };
}
function slate() {   // one candidate per camp for a primary; one plain candidate per party for a general
  S.cands = S.kind === "general" ? [blank("dem"), blank("rep")] : T.camps.filter((c) => c.party === S.kind).map((c) => blank(S.kind, c.id));
}
function label(c, i) {   // a typed name, else the camp or party if no other candidate shares it, else a letter
  if (c.name) return c.name;
  const camp = T.camps.find((x) => x.id === c.camp), own = S.kind === "general" ? PARTY[c.party][0] : camp ? camp.name : "";
  return own && S.cands.filter((x) => !x.name && (S.kind === "general" ? x.party === c.party : x.camp === c.camp)).length === 1 ? own : "Candidate " + LETTERS[i];
}
function colours() {
  const used = new Set(); let spare = 0;
  return S.cands.map((c) => { const camp = T.camps.find((x) => x.id === c.camp); let col = S.kind === "general" ? PARTY[c.party][1] : camp ? camp.colour : "";
    while (!col || used.has(col)) col = SPARE[spare++ % SPARE.length] + (spare > SPARE.length ? "cc" : ""); used.add(col); return col; });
}

/* ---------- the ledger ---------- */
function setup() {
  const [, kind, level] = OFFICES[S.office], test = inPlace(kind, S.place), general = S.kind === "general";
  const hoodIn = T.hoods.map(test), active = [], w = [];
  T.issues.forEach((x, k) => { if (x.weights[level] > 0) { active.push(k); w.push(x.weights[level]); } });
  const sumW = w.reduce((a, b) => a + b, 0) || 1;
  const slices = general ? SLICES : S.closed ? [S.kind] : [S.kind, "ind"];
  const pull = { dem: active.map((k) => T.issues[k].dem), rep: active.map((k) => T.issues[k].rep), ind: active.map(() => 0) };
  const anyIncumbent = S.cands.some((c) => c.incumbent);
  const cands = S.cands.map((c) => {
    const camp = T.camps.find((x) => x.id === c.camp), by = { education: [0, 0, 0], income: [0, 0, 0, 0], area: [0, 0, 0, 0, 0], age: [0, 0, 0, 0], work: new Array(10).fill(0) };
    let flat = 0, base = 0, ind = 0; const per = [];   // per: each trait's own table, kept for the ledger
    for (const t of c.traits) { const likes = BOOK.likes[t] || {}, row = { name: BOOK.traits[t], flat: 0, base: 0, ind: 0, by: { education: [0, 0, 0], income: [0, 0, 0, 0], area: [0, 0, 0, 0, 0], age: [0, 0, 0, 0], work: new Array(10).fill(0) } };
      for (const [aud, v0] of Object.entries(likes)) { const v = v0 * S.w.traits;
        if (aud === "everyone") row.flat += v; else if (aud === "base") row.base += v; else if (aud === "independents") row.ind += v;
        else if (aud === "against_incumbent") { if (anyIncumbent && !c.incumbent) row.flat += v; }
        else if (AUDIENCE[aud]) for (const i of AUDIENCE[aud][1]) row.by[AUDIENCE[aud][0]][i] += v; }
      flat += row.flat; base += row.base; ind += row.ind; for (const key in by) row.by[key].forEach((v, i) => { by[key][i] += v; }); per.push(row); }
    return { ...c, campRec: camp, pos: active.map((k) => T.issues[k].stops[c.stops[k]][0]), flat, base, ind, by, per, fixed: S.w.name * c.known / 100 + (c.incumbent ? S.w.incumbent : 0) + (+c.extra || 0), homeAt: c.home === "" ? -1 : +c.home };
  });
  const plain = general ? ["dem", "rep"].map((p) => active.map((k) => T.issues[k].stops[T.usual[p][k]][0])) : null;
  return { kind, level, general, hoodIn, active, w, sumW, slices, pull, cands, plain, K: Math.log(2) / Math.max(0.1, S.w.steep), turnout: general ? S.w.general : S.w.primary };
}
/* Points on the issues for each candidate with one set of voters. v: the voters' numbers on the active issues. Fills out[j]; cat, if given, gets each policy area's net. */
function issuePoints(R, v, pos, out, cat) {
  const n = pos.length, reach = Math.max(1, S.w.reach); out.fill(0);
  for (let a = 0; a < R.active.length; a++) {
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < n; j++) { const d = Math.abs(v[a] - pos[j][a]); DIST[j] = d; if (d < lo) lo = d; if (d > hi) hi = d; }
    for (let j = 0; j < n; j++) { let u = Math.max(-2, (reach - DIST[j]) / reach); if (hi > lo) { if (DIST[j] === lo) u += S.w.closest; if (DIST[j] === hi) u -= S.w.furthest; }
      const pts = S.w.issues * R.w[a] * u / R.sumW; out[j] += pts; if (cat) { const name = T.issues[R.active[a]].category; (cat[j][name] = cat[j][name] || [0])[0] += pts; } }
  }
}
const DIST = new Float64Array(32), VBUF = new Float64Array(64), PBUF = new Float64Array(2);
function voters(R, i, slice) { const p = R.pull[slice]; for (let a = 0; a < R.active.length; a++) VBUF[a] = Math.max(-100, Math.min(100, REST[i * NI + R.active[a]] + p[a])); return VBUF; }
const pie = (i, s) => (s === "dem" ? COL.dem[i] : s === "rep" ? COL.rep[i] : 1000 - COL.dem[i] - COL.rep[i]) / 1000;
/* The local lean: points toward the Republican that make two plain candidates give the pop its real vote. */
function lean(R, i) {
  const gap = [];
  for (const s of SLICES) { issuePoints(R, voters(R, i, s), R.plain, PBUF); gap.push(PBUF[1] - PBUF[0] + (s === "rep" ? S.w.party : s === "dem" ? -S.w.party : 0)); }
  const want = Math.max(0.01, Math.min(0.99, COL.vote[i] / 1000)), share = [pie(i, "dem"), pie(i, "ind"), pie(i, "rep")];
  let lo = -60, hi = 60;
  for (let n = 0; n < 24; n++) { const b = (lo + hi) / 2; let got = 0; for (let s = 0; s < 3; s++) got += share[s] / (1 + Math.exp(-R.K * (gap[s] + b))); if (got < want) lo = b; else hi = b; }
  return (lo + hi) / 2;
}
/* One set of voters' points for every candidate. lines, if given, collects the ledger. */
function points(R, i, slice, b, out, lines) {
  const n = R.cands.length, cat = lines ? R.cands.map(() => ({})) : null, mine = slice === "dem" ? COL.camp_dem[i] : slice === "rep" ? COL.camp_rep[i] : -1, camp = mine < 0 ? null : T.camps[mine];
  issuePoints(R, voters(R, i, slice), R.cands.map((c) => c.pos), out, cat);
  const county = T.hoods[COL.hood[i]][1];
  for (let j = 0; j < n; j++) { const c = R.cands[j], add = (name, v) => { if (v) { out[j] += v; if (lines) lines[j].push([name, v]); } };
    if (lines) { lines[j] = []; for (const [name, v] of Object.entries(cat[j])) if (Math.abs(v[0]) >= 0.05) lines[j].push([name, v[0]]); }
    if (R.general) { add("Their party", c.party === slice && slice !== "ind" ? S.w.party : 0); add("Local lean", c.party === "rep" ? b / 2 : c.party === "dem" ? -b / 2 : 0); }
    if (camp && c.campRec && c.party === slice) add(c.campRec === camp ? "Same camp" : "Partner camp", c.campRec === camp ? S.w.camp : c.campRec.folds === camp.id || camp.folds === c.campRec.id ? S.w.partner : 0);
    if (lines) for (const t of c.per) add(t.name, t.flat + (c.party === slice ? t.base : 0) + (slice === "ind" ? t.ind : 0) + t.by.education[COL.education[i]] + t.by.income[COL.income[i]] + t.by.area[COL.area[i]] + t.by.age[COL.age[i]] + t.by.work[COL.work[i]]);
    else out[j] += c.flat + (c.party === slice ? c.base : 0) + (slice === "ind" ? c.ind : 0) + c.by.education[COL.education[i]] + c.by.income[COL.income[i]] + c.by.area[COL.area[i]] + c.by.age[COL.age[i]] + c.by.work[COL.work[i]];
    if (lines) { add("Name ID", S.w.name * c.known / 100); add("Incumbent", c.incumbent ? S.w.incumbent : 0); add("Other", +c.extra || 0); } else out[j] += c.fixed;
    add("Home county", c.homeAt === county ? S.w.home : 0);
  }
}
/* Every set of voters in the race, with its points for each candidate before luck. */
function build() {
  const R = setup(), n = R.cands.length, rows = [], who = [], weight = [], out = new Float64Array(n), lean_ = {};
  for (let i = 0; i < N; i++) { if (!R.hoodIn[COL.hood[i]]) continue;
    const b = R.general ? lean(R, i) : 0; if (R.general) lean_[i] = b;
    for (let s = 0; s < R.slices.length; s++) { const slice = R.slices[s], people = 100 * pie(i, slice) * Math.min(1, COL.turnout[i] / 1000 * R.turnout); if (people <= 0) continue;
      points(R, i, slice, b, out); for (let j = 0; j < n; j++) rows.push(out[j]); who.push(i, SLICES.indexOf(slice)); weight.push(people); } }
  return { R, n, rows: Float32Array.from(rows), who: Int32Array.from(who), weight: Float32Array.from(weight), lean: lean_ };
}
const GROUPS = [["Party", (i, s) => s, () => SLICES.map((s) => SLICE_NAME[s])], ["Camp", (i, s) => (s === 0 ? COL.camp_dem[i] : s === 2 ? COL.camp_rep[i] : -1), () => T.camps.map((c) => c.name)],
  ...["race", "age", "education", "income", "area"].map((key) => [key[0].toUpperCase() + key.slice(1), (i) => COL[key][i], () => T.lists[key]])];
function gauss() { let u = 0; while (!u) u = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()); }
/* Counts the votes. full: also by neighbourhood and by group. */
function tally(B, luck, full) {
  const { R, n, rows, who, weight } = B, total = new Float64Array(n), e = new Float64Array(n);
  const hood = full ? new Map() : null, groups = full ? GROUPS.map(([, , names]) => names().map(() => new Float64Array(n))) : null;
  for (let r = 0; r < weight.length; r++) { let sum = 0, top = -Infinity;
    for (let j = 0; j < n; j++) { const v = rows[r * n + j] + luck[j]; if (v > top) top = v; e[j] = v; }
    for (let j = 0; j < n; j++) { e[j] = Math.exp(R.K * (e[j] - top)); sum += e[j]; }
    const i = who[r * 2], s = who[r * 2 + 1], w = weight[r] / sum;
    for (let j = 0; j < n; j++) total[j] += e[j] * w;
    if (full) { const h = COL.hood[i]; let row = hood.get(h); if (!row) hood.set(h, row = new Float64Array(n)); for (let j = 0; j < n; j++) row[j] += e[j] * w;
      for (let g = 0; g < GROUPS.length; g++) { const at = GROUPS[g][1](i, s); if (at >= 0) { const to = groups[g][at]; for (let j = 0; j < n; j++) to[j] += e[j] * w; } } } }
  return { total, hood, groups };
}

/* ---------- drawing ---------- */
const order = (row) => [...row.keys()].sort((a, b) => row[b] - row[a]);
const mix = (hex, t) => { const c = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)); return "#" + c.map((v) => Math.round(255 + (v - 255) * t).toString(16).padStart(2, "0")).join(""); };
function run(reroll) {
  if (!T || S.cands.length < 1) return;
  const B = build(), roll = !reroll && LAST && LAST.roll.length === S.cands.length ? LAST.roll : S.cands.map(gauss);   // changing a weight keeps the same roll; Run draws a new one
  const luck = roll.map((v) => v * S.w.luck);
  LAST = { B, roll, luck, res: tally(B, luck, true), cols: colours() };
  S.many = null; paint(); results();
}
function units() {   // the result added up into the chosen layer's units
  const key = layer()[2], out = new Map();
  for (const [h, row] of LAST.res.hood) { const id = key(T.hoods[h]); if (id === null) continue; let to = out.get(id); if (!to) out.set(id, to = new Float64Array(row.length)); for (let j = 0; j < row.length; j++) to[j] += row[j]; }
  return out;
}
function paint() {
  if (!mapReady || !LAST) return;
  const { cols, B } = LAST;
  for (const [k] of LAYERS) { map.removeFeatureState({ source: "fl", sourceLayer: k }); map.setLayoutProperty("fill-" + k, "visibility", k === S.layer ? "visible" : "none"); map.setLayoutProperty("line-" + k, "visibility", S.lines.includes(k) ? "visible" : "none"); }
  for (const [id, row] of units()) { const sum = row.reduce((a, b) => a + b, 0); if (!sum) continue; let c;
    if (S.show === "win") { const o = order(row); c = mix(cols[o[0]], 0.25 + 0.75 * Math.min(1, (row[o[0]] - (row[o[1]] || 0)) / sum / 0.3)); }
    else c = mix(cols[+S.show], Math.min(1, row[+S.show] / sum / (B.n > 2 ? 0.6 : 0.9)));
    map.setFeatureState({ source: "fl", sourceLayer: S.layer, id }, { c }); }
  const far = ["house", "senate", "congress"].includes(S.layer), id = PICK ? layer()[2](T.hoods[PICK.hood]) : null;
  map.setLayoutProperty("picked", "visibility", id === null ? "none" : "visible");
  if (id !== null) { map.removeLayer("picked"); map.addLayer({ id: "picked", type: "line", source: "fl", "source-layer": S.layer, filter: ["==", ["get", far ? "n" : "id"], id], paint: { "line-color": "#202122", "line-width": 2.5 } }); }
  $("legend").innerHTML = S.cands.map((c, j) => `<div><i style="background:${cols[j]}"></i>${esc(label(c, j))}</div>`).join("");
  document.querySelectorAll("#linebar .btn").forEach((b) => b.setAttribute("aria-pressed", S.lines.includes(b.dataset.line)));
}
function fit() {
  if (!mapReady) return; const test = inPlace(OFFICES[S.office][1], S.place), seen = new Set(); let b = null;
  for (const h of T.hoods) if (test(h) && !seen.has(h[1])) { seen.add(h[1]); const c = T.counties[h[1]][3]; b = b ? [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[2]), Math.max(b[3], c[3])] : c.slice(); }
  if (b) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 30, duration: 0 });
}
const bar = (v, col) => `<span class="tr"><span class="fl" style="width:${Math.round(v * 100)}%;background:${col}"></span></span>`;
function results() {
  if (!LAST) return; const { res, cols } = LAST, sum = res.total.reduce((a, b) => a + b, 0) || 1, o = order(res.total);
  document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === S.tab));
  let h = "";
  if (S.tab === "result") {
    h = `<table class="wt res"><tr><th>Candidate</th><th>Votes</th><th colspan="2">Share</th>${S.many ? "<th>Wins</th><th>Low</th><th>High</th>" : ""}</tr>${o.map((j) => `<tr${j === o[0] ? ' class="won"' : ""}><td><i class="sw" style="background:${cols[j]}"></i>${esc(label(S.cands[j], j))}<div class="pt">${esc(sub(S.cands[j], j))}</div></td>
      <td class="n">${Math.round(res.total[j]).toLocaleString()}</td><td class="n">${pct(res.total[j] / sum)}</td><td class="bar">${bar(res.total[j] / sum, cols[j])}</td>
      ${S.many ? `<td class="n">${pct(S.many.wins[j] / S.many.runs)}</td><td class="n">${pct(S.many.low[j])}</td><td class="n">${pct(S.many.high[j])}</td>` : ""}</tr>`).join("")}</table>
      <div class="foot">${Math.round(sum).toLocaleString()} votes${S.many ? ` · ${S.many.runs} runs` : ""}</div>`;
  } else if (S.tab === "groups") {
    h = GROUPS.map(([title, , names], g) => { const rows = names().map((name, at) => [name, res.groups[g][at]]).filter(([, row]) => row.reduce((a, b) => a + b, 0) > 0.5);
      return rows.length ? `<table class="wt grp"><tr><th>${title}</th>${S.cands.map((c, j) => `<th class="n" style="box-shadow:inset 0 -3px 0 ${cols[j]}">${esc(label(c, j))}</th>`).join("")}<th class="n">Votes</th></tr>
        ${rows.map(([name, row]) => { const t = row.reduce((a, b) => a + b, 0), top = order(row)[0]; return `<tr><td>${esc(name)}</td>${[...row].map((v, j) => `<td class="n${j === top ? " top" : ""}">${pct(v / t)}</td>`).join("")}<td class="n">${Math.round(t).toLocaleString()}</td></tr>`; }).join("")}</table>` : ""; }).join("");
  } else h = ledger();
  $("out").innerHTML = h;
}
const sub = (c, j) => [S.kind === "general" ? PARTY[c.party][0] : "", (T.camps.find((x) => x.id === c.camp) || {}).name || "", ...c.traits.map((t) => BOOK.traits[t])].filter((x) => x && x !== label(c, j)).join(" · ");
const describe = (i) => ["race", "age", "education", "income", "area", "work"].map((k) => T.lists[k][COL[k][i]]).join(" · ");
function ledger() {
  if (!PICK) return `<div class="foot">Pick a neighbourhood on the map</div>`;
  const { B, luck, res, cols } = LAST, R = B.R, hood = T.hoods[PICK.hood], row = res.hood.get(PICK.hood), pops = [];
  for (let i = 0; i < N; i++) if (COL.hood[i] === PICK.hood) pops.push(i);
  if (!row) return `<div class="foot">${esc(hood[0])} is outside this race</div>`;
  if (!pops.includes(PICK.pop)) PICK.pop = pops[0];
  const sum = row.reduce((a, b) => a + b, 0) || 1, i = PICK.pop, n = B.n;
  let h = "";
  if (S.layer !== "hood" && layer()[2](hood) !== null) { const urow = units().get(layer()[2](hood)), us = urow.reduce((a, b) => a + b, 0) || 1;
    h += `<h3>${esc(layer()[3](hood))}</h3><div class="mb">${order(urow).map((j) => `<div class="mbar"><span>${esc(label(S.cands[j], j))}</span>${bar(urow[j] / us, cols[j])}<span class="v">${pct(urow[j] / us)}</span></div>`).join("")}</div>`; }
  h += `<h3>${esc(hood[0])} · ${esc(T.counties[hood[1]][1])}</h3><div class="mb">${order(row).map((j) => `<div class="mbar"><span>${esc(label(S.cands[j], j))}</span>${bar(row[j] / sum, cols[j])}<span class="v">${pct(row[j] / sum)}</span></div>`).join("")}</div>
    <select id="poppick" aria-label="Pop">${pops.map((p, k) => `<option value="${p}"${p === i ? " selected" : ""}>Pop ${k + 1} · ${esc(describe(p))}</option>`).join("")}</select>`;
  for (const slice of R.slices) { const share = pie(i, slice); if (share <= 0) continue;
    const out = new Float64Array(n), lines = []; points(R, i, slice, B.lean[i] || 0, out, lines);
    const cats = [...new Set(T.issues.map((x) => x.category))], seen = []; lines.forEach((l) => l.forEach(([name]) => { if (!seen.includes(name)) seen.push(name); }));
    const names = [...cats.filter((c) => seen.includes(c)), ...seen.filter((c) => !cats.includes(c))];
    if (luck.some(Boolean)) names.push("Luck");
    const total = [...out].map((v, j) => v + luck[j]), top = Math.max(...total), e = total.map((v) => Math.exp(R.K * (v - top))), es = e.reduce((a, b) => a + b, 0);
    const mine = slice === "dem" ? COL.camp_dem[i] : slice === "rep" ? COL.camp_rep[i] : -1;
    h += `<table class="wt led"><tr><th>${SLICE_NAME[slice]} · ${pct(share)}${mine >= 0 ? `<div class="pt">${esc(T.camps[mine].name)}</div>` : ""}</th>${S.cands.map((c, j) => `<th class="n" style="box-shadow:inset 0 -3px 0 ${cols[j]}">${esc(label(c, j))}</th>`).join("")}</tr>
      ${names.map((name) => `<tr><td>${esc(name)}</td>${S.cands.map((c, j) => { const v = name === "Luck" ? luck[j] : (lines[j].find((l) => l[0] === name) || [0, 0])[1]; return `<td class="n ${v > 0.049 ? "pos" : v < -0.049 ? "neg" : "nil"}">${Math.abs(v) < 0.05 ? "" : signed(v)}</td>`; }).join("")}</tr>`).join("")}
      <tr class="sum"><td>Total</td>${total.map((v) => `<td class="n">${signed(v)}</td>`).join("")}</tr><tr class="sum"><td>Vote</td>${e.map((v) => `<td class="n">${pct(v / es)}</td>`).join("")}</tr></table>`; }
  return h;
}
function many() {
  if (!LAST) return; const B = LAST.B, n = B.n, runs = 200, m = { runs: 0, wins: new Array(n).fill(0), low: new Array(n).fill(1), high: new Array(n).fill(0) };
  $("many").disabled = true;
  const step = () => { for (let k = 0; k < 10 && m.runs < runs; k++, m.runs++) { const t = tally(B, S.cands.map(() => gauss() * S.w.luck), false).total, sum = t.reduce((a, b) => a + b, 0) || 1;
      m.wins[order(t)[0]]++; for (let j = 0; j < n; j++) { m.low[j] = Math.min(m.low[j], t[j] / sum); m.high[j] = Math.max(m.high[j], t[j] / sum); } }
    S.many = m; if (S.tab === "result") results();
    if (m.runs < runs) setTimeout(step, 0); else $("many").disabled = false; };
  step();
}

/* ---------- menus ---------- */
let timer;
const soon = () => { clearTimeout(timer); timer = setTimeout(() => run(false), 150); };
function raceMenu() {
  $("kind").innerHTML = KINDS.map(([k, name]) => `<option value="${k}"${k === S.kind ? " selected" : ""}>${name}</option>`).join("");
  $("office").innerHTML = OFFICES.map(([name], i) => `<option value="${i}"${i === S.office ? " selected" : ""}>${name}</option>`).join("");
  const list = places(OFFICES[S.office][1]); if (!list.some((p) => p[0] === S.place)) S.place = list[0][0];
  $("place").innerHTML = list.map(([id, name]) => `<option value="${esc(id)}"${id === S.place ? " selected" : ""}>${esc(name)}</option>`).join(""); $("place").disabled = list.length < 2;
  $("closed").value = S.closed ? "1" : "0"; $("closed").disabled = S.kind === "general";
}
function candMenu() {
  const cols = colours(), level = OFFICES[S.office][2], traits = Object.keys(BOOK.likes).sort((a, b) => BOOK.traits[a].localeCompare(BOOK.traits[b]));
  const cats = [...new Set(T.issues.map((x) => x.category))];
  $("cands").innerHTML = S.cands.map((c, j) => { const camps = T.camps.filter((x) => x.party === c.party);
    return `<div class="cand" data-j="${j}" style="border-left-color:${cols[j]}"><div class="row"><input data-f="name" value="${esc(c.name)}" placeholder="${esc(label({ ...c, name: "" }, j))}" aria-label="Name"><button class="btn x" data-act="drop" aria-label="Remove">×</button></div>
      <div class="row">${S.kind === "general" ? `<select data-f="party" aria-label="Party">${Object.entries(PARTY).map(([k, v]) => `<option value="${k}"${k === c.party ? " selected" : ""}>${v[0]}</option>`).join("")}</select>` : ""}
        <select data-f="camp" aria-label="Camp"${camps.length ? "" : " disabled"}><option value="">No camp</option>${camps.map((x) => `<option value="${x.id}"${x.id === c.camp ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>
      <div class="chips">${c.traits.map((t) => `<button class="trait" data-act="untrait" data-t="${t}">${esc(BOOK.traits[t])} ×</button>`).join("")}<select data-f="trait" aria-label="Add trait"><option value="">Trait</option>${traits.filter((t) => !c.traits.includes(t)).map((t) => `<option value="${t}">${esc(BOOK.traits[t])}</option>`).join("")}</select></div>
      <label class="sl"><span>Name ID</span><input type="range" min="0" max="100" step="5" data-f="known" value="${c.known}"><output>${c.known}</output></label>
      <div class="row"><label class="ck"><input type="checkbox" data-f="incumbent"${c.incumbent ? " checked" : ""}>Incumbent</label><label class="ex">Other <input type="number" step="0.5" data-f="extra" value="${c.extra}"></label></div>
      <select data-f="home" aria-label="Home county"><option value="">Home county</option>${T.counties.map((x, i) => `<option value="${i}"${String(i) === c.home ? " selected" : ""}>${esc(x[1])}</option>`).join("")}</select>
      <details${c.open ? " open" : ""}><summary>Positions</summary>${cats.map((cat) => `<div class="cat">${esc(cat)}</div>${T.issues.map((x, k) => (x.category !== cat ? "" : `<label class="iss${x.weights[level] ? "" : " off"}"><span>${esc(x.name)}</span><select data-k="${k}">${x.stops.map((s, n) => `<option value="${n}"${n === c.stops[k] ? " selected" : ""}>${esc(s[1])}</option>`).join("")}</select></label>`)).join("")}`).join("")}</details></div>`; }).join("");
}
function weightMenu() {
  $("weights").innerHTML = WEIGHTS.map(([k, name, , step]) => `<label class="wrow"><span>${name}</span><input type="number" step="${step}" data-w="${k}" value="${S.w[k]}"></label>`).join("");
}
function wire() {
  $("kind").onchange = (e) => { S.kind = e.target.value; slate(); raceMenu(); candMenu(); run(false); };
  $("office").onchange = (e) => { S.office = +e.target.value; S.place = ""; raceMenu(); candMenu(); fit(); PICK = null; run(false); };
  $("place").onchange = (e) => { S.place = e.target.value; fit(); PICK = null; run(false); };
  $("closed").onchange = (e) => { S.closed = e.target.value === "1"; keep(); run(false); };
  $("add").onclick = () => { S.cands.push(blank(S.kind === "general" ? "ind" : S.kind)); candMenu(); run(false); };
  $("slate").onclick = () => { slate(); candMenu(); run(false); };
  $("run").onclick = () => run(true);
  $("many").onclick = many;
  $("reset").onclick = () => { for (const [k, , v] of WEIGHTS) S.w[k] = v; keep(); weightMenu(); run(false); };
  $("show").onchange = (e) => { S.show = e.target.value; paint(); };
  $("layer").innerHTML = LAYERS.map(([k, name]) => `<option value="${k}"${k === S.layer ? " selected" : ""}>${name}</option>`).join("");
  $("layer").onchange = (e) => { S.layer = e.target.value; paint(); if (S.tab === "ledger") results(); };
  $("linebar").innerHTML = LAYERS.map(([k, name]) => `<button class="btn" data-line="${k}">${name}</button>`).join("");
  $("linebar").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; const k = b.dataset.line; S.lines = S.lines.includes(k) ? S.lines.filter((x) => x !== k) : [...S.lines, k]; paint(); };
  $("tabs").onclick = (e) => { const b = e.target.closest("button"); if (b) { S.tab = b.dataset.tab; results(); } };
  $("weights").oninput = (e) => { const k = e.target.dataset.w, v = parseFloat(e.target.value); if (k && isFinite(v)) { S.w[k] = v; keep(); soon(); } };
  $("out").onchange = (e) => { if (e.target.id === "poppick") { PICK.pop = +e.target.value; results(); } };
  const cands = $("cands");
  cands.onclick = (e) => { const b = e.target.closest("[data-act]"); if (!b) return; const j = +b.closest(".cand").dataset.j;
    if (b.dataset.act === "drop") S.cands.splice(j, 1); else S.cands[j].traits = S.cands[j].traits.filter((t) => t !== b.dataset.t);
    candMenu(); showMenu(); run(false); };
  cands.addEventListener("toggle", (e) => { const card = e.target.closest(".cand"); if (card) S.cands[+card.dataset.j].open = e.target.open; }, true);
  cands.oninput = (e) => { const t = e.target, card = t.closest(".cand"); if (!card) return; const c = S.cands[+card.dataset.j], f = t.dataset.f;
    if (f === "known") { c.known = +t.value; t.nextElementSibling.textContent = t.value; soon(); } else if (f === "name") { c.name = t.value; soon(); showMenu(); } else if (f === "extra") { c.extra = parseFloat(t.value) || 0; soon(); } };
  cands.onchange = (e) => { const t = e.target, card = t.closest(".cand"); if (!card) return; const c = S.cands[+card.dataset.j], f = t.dataset.f;
    if (t.dataset.k) c.stops[+t.dataset.k] = +t.value;
    else if (f === "party") { c.party = t.value; c.camp = ""; c.stops = T.usual[c.party].slice(); candMenu(); }
    else if (f === "camp") { c.camp = t.value; const camp = T.camps.find((x) => x.id === c.camp); c.stops = stopsOf(camp) || T.usual[c.party].slice(); candMenu(); }
    else if (f === "trait") { if (t.value) c.traits.push(t.value); candMenu(); }
    else if (f === "incumbent") c.incumbent = t.checked; else if (f === "home") c.home = t.value; else return;
    run(false); };
}
function showMenu() { $("show").innerHTML = `<option value="win">Winner</option>` + S.cands.map((c, j) => `<option value="${j}"${String(j) === S.show ? " selected" : ""}>${esc(label(c, j))}</option>`).join(""); if (S.show !== "win" && +S.show >= S.cands.length) S.show = "win"; }
const run0 = run; run = function (reroll) { showMenu(); run0(reroll); };   // the Show menu follows the candidate list

/* ---------- start ---------- */
async function start() {
  const [t, book, bin] = await Promise.all([fetch("data/toolbox.json").then((r) => r.json()), fetch("data/traits.json").then((r) => r.json()), fetch("data/toolbox.bin").then((r) => r.arrayBuffer())]);
  T = t; BOOK = book; N = T.pops; NI = T.issues.length; let at = 0;
  for (const k of T.columns.wide) { COL[k] = new Uint16Array(bin, at, N); at += 2 * N; }
  for (const k of T.columns.small) { COL[k] = new Uint8Array(bin, at, N); at += N; }
  REST = new Int8Array(bin, at, N * NI);
  slate(); raceMenu(); candMenu(); weightMenu(); wire(); run(false);
  maplibregl.addProtocol("pmtiles", new pmtiles.Protocol().tile);
  map = new maplibregl.Map({ container: "map", style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#f3f1ea" } }] }, dragRotate: false, attributionControl: false, minZoom: 5, maxZoom: 15 });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
  new ResizeObserver(() => map.resize()).observe($("map"));
  map.on("load", () => {
    map.addSource("fl", { type: "vector", url: "pmtiles://" + new URL("tiles/game-fl.pmtiles", location.href).href, promoteId: { hood: "id", district: "id", muni: "id", county: "id", house: "n", senate: "n", congress: "n" } });
    const grow = (a, b) => ["interpolate", ["linear"], ["zoom"], 5, a, 11, b], thick = { county: [0.5, 1.8], district: [0.3, 1.2], muni: [0.3, 1.2], hood: [0.1, 0.6], house: [0.4, 1.5], senate: [0.5, 1.8], congress: [0.7, 2.2] };
    for (const [k] of LAYERS) map.addLayer({ id: "fill-" + k, type: "fill", source: "fl", "source-layer": k, layout: { visibility: "none" }, paint: { "fill-color": ["to-color", ["feature-state", "c"], "#e7e4da"], "fill-antialias": false } });
    for (const [k] of LAYERS) map.addLayer({ id: "line-" + k, type: "line", source: "fl", "source-layer": k, layout: { visibility: "none" }, paint: { "line-color": { hood: "#72777d", house: "#7a3fb0", senate: "#0b7a75", congress: "#b36b00" }[k] || "#202122", "line-opacity": 0.8, "line-width": grow(...thick[k]) } });
    map.addLayer({ id: "hit", type: "fill", source: "fl", "source-layer": "hood", paint: { "fill-opacity": 0 } });   // clicks always land on a neighbourhood, whatever layer is shown
    map.addLayer({ id: "picked", type: "line", source: "fl", "source-layer": "hood", filter: ["==", ["get", "id"], ""], paint: { "line-color": "#202122", "line-width": 2.5 } });
    map.on("click", "hit", (e) => { const id = e.features[0].id, h = T.hoods.findIndex((x) => x[0] === id); if (h < 0) return; PICK = { hood: h, pop: -1 }; S.tab = "ledger"; paint(); results(); });
    map.on("mousemove", "hit", () => { map.getCanvas().style.cursor = "pointer"; }); map.on("mouseleave", "hit", () => { map.getCanvas().style.cursor = ""; });
    mapReady = true; fit(); paint();
  });
}
start();
