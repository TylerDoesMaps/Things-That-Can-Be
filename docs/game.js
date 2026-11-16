/* The shell: the old interface running on the new data. Nothing here advances time or fires events yet.
   The map is drawn from tiles that cover the whole state. A county's places, pops and people load when it is first needed. */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (x) => (x === null || x === undefined ? "" : Math.round(x * 100) + "%");
const num = (n) => Number(n).toLocaleString("en-US");
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const get = (path) => fetch(path).then((r) => r.json());
/* Every colour and label tied to a party lives here and nowhere else. */
const PARTIES = { rep: { name: "Republican", letter: "R", colour: "#a95450", ramp: "r" }, ind: { name: "Independent", letter: "I", colour: "#8a8f94", ramp: "g" }, dem: { name: "Democrat", letter: "D", colour: "#2f558e", ramp: "d" } };
const ORDER = ["rep", "ind", "dem"];
const HOME = "12065", SEED = 1;
const LAYERS = [["county", "County"], ["district", "Commission districts"], ["muni", "Municipal"], ["hood", "Neighbourhoods"]];
const LINES = [["county", "Counties", "#202122"], ["district", "Commission districts", "#202122"], ["city", "Cities", "#202122"], ["hood", "Neighbourhoods", "#72777d"],
  ["house", "State House", "#7a3fb0"], ["senate", "State Senate", "#0b7a75"], ["congress", "Congress", "#b36b00"]];
const TABS = [["overview", "Overview"], ["people", "People"], ["party", "Party"], ["gov", "Officeholders"]];
const RACE_COL = { White: "#8c6bb1", Black: "#41ab5d", Hispanic: "#f16913", Asian: "#3690c0", Other: "#969696" };
const AREA_COL = { urban: "#54278f", suburban: "#9e9ac8", "small town": "#fdae6b", rural: "#a1d99b" };
const MOOD_COL = { Angry: "#b2182b", Dissatisfied: "#ef8a62", Neutral: "#bdbdbd", Content: "#7fbf7b", Happy: "#1b7837" };
const MOST = { hood: 50, district: 1500, muni: 3000, county: 20000 };
const SOON = {
  you: ["Character creation", 3], week: ["The week", 4], notebook: ["Notebook", 5], known: ["Who knows you", 5], orgs: ["Organizations", 6], issues: ["Issues and positions", 7],
  running: ["Running for office", 8], campaign: ["The campaign", 9], money: ["Money and fundraising", 11], election: ["Election day", 15], office: ["Holding office", 17],
  services: ["Government and services", 18], bills: ["Bills and votes", 19], news: ["News and the press", 22], intrigue: ["Intrigue and actions", 23], history: ["History and generation", 26], tools: ["Test tools", 0], saves: ["Saves", 0],
};
const SHADES = [
  { id: "party", label: "Party" },
  { id: "race", label: "Race", menu: [["race", "Largest group"], null, ["race_White", "% White"], ["race_Black", "% Black"], ["race_Hispanic", "% Hispanic"]] },
  { id: "issues", label: "Issues", menu: [["", "Issues and positions · update 7"]] },
  { id: "demo", label: "Demographics", menu: [["pops", "Pops"], ["area", "Area type"], ["ba", "% Bachelor's degree"], ["old", "% Age 65 and over"], ["income", "% Income under $35,000"]] },
  { id: "results", label: "Results", menu: [["r2024", "President, 2024"], null, ["real", "Real 2024"], ["local", "Local lean"]] },
];
const IDX = { counties: [], byFips: {}, byId: {}, byCode: {} };
const G = { state: "", places: {}, kinds: {} }, POPS = {}, S = { seed: SEED, people: {}, leaders: {}, moods: {}, seats: [], local: {} };
const lines = new Set(["county", "city"]), loading = {};
const VOTE = { places: {}, wide: [], local: {}, summary: null }, BOOK = { stats: {}, traits: {} };
let map, state = { layer: "hood", shade: "party", selected: null, tab: "overview", ptab: "overview", olevel: "local", county: HOME };

/* ---------- loading ---------- */
function ensure(fips) {
  if (!fips || !IDX.byFips[fips]) return Promise.resolve();
  return (loading[fips] ||= Promise.all([get(`data/game/fl-${fips}.json`), get(`data/pops/fl-${fips}.json`), get(`data/seeds/${SEED}/fl-${fips}.json`), get(`data/seeds/${SEED}/election-2024/fl-${fips}.json`).catch(() => ({ races: [] }))]).then(([g, p, s, v]) => {
    VOTE.local[fips] = v.races;
    Object.assign(G.places, g.places);
    for (const x of p.pops) { x.pie = [x.pie.R, x.pie.I, x.pie.D]; (POPS[x.hood] ||= []).push(x); }
    Object.assign(S.people, s.people); Object.assign(S.leaders, s.leaders); Object.assign(S.moods, s.moods);
    S.local[fips] = s.seats;
  }));
}
const fipsOfPlace = (id) => (IDX.byId[id] || IDX.byCode[String(id).split("-")[0].toUpperCase()] || {}).fips;
const fipsOfPerson = (id) => (IDX.byCode[String(id).split("-")[1]] || {}).fips;

