/* The shell: the old interface running on the new data. Nothing here advances time or fires events yet. */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (x) => (x === null || x === undefined ? "" : Math.round(x * 100) + "%");
const num = (n) => Number(n).toLocaleString("en-US");
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const PARTY = { rep: "Republican", dem: "Democrat", ind: "Independent" };
const LAYERS = [["county", "County"], ["district", "Commission districts"], ["muni", "Municipal"], ["hood", "Neighbourhoods"]];
const TABS = [["overview", "Overview"], ["people", "People"], ["party", "Party"], ["gov", "Officeholders"]];
const RACE_COL = { White: "#8c6bb1", Black: "#41ab5d", Hispanic: "#f16913", Asian: "#3690c0", Other: "#969696" };
const AREA_COL = { urban: "#54278f", suburban: "#9e9ac8", "small town": "#fdae6b", rural: "#a1d99b" };
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
  { id: "results", label: "Results", menu: [["r2024", "President, 2024"], ["local", "Local lean"]] },
];
let G, P, S, O, map, state = { layer: "hood", shade: "party", selected: null, tab: "overview", ptab: "overview" };

const soon = (key) => `<div class="soon"><b>${esc(SOON[key][0])}</b>${SOON[key][1] ? "Update " + SOON[key][1] : "Later"}</div>`;
const place = (id) => G.places[id];
const popsIn = (q) => P.pops.filter((p) => q.members.includes(p.hood));
const who = (pid) => { const c = S.people[pid]; return c ? `<button class="who ${c.party}" data-pid="${pid}">${esc(c.name)}</button>` : ""; };
const placeLink = (id, label) => `<button class="lk" data-place="${esc(id)}">${esc(label || place(id).name)}</button>`;
const share = (counts, key) => (counts[key] || 0) / (Object.values(counts).reduce((a, b) => a + b, 0) || 1);
const mbar = (label, v, color) => `<div class="mbar"><span>${esc(label)}</span><span class="tr"><span class="fl" style="display:block;width:${Math.round(v * 100)}%;background:${color || "var(--g4)"}"></span></span><span class="v">${pct(v)}</span></div>`;
const MOOD_COL = { Angry: "#b2182b", Dissatisfied: "#ef8a62", Neutral: "#bdbdbd", Content: "#7fbf7b", Happy: "#1b7837" };
const mood = (pid, level) => { const m = (S.moods[pid] || {})[level]; return m ? `<span class="mood"><i style="background:${MOOD_COL[m]}"></i>${m}</span>` : ""; };
const lean = (v) => (!v ? "None" : `<span style="color:var(--${v > 0 ? "rep" : "dem"})">${v > 0 ? "R" : "D"} +${Math.abs(v).toFixed(1)}</span>`);
const pie = (p) => `<span class="pie"><i style="width:${p[0] * 100}%;background:var(--rep)"></i><i style="width:${p[1] * 100}%;background:var(--g2)"></i><i style="width:${p[2] * 100}%;background:var(--dem)"></i></span>`;
const partyLine = (p) => `<span style="color:var(--rep)">R ${pct(p[0])}</span> · <span style="color:var(--dem)">D ${pct(p[2])}</span> · Ind ${pct(p[1])}`;
const role = (pid) => {
  const seats = S.seats.filter((s) => s.holder === pid), c = S.people[pid];
  if (seats.length) return seats.map((s) => s.title + (s.label ? ", " + s.label : "")).join("; ");
  return c.pop ? "Speaks for a pop in " + c.home : "";
};

function covers(seat, q) {
  if (seat.area === "state" || seat.area === "country") return true;
  if (seat.area === q.id) return true;
  const hoods = q.members.map(place);
  for (const [word, field] of [["house", "house"], ["senate", "senate"], ["cd", "congress"]]) if (seat.area.startsWith(word + "-")) return hoods.some((h) => word + "-" + h[field] === seat.area);
  if (place(seat.area)) return place(seat.area).members.some((m) => q.members.includes(m));
  return false;
}

/* ---------- map ---------- */
function ramp(prefix, t) { return css(`--${prefix}${Math.max(0, Math.min(7, Math.round(t * 7)))}`); }
function diverge(v, span) { const t = Math.min(1, Math.abs(v) / span); return v >= 0 ? ramp("r", t) : ramp("d", t); }
function grey(t) { return css(`--g${Math.max(0, Math.min(6, Math.round(t * 6)))}`); }
function colour(q) {
  const s = state.shade;
  if (!q.pops) return "#ffffff";
  if (s === "party") return diverge(q.party[0] - q.party[2], 0.5);
  if (s === "r2024") return diverge(q.rep2024 - 0.5, 0.3);
  if (s === "race") return RACE_COL[Object.keys(q.race)[0]];
  if (s.startsWith("race_")) return grey(share(q.race, s.slice(5)));
  if (s === "local") return diverge(q.local || 0, 15);
  if (s === "area") return AREA_COL[Object.keys(q.area)[0]];
  if (s === "pops") return grey(Math.min(1, q.pops / Math.max(...Object.values(G.places).filter((x) => x.kind === state.layer).map((x) => x.pops))));
  if (s === "ba") return grey(share(q.education, "Bachelor's or more") / 0.5);
  if (s === "old") return grey(share(q.age, "65 and over") / 0.6);
  if (s === "income") return grey(share(q.income, "Under $35,000") / 0.7);
  return "#ffffff";
}
function legend() {
  const s = state.shade, bar = (cols, a, b) => `<div class="bar">${cols.map((c) => `<span style="background:${c}"></span>`).join("")}</div><div class="ends"><span>${a}</span><span>${b}</span></div>`;
  const dv = [7, 5, 3, 1].map((i) => css("--d" + i)).concat([1, 3, 5, 7].map((i) => css("--r" + i))), gr = [0, 1, 2, 3, 4, 5, 6].map((i) => css("--g" + i));
  const cat = (table) => `<div class="cat">${Object.entries(table).map(([k, c]) => `<span><i style="background:${c}"></i>${esc(k[0].toUpperCase() + k.slice(1))}</span>`).join("")}</div>`;
  const title = { party: "Party ID", r2024: "President, 2024", local: "Local lean", race: "Largest group", area: "Area type", pops: "Pops", ba: "Bachelor's degree", old: "Age 65 and over", income: "Income under $35,000" }[s] || "Share " + s.slice(5);
  const body = s === "party" ? bar(dv, "More Democratic", "More Republican") : s === "r2024" || s === "local" ? bar(dv, "Democratic", "Republican") : s === "race" ? cat(RACE_COL) : s === "area" ? cat(AREA_COL) : bar(gr, "Fewer", "More");
  $("legend").innerHTML = `<div class="t">${title}</div>${body}`;
}
function paint() {
  const data = { type: "FeatureCollection", features: G.shapes.features.filter((f) => f.properties.kind === state.layer).map((f) => ({ ...f, properties: { ...f.properties, c: colour(place(f.properties.id)) } })) };
  map.getSource("places").setData(data);
  map.setFilter("picked", ["==", ["get", "id"], state.selected || ""]);
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
    const inside = q.kind === "hood" ? `<tr><th>Commission district</th><td>${placeLink(q.code + "-D" + q.district, "District " + q.district)}</td></tr><tr><th>State House</th><td>District ${q.house}</td></tr><tr><th>State Senate</th><td>District ${q.senate}</td></tr><tr><th>Congress</th><td>District ${q.congress}</td></tr><tr><th>Local lean</th><td>${lean(q.local)}</td></tr>` : "";
    let h = `<table><tr><th>People</th><td>${num(q.pops * 100)} <span class="pt">(${q.pops} pops)</span></td></tr><tr><th>Party ID</th><td>${partyLine(q.party)}</td></tr>
      <tr><th>President, 2024</th><td>${q.rep2024 === null ? "" : `<span style="color:var(--rep)">R ${pct(q.rep2024)}</span> · <span style="color:var(--dem)">D ${pct(1 - q.rep2024)}</span>`}</td></tr>
      <tr><th>Area type</th><td>${Object.entries(q.area).map(([k, v]) => `${k} (${v})`).join(", ")}</td></tr>${inside}</table>
      <div class="ib-h">People by race</div>${Object.keys(RACE_COL).filter((r) => q.race[r]).map((r) => mbar(r, share(q.race, r), RACE_COL[r])).join("")}`;
    if (wide && q.kind !== "hood") {
      const kids = q.kind === "county" ? ["district", "muni", "hood"] : ["hood"];
      for (const kind of kids) {
        const rows = Object.values(G.places).filter((x) => x.kind === kind && x.members.every((m) => q.members.includes(m)));
        h += `<h2>${{ district: "Commission districts", muni: "City and unincorporated area", hood: "Neighbourhoods" }[kind]}</h2><table class="wt"><tr><th>Place</th><th>Pops</th><th>Party ID</th><th>President, 2024</th></tr>${rows.map((x) =>
          `<tr><td>${placeLink(x.id)}</td><td class="n">${x.pops}</td><td>${pie(x.party)}${pct(x.party[0])} R</td><td class="n">${pct(x.rep2024)} R</td></tr>`).join("")}</table>`;
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
    const lead = { rep: 0, ind: 0, dem: 0 };
    ps.forEach((p) => lead[S.people[S.leaders[p.id]].party]++);
    return `<table><tr><th>Party ID</th><td>${partyLine(q.party)}</td></tr><tr><th>President, 2024</th><td>${pct(q.rep2024)} Republican of ${num(q.votes2024)} votes</td></tr><tr><th>Expected turnout</th><td>${pct(q.turnout)}</td></tr></table>
      <div class="ib-h">Party ID</div>${mbar("Republican", q.party[0], "var(--rep)")}${mbar("Independent", q.party[1], "var(--g3)")}${mbar("Democrat", q.party[2], "var(--dem)")}
      <div class="ib-h">Mood</div><table class="mini">${["federal", "state", "local"].map((l) => { const c = {}; ps.forEach((p) => { const m = S.moods[p.id][l]; c[m] = (c[m] || 0) + 1; });
        return `<tr><td>${l[0].toUpperCase() + l.slice(1)}</td><td><span class="pie wide">${Object.keys(MOOD_COL).map((m) => `<i style="width:${(c[m] || 0) / ps.length * 100}%;background:${MOOD_COL[m]}"></i>`).join("")}</span></td><td class="pt">${Object.keys(MOOD_COL).filter((m) => c[m]).map((m) => `${m} ${c[m]}`).join(", ")}</td></tr>`; }).join("")}</table>
      <div class="ib-h">Pop leaders</div>${mbar("Republican", lead.rep / ps.length, "var(--rep)")}${mbar("Independent", lead.ind / ps.length, "var(--g3)")}${mbar("Democrat", lead.dem / ps.length, "var(--dem)")}${soon("orgs")}`;
  }
  const seats = S.seats.filter((s) => covers(s, q));
  return seatTable(seats, wide);
}
function seatTable(seats, wide) {
  const groups = {};
  const head = (s) => s.government === "federal" ? "United States" : !s.county ? "State of " + G.state : s.government === "county" || s.office === "fl.county_judge" ? s.county + " County"
    : s.government === "city" ? "City of " + place(s.area).name : s.government === "school" ? s.county + " County School District" : s.county + " County, other districts";
  seats.forEach((s) => (groups[head(s)] ||= []).push(s));
  const names = new Proxy({}, { get: (_, k) => k });
  return Object.entries(groups).map(([g, list]) => `<div class="ib-h">${names[g]}</div><table class="mini${wide ? " wide" : ""}">${list.map((s) =>
    `<tr><td>${esc(s.title)}${s.label ? ` <span class="pt">${esc(s.label)}</span>` : ""}</td><td>${who(s.holder)}</td>${wide ? `<td class="pt">${s.chosen === "elected" ? (s.partisan ? "Elected by party" : "Elected, no party") : "Appointed"}</td><td class="n">${s.next.join(", ")}</td>` : ""}</tr>`).join("")}</table>`).join("");
}
function popTable(all) {
  const ps = all.slice(0, 300), more = all.length > ps.length ? `<p class="pt">First ${ps.length} of ${num(all.length)} pops</p>` : "";
  return `<table class="wt"><tr><th>Pop</th><th>Neighbourhood</th><th>Leader</th><th>Work</th><th>Party ID</th><th>Turnout</th><th>Mood, local</th></tr>${ps.map((p) =>
    `<tr><td>${esc(p.race)}, ${esc(p.age)}, ${esc(p.education.toLowerCase())}<span class="pt">${esc(p.words.join(", "))}</span></td><td>${placeLink(p.hood)}</td><td>${who(S.leaders[p.id])}</td><td>${esc(p.work)}</td><td>${pie(p.pie)}${pct(p.pie[0])} R</td><td class="n">${pct(p.turnout)}</td><td>${mood(p.id, "local")}</td></tr>`).join("")}</table>${more}`;
}

/* ---------- pages ---------- */
function show(view) {
  const onMap = view === "map";
  $("stage").hidden = !onMap;
  $("page").hidden = onMap;
  document.querySelectorAll(".vtabs button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.view === view));
  if (onMap) setTimeout(() => map.resize(), 0);
  else $("page").scrollTop = 0;
}
function page(html) { $("page-body").innerHTML = html; }
function route() {
  const [, view = "map", id] = decodeURIComponent(location.hash || "#/map").split("/");
  $("gres").hidden = true;
  show(view);
  if (view === "voters") {
    page(`<h1>Voters</h1><div class="from">${P.pops.length} pops · ${num(P.pops.length * 100)} people</div><p><select id="vfilter">${Object.values(G.places).sort((a, b) => (b.kind === "county") - (a.kind === "county")).map((q) => `<option value="${esc(q.id)}">${esc(q.name)}</option>`).join("")}</select></p><div id="vtable"></div>${soon("known")}`);
    const fill = () => { $("vtable").innerHTML = popTable(popsIn(place($("vfilter").value))); };
    $("vfilter").onchange = fill;
    fill();
  } else if (view === "elections") {
    const years = {};
    S.seats.forEach((s) => s.next.forEach((y) => (years[y] ||= []).push(s)));
    page(`<h1>Elections</h1><div class="from">${G.names}</div>${soon("running")}${soon("election")}${Object.keys(years).sort().map((y) => `<h2>${y}</h2>${seatTable(years[y], true)}`).join("")}
      <h2>President, 2024</h2><table class="wt"><tr><th>Neighbourhood</th><th>Pops</th><th>Votes</th><th>Republican</th><th>Democratic</th></tr>${Object.values(G.places).filter((q) => q.kind === "hood").map((q) =>
        `<tr><td>${placeLink(q.id)}</td><td class="n">${q.pops}</td><td class="n">${num(q.votes2024)}</td><td class="n" style="color:var(--rep)">${pct(q.rep2024)}</td><td class="n" style="color:var(--dem)">${pct(1 - q.rep2024)}</td></tr>`).join("")}</table>`);
  } else if (view === "officials") {
    page(`<h1>Officeholders</h1><div class="from">${S.seats.length} seats over ${G.names} · seed ${S.seed}</div>${seatTable(S.seats, true)}${soon("office")}${soon("history")}`);
  } else if (view === "stats") {
    page(`<h1>Stats</h1><div class="from">${G.names}</div>${soon("services")}${soon("bills")}${soon("issues")}`);
  } else if (view === "soon") {
    page(`<h1>${esc(SOON[id][0])}</h1>${soon(id)}`);
  } else if (view === "place" && place(id)) {
    const q = place(id), up = q.kind === "county" ? [] : [q.county];
    if (q.kind === "hood") up.push(q.code + "-D" + q.district);
    page(`<div class="crumbs"><button class="back" data-go="#/map">Map</button>${up.map((u) => placeLink(u)).join(" › ")}</div><h1>${esc(q.name)}</h1><div class="from">${esc(q.sub)}</div>
      <div class="tabs2" role="tablist">${TABS.map(([k, l]) => `<button role="tab" aria-selected="${state.ptab === k}" data-ptab="${k}">${l}</button>`).join("")}</div><div class="ib-body">${placeTab(q, state.ptab, true)}</div>`);
    document.querySelectorAll("[data-ptab]").forEach((b) => b.onclick = () => { state.ptab = b.dataset.ptab; route(); });
  } else if (view === "person" && S.people[id]) {
    const c = S.people[id], seats = S.seats.filter((s) => s.holder === id), pop = c.pop && P.pops.find((p) => p.id === c.pop);
    page(`<div class="crumbs"><button class="back" data-go="#/map">Map</button></div><h1 class="who ${c.party}" style="text-decoration:none;cursor:default;display:block">${esc(c.name)}</h1><div class="from">${esc(role(id))}</div>
      <table class="facts"><tr><th>Party</th><td>${PARTY[c.party]}</td></tr><tr><th>Home</th><td>${place(c.home) ? placeLink(c.home) : esc(c.home)}</td></tr>
      ${pop ? `<tr><th>Speaks for</th><td>${esc(pop.race)}, ${esc(pop.age)}, ${esc(pop.education.toLowerCase())} <span class="pt">${esc(pop.words.join(", "))}</span></td></tr><tr><th>Work</th><td>${esc(pop.work)}</td></tr>
      <tr><th>Mood</th><td>${["federal", "state", "local"].map((l) => `${l[0].toUpperCase() + l.slice(1)} ${mood(pop.id, l)}`).join(" · ")}</td></tr>` : ""}
      ${seats.map((s) => `<tr><th>Office</th><td>${esc(s.title)}${s.label ? ", " + esc(s.label) : ""}${s.next.length ? ` <span class="pt">next election ${s.next.join(", ")}</span>` : ""}</td></tr>`).join("")}
      <tr><th>Seed</th><td>${S.seed}</td></tr></table><h2>Character</h2>${soon("you")}${soon("known")}${soon("intrigue")}`);
  }
}

/* ---------- start ---------- */
const get = (path) => fetch(path).then((r) => r.json());
const LINES = [["county", "Counties", "#202122"], ["district", "Commission districts", "#202122"], ["city", "Cities", "#202122"], ["hood", "Neighbourhoods", "#72777d"],
  ["house", "State House", "#7a3fb0"], ["senate", "State Senate", "#0b7a75"], ["congress", "Congress", "#b36b00"]];
const lines = new Set(["county", "city"]);
let WIDE;
get("data/game/counties.json").then((counties) => Promise.all([
  Promise.all(counties.map((c) => Promise.all([get(`data/game/fl-${c.fips}.json`), get(`data/pops/fl-${c.fips}.json`), get(`data/seeds/1/fl-${c.fips}.json`)]))),
  fetch("content/government/offices-fl.yaml").then((r) => r.text()), get("data/game/fl-lines.json"),
])).then(([parts, o, wide]) => {
  // every county joined into one world
  G = { state: parts[0][0].state, places: {}, shapes: { type: "FeatureCollection", features: [] }, city: { type: "FeatureCollection", features: [] }, bounds: [180, 90, -180, -90] };
  P = { pops: [] }; S = { seed: parts[0][2].seed, people: {}, leaders: {}, moods: {}, seats: [] }; O = jsyaml.load(o); WIDE = wide;
  const seen = new Set();
  for (const [g, p, s] of parts) {
    Object.assign(G.places, g.places);
    G.shapes.features.push(...g.shapes.features);
    G.city.features.push(...g.lines.City.features);
    G.bounds = [Math.min(G.bounds[0], g.bounds[0]), Math.min(G.bounds[1], g.bounds[1]), Math.max(G.bounds[2], g.bounds[2]), Math.max(G.bounds[3], g.bounds[3])];
    P.pops.push(...p.pops);
    Object.assign(S.people, s.people); Object.assign(S.leaders, s.leaders); Object.assign(S.moods, s.moods);
    for (const x of s.seats) { const k = x.county + x.office + x.label + x.area + x.holder; if (!seen.has(k)) { seen.add(k); S.seats.push(x); } }
  }
  const order = { federal: 0, state: 1, county: 2, city: 3, school: 4, district: 5 };
  S.seats.sort((a, b) => (a.county ? 1 : 0) - (b.county ? 1 : 0) || a.county.localeCompare(b.county) || order[a.government] - order[b.government]);
  const cs = Object.values(G.places).filter((q) => q.kind === "county").map((q) => q.name.replace(" County", ""));
  G.names = cs.slice(0, -1).join(", ") + (cs.length > 1 ? " and " : "") + cs.slice(-1) + (cs.length > 1 ? " counties" : " County");
  P.pops.forEach((x) => { x.pie = [x.pie.R, x.pie.I, x.pie.D]; });
  $("cdate").innerHTML = `November 2024<span class="wk">${esc(G.names)}, ${esc(G.state)}</span>`;
  $("linebar").innerHTML = LINES.map(([k, l, c]) => `<button class="btn" data-line="${k}"><i class="sw" style="background:${c}"></i>${l}</button>`).join("");
  $("seedtag").textContent = "Seed " + S.seed;
  $("youpanel").innerHTML = soon("you") + soon("week") + soon("campaign") + soon("notebook");
  const years = {};
  S.seats.forEach((x) => x.next.forEach((y) => { years[y] = (years[y] || 0) + 1; }));
  $("calendar").innerHTML = `<div class="cal">${Object.keys(years).sort().map((y) => `<b>${y}</b><button class="lk" data-go="#/elections">${years[y]} seats up</button>`).join("")}</div>` + soon("week");
  $("news").innerHTML = soon("news");
  $("layerbar").innerHTML = LAYERS.map(([k, l]) => `<button class="btn" data-layer="${k}">${l}</button>`).join("");
  $("shadebar").innerHTML = SHADES.map((x) => x.menu
    ? `<div class="dd"><button class="btn" data-group="${x.id}" data-menu="${x.id}" aria-haspopup="true">${x.label}<span class="car">▼</span></button><div class="ddmenu" id="m-${x.id}" hidden role="menu">${x.menu.map((m) => m ? `<button role="menuitemradio" ${m[0] ? `data-shade="${m[0]}"` : "disabled"}>${m[1]}</button>` : "<hr>").join("")}</div></div>`
    : `<button class="btn" data-group="${x.id}" data-shade="${x.id}">${x.label}</button>`).join("");

  map = new maplibregl.Map({ container: "map", style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#f3f1ea" } }] }, dragRotate: false, attributionControl: false, maxZoom: 15 });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
  new ResizeObserver(() => map.resize()).observe($("map"));
  map.on("load", () => {
    const b = G.bounds;
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 24, duration: 0 });
    const only = (kind) => ({ type: "FeatureCollection", features: G.shapes.features.filter((f) => f.properties.kind === kind) });
    const round = { "line-join": "round", "line-cap": "round" }, grow = (a, b) => ["interpolate", ["linear"], ["zoom"], 8, a, 13, b];
    map.addSource("places", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "fill", type: "fill", source: "places", paint: { "fill-color": ["get", "c"], "fill-antialias": false } });
    map.addLayer({ id: "edge", type: "line", source: "places", layout: round, paint: { "line-color": "#72777d", "line-width": grow(0.3, 0.8) } });
    const style = { hood: [0.4, 1, null], district: [1, 1.8, null], city: [1, 1.8, [3, 2]], house: [1.4, 2.4, null], senate: [1.4, 2.4, [5, 2]], congress: [1.8, 3, [1, 2]], county: [1.8, 2.8, null] };
    for (const k of ["hood", "district", "city", "house", "senate", "congress", "county"]) {
      map.addSource("l-" + k, { type: "geojson", data: k === "city" ? G.city : WIDE[k] || only(k) });
      const paint = { "line-color": LINES.find((x) => x[0] === k)[2], "line-width": grow(style[k][0], style[k][1]) };
      if (style[k][2]) paint["line-dasharray"] = style[k][2];
      map.addLayer({ id: "l-" + k, type: "line", source: "l-" + k, layout: { ...(style[k][2] ? { "line-join": "round" } : round), visibility: "none" }, paint });
    }
    map.addLayer({ id: "picked", type: "line", source: "places", layout: round, filter: ["==", ["get", "id"], ""], paint: { "line-color": "#202122", "line-width": grow(2.4, 3.6) } });
    map.on("click", "fill", (e) => { state.selected = e.features[0].properties.id; paint(); infobox(); });
    map.on("mousemove", "fill", (e) => { const q = place(e.features[0].properties.id); tip(`<b>${esc(q.name)}</b><br>${q.pops} pops · ${pct(q.party[0])} R · ${pct(q.party[2])} D`, e.originalEvent); map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "fill", () => { $("tip").hidden = true; map.getCanvas().style.cursor = ""; });
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
  if (b) { const c = S.people[b.dataset.pid]; tip(`<b>${esc(c.name)}</b><br>${PARTY[c.party]}${role(c.id) ? "<br>" + esc(role(c.id)) : ""}`, e); }
});
document.addEventListener("mouseout", (e) => { if (e.target.closest && e.target.closest(".who[data-pid]")) $("tip").hidden = true; });
$("gsearch").oninput = (e) => {
  const text = e.target.value.trim().toLowerCase(), box = $("gres");
  if (text.length < 2) { box.hidden = true; return; }
  const people = Object.values(S.people).filter((c) => c.name.toLowerCase().includes(text)).slice(0, 8).map((c) => `<button data-pid="${c.id}"><span class="who ${c.party}" style="text-decoration:none">${esc(c.name)}</span><span class="k">${esc(role(c.id) || PARTY[c.party])}</span></button>`);
  const places = Object.values(G.places).filter((q) => q.name.toLowerCase().includes(text)).slice(0, 6).map((q) => `<button data-place="${esc(q.id)}">${esc(q.name)}<span class="k">${esc(q.sub)}</span></button>`);
  box.innerHTML = places.concat(people).join("") || `<button disabled>Nothing found</button>`;
  box.hidden = false;
};