/* ---------- small pieces ---------- */
const soon = (key) => `<div class="soon"><b>${esc(SOON[key][0])}</b>${SOON[key][1] ? "Update " + SOON[key][1] : "Later"}</div>`;
const place = (id) => G.places[id];
const popsIn = (q) => q.members.flatMap((m) => POPS[m] || []);
const who = (pid) => { const c = S.people[pid]; return c ? `<button class="who ${c.party}" data-pid="${pid}">${esc(c.name)}</button>` : ""; };
const placeLink = (id, label) => `<button class="lk" data-place="${esc(id)}">${esc(label || place(id).name)}</button>`;
const share = (counts, key) => (counts[key] || 0) / (Object.values(counts).reduce((a, b) => a + b, 0) || 1);
const mbar = (label, v, color) => `<div class="mbar"><span>${esc(label)}</span><span class="tr"><span class="fl" style="display:block;width:${Math.round(v * 100)}%;background:${color || "var(--g4)"}"></span></span><span class="v">${pct(v)}</span></div>`;
const pie = (p) => `<span class="pie">${ORDER.map((k, i) => `<i style="width:${p[i] * 100}%;background:${PARTIES[k].colour}"></i>`).join("")}</span>`;
const lead = (p) => { const o = ORDER.map((k, i) => [PARTIES[k], p[i]]).sort((a, b) => b[1] - a[1]); return `<b style="color:${o[0][0].colour}">${o[0][0].letter}+${Math.round((o[0][1] - o[1][1]) * 100)}</b>`; };
const partyBars = (p) => ORDER.map((k, i) => mbar(PARTIES[k].name, p[i], PARTIES[k].colour)).join("");
const mood = (pid, level) => { const m = (S.moods[pid] || {})[level]; return m ? `<span class="mood"><i style="background:${MOOD_COL[m]}"></i>${m}</span>` : ""; };
const result = (id) => { const v = VOTE.places[id]; return !v || v[0] === null ? "" : `<span style="color:${PARTIES.rep.colour}">R ${pct(v[0])}</span> · <span style="color:${PARTIES.dem.colour}">D ${pct(1 - v[0])}</span> <span class="pt">${num(v[1])} votes</span>`; };
const lean = (v) => (!v ? "None" : `<span style="color:${PARTIES[v > 0 ? "rep" : "dem"].colour}">${v > 0 ? "R" : "D"} +${Math.abs(v).toFixed(1)}</span>`);
const seatsOf = (pid) => S.seats.concat(...Object.values(S.local)).filter((s) => s.holder === pid);
const role = (pid) => {
  const seats = seatsOf(pid), c = S.people[pid];
  if (seats.length) return seats.map((s) => s.title + (s.label ? ", " + s.label : "")).join("; ");
  return c.pop ? "Speaks for a pop in " + c.home : "";
};
const countyPicker = (id, chosen) => `<select id="${id}" aria-label="County">${IDX.counties.map((c) => `<option value="${c.fips}"${c.fips === chosen ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select>`;

function covers(seat, q) {
  if (seat.area === "state" || seat.area === "country" || seat.area === q.id) return true;
  const first = place(q.members[0]) || {};
  if (seat.area.startsWith("circuit-")) return "circuit-" + first.circuit === seat.area;
  for (const [word, field] of [["house", "house"], ["senate", "senate"], ["cd", "congress"]]) if (seat.area.startsWith(word + "-")) return q.members.some((m) => word + "-" + place(m)[field] === seat.area);
  if (place(seat.area)) { const mine = new Set(q.members); return place(seat.area).members.some((m) => mine.has(m)); }
  return false;
}
const seatsOver = (q) => S.seats.concat(S.local[q.fips] || []).filter((s) => covers(s, q));

/* ---------- map ---------- */
const stops = (prefix, list) => list.flatMap(([at, i]) => [at, css(`--${prefix}${i}`)]);
const grey = (value, top) => ["interpolate", ["linear"], value, ...stops("g", [0, 1, 2, 3, 4, 5, 6].map((i) => [top * i / 6, i]))];
const diverge = (value, span) => ["interpolate", ["linear"], value, ...stops("d", [7, 5, 3, 1].map((i) => [-span * i / 7, i])), 0, css("--r0"), ...stops("r", [1, 3, 5, 7].map((i) => [span * i / 7, i]))];
const match = (field, table) => ["match", ["get", field], ...Object.entries(table).flat(), "#ffffff"];
function shadeOf(kind) {
  const s = state.shade, n = (k) => ["get", k];
  const margin = (a, b, c) => ["-", n(a), ["max", n(b), n(c)]];
  const by = (ramp, a, b, c, list) => ["interpolate", ["linear"], margin(a, b, c), ...stops(ramp, list)];
  const colour = s === "party" ? ["case", ["all", [">=", n("pr"), n("pi")], [">=", n("pr"), n("pd")]], by("r", "pr", "pi", "pd", [[0, 1], [0.1, 3], [0.25, 5], [0.45, 7]]),
    [">=", n("pd"), n("pi")], by("d", "pd", "pi", "pr", [[0, 1], [0.1, 3], [0.25, 5], [0.45, 7]]), by("g", "pi", "pr", "pd", [[0, 1], [0.1, 2], [0.25, 3], [0.45, 4]])]
    : s === "r2024" ? ["case", ["==", ["feature-state", "s24"], null], "#ffffff", diverge(["-", ["feature-state", "s24"], 0.5], 0.3)] : s === "real" ? diverge(["-", n("r24"), 0.5], 0.3) : s === "local" ? diverge(n("local"), 15) : s === "race" ? match("race", RACE_COL) : s === "area" ? match("area", AREA_COL)
    : s === "race_White" ? grey(n("rw"), 1) : s === "race_Black" ? grey(n("rb"), 1) : s === "race_Hispanic" ? grey(n("rh"), 1) : s === "pops" ? grey(n("pops"), MOST[kind])
    : s === "ba" ? grey(n("ba"), 0.5) : s === "old" ? grey(n("old"), 0.6) : grey(n("inc"), 0.7);
  return ["case", ["==", n("pops"), 0], "#ffffff", colour];
}
function legend() {
  const s = state.shade, bar = (cols, a, b) => `<div class="bar">${cols.map((c) => `<span style="background:${c}"></span>`).join("")}</div><div class="ends"><span>${a}</span><span>${b}</span></div>`;
  const dv = [7, 5, 3, 1].map((i) => css("--d" + i)).concat([1, 3, 5, 7].map((i) => css("--r" + i))), gr = [0, 1, 2, 3, 4, 5, 6].map((i) => css("--g" + i));
  const cat = (table) => `<div class="cat">${Object.entries(table).map(([k, c]) => `<span><i style="background:${c}"></i>${esc(k[0].toUpperCase() + k.slice(1))}</span>`).join("")}</div>`;
  const title = { party: "Party ID", r2024: "President, 2024", real: "Real 2024", local: "Local lean", race: "Largest group", area: "Area type", pops: "Pops", ba: "Bachelor's degree", old: "Age 65 and over", income: "Income under $35,000" }[s] || "Share " + s.slice(5);
  const party = () => ORDER.map((k) => `<div class="prow"><span>${PARTIES[k].letter}</span><div class="bar">${(k === "ind" ? [1, 2, 3, 4] : [1, 3, 5, 7]).map((i) => `<span style="background:${css("--" + PARTIES[k].ramp + i)}"></span>`).join("")}</div></div>`).join("") + `<div class="ends"><span>Narrow lead</span><span>Wide lead</span></div>`;
  const body = s === "party" ? party() : s === "r2024" || s === "real" || s === "local" ? bar(dv, "Democratic", "Republican") : s === "race" ? cat(RACE_COL) : s === "area" ? cat(AREA_COL) : bar(gr, "Fewer", "More");
  $("legend").innerHTML = `<div class="t">${title}</div>${body}`;
}
function paint() {
  if (!map || !map.getLayer("fill-hood")) return;
  for (const [kind] of LAYERS) {
    const on = kind === state.layer ? "visible" : "none";
    for (const part of ["fill-", "edge-", "picked-"]) map.setLayoutProperty(part + kind, "visibility", on);
    if (kind === state.layer) map.setPaintProperty("fill-" + kind, "fill-color", shadeOf(kind));
    map.setFilter("picked-" + kind, ["==", ["get", "id"], state.selected || ""]);
  }
  LINES.forEach(([k]) => map.setLayoutProperty("l-" + k, "visibility", lines.has(k) ? "visible" : "none"));
  document.querySelectorAll("#linebar .btn").forEach((b) => b.setAttribute("aria-pressed", lines.has(b.dataset.line)));
  document.querySelectorAll("#layerbar .btn").forEach((b) => b.setAttribute("aria-pressed", b.dataset.layer === state.layer));
  document.querySelectorAll("#shadebar > .btn, #shadebar .dd > .btn").forEach((b) => b.setAttribute("aria-pressed", b.dataset.group === (SHADES.find((x) => x.id === state.shade || (x.menu || []).some((m) => m && m[0] === state.shade)) || {}).id));
  legend();
}
function infobox() {
  const box = $("infobox"), q = state.selected && place(state.selected);
  if (!q) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<button class="ib-close" id="ib-close" aria-label="Close">×</button><button class="ib-title ib-open" data-place="${esc(q.id)}">${esc(q.name)}<span class="exp" aria-hidden="true">⤢</span></button><div class="ib-sub">${esc(q.sub)}</div>
    <div class="ib-tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" aria-selected="${state.tab === k}" data-tab="${k}">${l}</button>`).join("")}</div><div class="ib-body">${placeTab(q, state.tab, false)}</div>`;
  box.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { state.tab = b.dataset.tab; infobox(); });
  $("ib-close").onclick = () => { state.selected = null; paint(); infobox(); };
}
function placeTab(q, tab, wide) {
  const ps = popsIn(q);
  if (tab === "overview") {
    const inside = q.kind === "hood" ? `<tr><th>County</th><td>${placeLink(q.county)}</td></tr><tr><th>Commission district</th><td>${placeLink(q.code + "-D" + q.district, "District " + q.district)}</td></tr><tr><th>State House</th><td>District ${q.house}</td></tr><tr><th>State Senate</th><td>District ${q.senate}</td></tr><tr><th>Congress</th><td>District ${q.congress}</td></tr><tr><th>Local lean</th><td>${lean(q.local)}</td></tr>` : "";
    let h = `<table><tr><th>People</th><td>${num(q.pops * 100)} <span class="pt">(${num(q.pops)} pops)</span></td></tr><tr><th>Party ID</th><td>${lead(q.party)}</td></tr>
      <tr><th>President, 2024</th><td>${result(q.id)}</td></tr>
      <tr><th>Area type</th><td>${Object.entries(q.area).map(([k, v]) => `${k} (${num(v)})`).join(", ")}</td></tr>${inside}</table>
      <div class="ib-h">People by race</div>${Object.keys(RACE_COL).filter((r) => q.race[r]).map((r) => mbar(r, share(q.race, r), RACE_COL[r])).join("")}`;
    if (wide && q.kind !== "hood") {
      const mine = new Set(q.members), kids = q.kind === "county" ? ["district", "muni", "hood"] : ["hood"];
      for (const kind of kids) {
        const rows = Object.values(G.places).filter((x) => x.kind === kind && x.fips === q.fips && x.members.every((m) => mine.has(m)));
        h += `<h2>${{ district: "Commission districts", muni: "City and unincorporated area", hood: "Neighbourhoods" }[kind]}</h2><table class="wt"><tr><th>Place</th><th>Pops</th><th>Party ID</th><th>President, 2024</th></tr>${rows.map((x) =>
          `<tr><td>${placeLink(x.id)}</td><td class="n">${num(x.pops)}</td><td>${pie(x.party)}${lead(x.party)}</td><td class="n">${VOTE.places[x.id] ? pct(VOTE.places[x.id][0]) + " R" : ""}</td></tr>`).join("")}</table>`;
      }
    }
    return h;
  }
  if (tab === "people") {
    const block = (title, counts) => `<div class="ib-h">${title}</div>${Object.keys(counts).map((k) => mbar(k, share(counts, k))).join("")}`;
    let h = (wide ? '<div class="cols">' : "") + [["Age", q.age], ["Education", q.education], ["Household income", q.income], ["Work", q.work]].map(([t, c]) => `<div>${block(t, c)}</div>`).join("") + (wide ? "</div>" : "");
    if (wide) h += `<h2>Pops</h2>${popTable(ps)}`;
    return h;
  }
  if (tab === "party") {
    const heads = { rep: 0, ind: 0, dem: 0 }, n = ps.length || 1;
    ps.forEach((p) => heads[S.people[S.leaders[p.id]].party]++);
    return `<table><tr><th>Party ID</th><td>${lead(q.party)}</td></tr><tr><th>President, 2024</th><td>${result(q.id)}</td></tr><tr><th>Expected turnout</th><td>${pct(q.turnout)}</td></tr></table>
      <div class="ib-h">Party ID</div>${partyBars(q.party)}
      <div class="ib-h">Mood</div><table class="mini">${["federal", "state", "local"].map((l) => { const c = {}; ps.forEach((p) => { const m = S.moods[p.id][l]; c[m] = (c[m] || 0) + 1; });
        return `<tr><td>${l[0].toUpperCase() + l.slice(1)}</td><td><span class="pie wide">${Object.keys(MOOD_COL).map((m) => `<i style="width:${(c[m] || 0) / n * 100}%;background:${MOOD_COL[m]}"></i>`).join("")}</span></td><td class="pt">${Object.keys(MOOD_COL).filter((m) => c[m]).map((m) => `${m} ${num(c[m])}`).join(", ")}</td></tr>`; }).join("")}</table>
      <div class="ib-h">Pop leaders</div>${partyBars(ORDER.map((k) => heads[k] / n))}${soon("orgs")}`;
  }
  return seatTable(seatsOver(q), wide);
}
function seatTable(seats, wide) {
  const groups = {};
  const head = (s) => s.government === "federal" ? "United States" : !s.county ? "State of " + G.state : s.government === "county" || s.office === "fl.county_judge" ? s.county + " County"
    : s.government === "city" ? "City of " + (place(s.area) || {}).name : s.government === "school" ? s.county + " County School District" : s.county + " County, other districts";
  seats.forEach((s) => (groups[head(s)] ||= []).push(s));
  return Object.entries(groups).map(([g, list]) => `<div class="ib-h">${esc(g)}</div><table class="mini${wide ? " wide" : ""}">${list.map((s) =>
    `<tr><td>${esc(s.title)}${s.label ? ` <span class="pt">${esc(s.label)}</span>` : ""}</td><td>${who(s.holder)}</td>${wide ? `<td class="pt">${s.chosen === "elected" ? (s.partisan ? "Elected by party" : "Elected, no party") : "Appointed"}</td><td class="n">${s.next.join(", ")}</td>` : ""}</tr>`).join("")}</table>`).join("");
}
function popTable(all) {
  const ps = all.slice(0, 300), more = all.length > ps.length ? `<p class="pt">First ${ps.length} of ${num(all.length)} pops</p>` : "";
  return `<table class="wt"><tr><th>Pop</th><th>Neighbourhood</th><th>Leader</th><th>Work</th><th>Party ID</th><th>Turnout</th><th>Mood, local</th></tr>${ps.map((p) =>
    `<tr><td>${esc(p.race)}, ${esc(p.age)}, ${esc(p.education.toLowerCase())}<span class="pt">${esc(p.words.join(", "))}</span></td><td>${placeLink(p.hood)}</td><td>${who(S.leaders[p.id])}</td><td>${esc(p.work)}</td><td>${pie(p.pie)}${lead(p.pie)}</td><td class="n">${pct(p.turnout)}</td><td>${mood(p.id, "local")}</td></tr>`).join("")}</table>${more}`;
}

/* ---------- pages ---------- */
function show(view) {
  const onMap = view === "map";
  $("stage").hidden = !onMap;
  $("page").hidden = onMap;
  document.querySelectorAll(".vtabs button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.view === view));
  if (onMap) setTimeout(() => map && map.resize(), 0);
  else $("page").scrollTop = 0;
}
function page(html) { $("page-body").innerHTML = html; }
function pickCounty(id) { if ($(id)) $(id).onchange = (e) => { state.county = e.target.value; route(); }; }
async function route() {
  const [, view = "map", id] = decodeURIComponent(location.hash || "#/map").split("/");
  $("gres").hidden = true;
  show(view);
  const here = IDX.byFips[state.county];
  if (["voters", "elections", "officials"].includes(view)) await ensure(state.county);
  if (view === "place") await ensure(fipsOfPlace(id));
  if (view === "person") await ensure(fipsOfPerson(id));
  const county = place(here.id);
  if (view === "voters") {
    const all = popsIn(county);
    page(`<h1>Voters</h1><div class="from">${esc(here.name)} · ${num(all.length)} pops · ${num(all.length * 100)} people</div><p>${countyPicker("pcounty", state.county)}
      <select id="vfilter" aria-label="Place">${Object.values(G.places).filter((q) => q.fips === state.county).sort((a, b) => (b.kind === "county") - (a.kind === "county")).map((q) => `<option value="${esc(q.id)}">${esc(q.name)}</option>`).join("")}</select></p><div id="vtable"></div>${soon("known")}`);
    const fill = () => { $("vtable").innerHTML = popTable(popsIn(place($("vfilter").value))); };
    $("vfilter").onchange = fill;
    pickCounty("pcounty");
    fill();
  } else if (view === "elections") {
    const years = {};
    S.seats.concat(S.local[state.county]).filter((s) => covers(s, county)).forEach((s) => s.next.forEach((y) => (years[y] ||= []).push(s)));
    const card = (r, fips) => {
      const rows = r.cands.map((c, i) => [c, fips && r.by_county ? (r.by_county[fips] || [0, 0])[c.party === "rep" || (r.cands.length === 2 && i === 0) ? 0 : 1] : c.votes]);
      if (fips && r.by_county) r.cands.forEach((c, i) => { rows[i][1] = (r.by_county[fips] || [0, 0])[r.cands.length === 1 ? (c.party === "dem" && r.partisan ? 1 : 0) : i]; });
      const total = rows.reduce((a, x) => a + x[1], 0) || 1;
      return `<tr><td>${esc(r.title)}${r.label ? ` <span class="pt">${esc(r.label)}</span>` : ""}</td><td>${rows.map(([c, v]) => `<div class="cand${c.won ? " won" : ""}"><button class="who ${c.party}" data-pid="${c.id}">${esc(c.name)}</button>${c.sitting ? ' <span class="pt">sitting</span>' : ""}<span class="n">${rows.length === 1 ? "unopposed" : pct(v / total) + " · " + num(v)}</span></div>`).join("")}</td></tr>`;
    };
    const wide = VOTE.wide.filter((r) => covers({ area: r.area }, county));
    const sum = VOTE.summary, pres = sum && S.people[sum.president];
    page(`<h1>Elections</h1><div class="from">${esc(here.name)}</div><p>${countyPicker("pcounty", state.county)}</p>
      <h2>November 2024</h2>${sum ? `<table class="facts"><tr><th>President elected</th><td>${who(sum.president)} <span class="pt">country ${sum.nation_margin > 0 ? "R" : "D"} +${Math.abs(sum.nation_margin).toFixed(1)}</span></td></tr><tr><th>Florida</th><td>${result("__state")}</td></tr><tr><th>${esc(here.name)}</th><td>${result(here.id)}</td></tr></table>` : ""}
      <div class="ib-h">Federal and state, as ${esc(here.name)} voted</div><table class="mini wide races">${wide.map((r) => card(r, state.county)).join("")}</table>
      <div class="ib-h">${esc(here.name)}</div><table class="mini wide races">${(VOTE.local[state.county] || []).map((r) => card(r)).join("")}</table>
      ${soon("running")}${soon("election")}${Object.keys(years).sort().map((y) => `<h2>${y}</h2>${seatTable(years[y], true)}`).join("")}
      <h2>President, 2024, by neighbourhood</h2><table class="wt"><tr><th>Neighbourhood</th><th>Pops</th><th>Votes</th><th>Republican</th><th>Democratic</th></tr>${county.members.map(place).map((q) => { const v = VOTE.places[q.id] || [null, 0];
        return `<tr><td>${placeLink(q.id)}</td><td class="n">${q.pops}</td><td class="n">${num(v[1])}</td><td class="n" style="color:${PARTIES.rep.colour}">${pct(v[0])}</td><td class="n" style="color:${PARTIES.dem.colour}">${v[0] === null ? "" : pct(1 - v[0])}</td></tr>`; }).join("")}</table>`);
    pickCounty("pcounty");
  } else if (view === "officials") {
    const level = ["federal", "state", "local"].includes(id) ? id : state.olevel;
    state.olevel = level;
    const seats = level === "federal" ? S.seats.filter((s) => s.government === "federal" && covers(s, county)) : level === "state" ? S.seats.filter((s) => s.government === "state" && covers(s, county)) : S.local[state.county];
    page(`<h1>Officeholders</h1><div class="from">${level === "federal" ? "United States" : level === "state" ? "State of " + esc(G.state) : esc(here.name)} · ${seats.length} seats · seed ${S.seed}</div>
      <div class="tabs2" role="tablist">${[["federal", "Federal"], ["state", "State"], ["local", "Local"]].map(([k, l]) => `<button role="tab" aria-selected="${level === k}" data-go="#/officials/${k}">${l}</button>`).join("")}</div>
      <p>${countyPicker("pcounty", state.county)}</p><div class="ib-body">${seatTable(seats, true)}</div>${soon("office")}${soon("history")}`);
    pickCounty("pcounty");
  } else if (view === "stats") {
    page(`<h1>Stats</h1><div class="from">State of ${esc(G.state)}</div>${soon("services")}${soon("bills")}${soon("issues")}`);
  } else if (view === "soon" && SOON[id]) {
    page(`<h1>${esc(SOON[id][0])}</h1>${soon(id)}`);
  } else if (view === "place" && place(id)) {
    const q = place(id), up = q.kind === "county" ? [] : [q.county];
    if (q.kind === "hood") up.push(q.code + "-D" + q.district);
    page(`<div class="crumbs"><button class="back" data-go="#/map">Map</button>${up.map((u) => placeLink(u)).join(" › ")}</div><h1>${esc(q.name)}</h1><div class="from">${esc(q.sub)}</div>
      <div class="tabs2" role="tablist">${TABS.map(([k, l]) => `<button role="tab" aria-selected="${state.ptab === k}" data-ptab="${k}">${l}</button>`).join("")}</div><div class="ib-body">${placeTab(q, state.ptab, true)}</div>`);
    document.querySelectorAll("[data-ptab]").forEach((b) => b.onclick = () => { state.ptab = b.dataset.ptab; route(); });
  } else if (view === "person" && S.people[id]) {
    const c = S.people[id], seats = seatsOf(id), pop = c.pop && (POPS[c.home] || []).find((p) => p.id === c.pop);
    page(`<div class="crumbs"><button class="back" data-go="#/map">Map</button></div><h1 class="who ${c.party}" style="text-decoration:none;cursor:default;display:block">${esc(c.name)}</h1><div class="from">${esc(role(id))}</div>
      <table class="facts"><tr><th>Party</th><td>${PARTIES[c.party].name}</td></tr><tr><th>Home</th><td>${place(c.home) ? placeLink(c.home) : esc(c.home)}</td></tr>
      ${pop ? `<tr><th>Speaks for</th><td>${esc(pop.race)}, ${esc(pop.age)}, ${esc(pop.education.toLowerCase())} <span class="pt">${esc(pop.words.join(", "))}</span></td></tr><tr><th>Work</th><td>${esc(pop.work)}</td></tr>
      <tr><th>Mood</th><td>${["federal", "state", "local"].map((l) => `${l[0].toUpperCase() + l.slice(1)} ${mood(pop.id, l)}`).join(" · ")}</td></tr>` : ""}
      ${seats.map((s) => `<tr><th>Office</th><td>${esc(s.title)}${s.label ? ", " + esc(s.label) : ""}${s.next.length ? ` <span class="pt">next election ${s.next.join(", ")}</span>` : ""}</td></tr>`).join("")}
      ${c.ran ? `<tr><th>Ran for</th><td>${esc(c.ran)}</td></tr>` : ""}
      <tr><th>Seed</th><td>${S.seed}</td></tr></table><h2>Character</h2>
      ${c.traits ? `<table class="facts"><tr><th>Stats</th><td>${Object.entries(c.stats).map(([k, v]) => `${esc(BOOK.stats[k] || k)} <b>${v}</b>`).join(" · ")}</td></tr><tr><th>Traits</th><td>${c.traits.map((t) => `<span class="trait">${esc(BOOK.traits[t] || t)}</span>`).join(" ")}</td></tr></table>` : ""}${soon("you")}${soon("known")}${soon("intrigue")}`);
  }
}

/* ---------- start ---------- */
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);
Promise.all([get("data/game/fl-index.json"), get(`data/seeds/${SEED}/fl-state.json`), get(`data/seeds/${SEED}/election-2024/map.json`).catch(() => ({})),
  get(`data/seeds/${SEED}/election-2024/fl-state.json`).catch(() => ({ races: [], summary: null })), get("data/traits.json").catch(() => ({ stats: {}, traits: {} }))]).then(async ([index, top, shares, wide, book]) => {
  VOTE.places = shares; VOTE.wide = wide.races; VOTE.summary = wide.summary; Object.assign(BOOK, book);
  if (wide.summary) VOTE.places.__state = [wide.summary.florida_rep / 100, wide.races.length ? wide.races[0].cands.reduce((a, c) => a + c.votes, 0) : 0];
  G.state = index.state;
  IDX.counties = index.counties;
  for (const c of index.counties) { IDX.byFips[c.fips] = c; IDX.byId[c.id] = c; IDX.byCode[c.code] = c; for (const p of c.places) G.kinds[p[0]] = p[2]; }
  Object.assign(S.people, top.people);
  S.seats = top.seats;
  await ensure(HOME);
  const home = IDX.byFips[HOME];
  $("cdate").innerHTML = `November 2024<span class="wk">${esc(home.name)}, ${esc(G.state)}</span>`;
  $("seedtag").textContent = "Seed " + S.seed;
  $("youpanel").innerHTML = soon("you") + soon("week") + soon("campaign") + soon("notebook");
  const years = {};
  seatsOver(place(home.id)).forEach((x) => x.next.forEach((y) => { years[y] = (years[y] || 0) + 1; }));
  $("calendar").innerHTML = `<div class="cal">${Object.keys(years).sort().map((y) => `<b>${y}</b><button class="lk" data-go="#/elections">${years[y]} seats up</button>`).join("")}</div>` + soon("week");
  $("news").innerHTML = soon("news");
  $("layerbar").innerHTML = LAYERS.map(([k, l]) => `<button class="btn" data-layer="${k}">${l}</button>`).join("");
  $("linebar").innerHTML = LINES.map(([k, l, c]) => `<button class="btn" data-line="${k}"><i class="sw" style="background:${c}"></i>${l}</button>`).join("");
  $("shadebar").innerHTML = SHADES.map((x) => x.menu
    ? `<div class="dd"><button class="btn" data-group="${x.id}" data-menu="${x.id}" aria-haspopup="true">${x.label}<span class="car">▼</span></button><div class="ddmenu" id="m-${x.id}" hidden role="menu">${x.menu.map((m) => m ? `<button role="menuitemradio" ${m[0] ? `data-shade="${m[0]}"` : "disabled"}>${m[1]}</button>` : "<hr>").join("")}</div></div>`
    : `<button class="btn" data-group="${x.id}" data-shade="${x.id}">${x.label}</button>`).join("");

  map = new maplibregl.Map({ container: "map", style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#f3f1ea" } }] }, dragRotate: false, attributionControl: false, minZoom: 5, maxZoom: 15 });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
  new ResizeObserver(() => map.resize()).observe($("map"));
  map.on("load", () => {
    const b = home.bounds;
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, duration: 0 });
    map.addSource("fl", { type: "vector", url: "pmtiles://" + new URL("tiles/game-fl.pmtiles", location.href).href, promoteId: "id" });
    for (const [id, v] of Object.entries(VOTE.places)) if (v[0] !== null) map.setFeatureState({ source: "fl", sourceLayer: G.kinds[id] || (IDX.byId[id] ? "county" : /-D\d+$/.test(id) ? "district" : /^[A-Z]{3}-\d+$/.test(id) ? "hood" : "muni"), id }, { s24: v[0] });
    const round = { "line-join": "round", "line-cap": "round" }, grow = (a, b) => ["interpolate", ["linear"], ["zoom"], 7, a, 13, b];
    for (const [kind] of LAYERS) {
      map.addLayer({ id: "fill-" + kind, type: "fill", source: "fl", "source-layer": kind, layout: { visibility: "none" }, paint: { "fill-color": "#ffffff", "fill-antialias": false } });
      map.addLayer({ id: "edge-" + kind, type: "line", source: "fl", "source-layer": kind, layout: { ...round, visibility: "none" }, paint: { "line-color": "#72777d", "line-width": grow(0.15, 0.8) } });
    }
    const style = { hood: [0.2, 1, null], district: [0.6, 1.8, null], city: [0.5, 1.8, [3, 2]], house: [0.8, 2.4, null], senate: [0.8, 2.4, [5, 2]], congress: [1, 3, [1, 2]], county: [0.9, 2.8, null] };
    for (const k of ["hood", "district", "city", "house", "senate", "congress", "county"]) {
      const paint = { "line-color": LINES.find((x) => x[0] === k)[2], "line-width": grow(style[k][0], style[k][1]) };
      if (style[k][2]) paint["line-dasharray"] = style[k][2];
      const layer = { id: "l-" + k, type: "line", source: "fl", "source-layer": k === "city" ? "muni" : k, layout: { ...(style[k][2] ? { "line-join": "round" } : round), visibility: "none" }, paint };
      if (k === "city") layer.filter = ["==", ["get", "city"], 1];
      map.addLayer(layer);
    }
    for (const [kind] of LAYERS) {
      map.addLayer({ id: "picked-" + kind, type: "line", source: "fl", "source-layer": kind, layout: { ...round, visibility: "none" }, filter: ["==", ["get", "id"], ""], paint: { "line-color": "#202122", "line-width": grow(2, 3.6) } });
      map.on("click", "fill-" + kind, async (e) => { const p = e.features[0].properties; await ensure(p.fips); state.selected = p.id; paint(); infobox(); });
      map.on("mousemove", "fill-" + kind, (e) => { const p = e.features[0].properties; tip(`<b>${esc(p.name)}</b>${kind === "county" ? "" : "<br>" + esc(IDX.byFips[p.fips].name)}<br>${num(p.pops)} pops · ${lead([p.pr, p.pi, p.pd])}`, e.originalEvent); map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "fill-" + kind, () => { $("tip").hidden = true; map.getCanvas().style.cursor = ""; });
    }
    paint();
  });
  route();
});

function tip(html, e) {
  const t = $("tip");
  t.innerHTML = html;
  t.hidden = false;
  t.style.left = Math.min(e.clientX + 14, innerWidth - t.offsetWidth - 8) + "px";
  t.style.top = Math.min(e.clientY + 16, innerHeight - t.offsetHeight - 8) + "px";
}
addEventListener("hashchange", route);
document.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  document.querySelectorAll(".ddmenu").forEach((m) => { if (!t || t.dataset.menu !== m.id.slice(2)) m.hidden = true; });
  if (!t) return;
  if (t.dataset.menu) { const m = $("m-" + t.dataset.menu); m.hidden = !m.hidden; }
  if (t.dataset.view) location.hash = "#/" + t.dataset.view;
  if (t.dataset.go) location.hash = t.dataset.go;
  if (t.dataset.href) location.href = t.dataset.href;
  if (t.dataset.place) location.hash = "#/place/" + encodeURIComponent(t.dataset.place);
  if (t.dataset.pid) location.hash = "#/person/" + t.dataset.pid;
  if (t.dataset.layer) { state.layer = t.dataset.layer; state.selected = null; paint(); infobox(); }
  if (t.dataset.line) { lines.has(t.dataset.line) ? lines.delete(t.dataset.line) : lines.add(t.dataset.line); paint(); }
  if (t.dataset.shade) { state.shade = t.dataset.shade; paint(); }
});
document.addEventListener("mouseover", (e) => {
  const b = e.target.closest && e.target.closest(".who[data-pid]");
  if (b && S.people[b.dataset.pid]) { const c = S.people[b.dataset.pid]; tip(`<b>${esc(c.name)}</b><br>${PARTIES[c.party].name}${role(c.id) ? "<br>" + esc(role(c.id)) : ""}`, e); }
});
document.addEventListener("mouseout", (e) => { if (e.target.closest && e.target.closest(".who[data-pid]")) $("tip").hidden = true; });
const shelves = {};
const shelf = (letter) => (shelves[letter] ||= get(`data/seeds/${SEED}/search/${letter}.json`).catch(() => []));
let asked = 0;
$("gsearch").oninput = async (e) => {
  const text = e.target.value.trim().toLowerCase(), box = $("gres"), mine = ++asked;
  if (text.length < 2) { box.hidden = true; return; }
  const words = text.split(/\s+/);
  const code = text.toUpperCase().match(/^([A-Z]{3})-(D?\d+)$/), county = code && IDX.byCode[code[1]];
  const places = (county ? [[code[0], code[0], county.name]] : []).concat(IDX.counties.flatMap((c) => [[c.id, c.name, "Florida"]].concat(c.places.filter((p) => p[2] === "muni").map((p) => [p[0], p[1], c.name])))
    .filter((p) => p[1].toLowerCase().includes(text))).slice(0, 6).map((p) => `<button data-place="${esc(p[0])}">${esc(p[1])}<span class="k">${esc(p[2])}</span></button>`);
  const rows = /[a-z]/.test(words[0][0]) ? await shelf(words[0][0]) : [];
  if (mine !== asked) return;
  const people = rows.filter((r) => { const parts = r[1].toLowerCase().split(" "); return words.every((w) => parts.some((part) => part.startsWith(w))); }).slice(0, 10)
    .map((r) => `<button data-pid="${r[0]}"><span class="who ${r[2]}" style="text-decoration:none">${esc(r[1])}</span><span class="k">${esc(r[3] || (r[4] ? "Speaks for a pop in " + r[4] : PARTIES[r[2]].name))}</span></button>`);
  box.innerHTML = places.concat(people).join("") || `<button disabled>Nothing found</button>`;
  box.hidden = false;
};
