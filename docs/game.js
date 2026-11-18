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
const LAYERS = [["county", "County"], ["district", "Commission districts"], ["muni", "Municipal"], ["hood", "Neighbourhoods"], ["house", "State House"], ["senate", "State Senate"], ["congress", "Congress"]];
const FAR = new Set(["house", "senate", "congress"]);   /* districts that cross county lines: their numbers come from data/shades.json, not the tiles */
const LINES = [["county", "Counties", "#202122"], ["district", "Commission districts", "#202122"], ["city", "Cities", "#202122"], ["hood", "Neighbourhoods", "#72777d"],
  ["house", "State House", "#7a3fb0"], ["senate", "State Senate", "#0b7a75"], ["congress", "Congress", "#b36b00"]];
const TABS = [["overview", "Overview"], ["people", "People"], ["party", "Party"], ["issues", "Issues"], ["gov", "Officeholders"]];
const RACE_COL = { White: "#8c6bb1", Black: "#41ab5d", Hispanic: "#f16913", Asian: "#3690c0", Other: "#969696" };
const AREA_COL = { urban: "#54278f", suburban: "#9e9ac8", "small town": "#fdae6b", rural: "#a1d99b" };
const MOOD_COL = { Angry: "#b2182b", Dissatisfied: "#ef8a62", Neutral: "#bdbdbd", Content: "#7fbf7b", Happy: "#1b7837" };
const MOST = { hood: 50, district: 1500, muni: 3000, county: 20000, house: 2000, senate: 5000, congress: 7000 };
const SOON = {
  you: ["Character creation", 3], week: ["The week", 4], notebook: ["Notebook", 5], known: ["Who knows you", 5], orgs: ["Organizations", 6], issues: ["Issues and positions", 7],
  running: ["Running for office", 8], campaign: ["The campaign", 9], money: ["Money and fundraising", 11], election: ["Election day", 15], office: ["Holding office", 17],
  services: ["Government and services", 18], bills: ["Bills and votes", 19], news: ["News and the press", 22], intrigue: ["Intrigue and actions", 23], history: ["History and generation", 26], tools: ["Test tools", 0], saves: ["Saves", 0],
};
const SHADES = [
  { id: "party", label: "Party" },
  { id: "race", label: "Race", menu: [["race", "Largest group"]] },
  { id: "issues", label: "Issues", menu: [["", "Issues and positions · update 7"]] },
  { id: "camps", label: "Camps", menu: [["camp_all", "Largest camp"], null, ["camp_dem", "Among Democrats"], ["camp_rep", "Among Republicans"], ["camp_ind", "Among independents"]] },
  { id: "demo", label: "Demographics", menu: [["pops", "Pops"], ["area", "Area type"]] },
  { id: "work", label: "Work", menu: [] },
  { id: "results", label: "Results", menu: [["r2024", "President, 2024"], null, ["real", "Real 2024"], ["local", "Local lean"]] },
];
const IDX = { counties: [], byFips: {}, byId: {}, byCode: {} };
const G = { state: "", places: {}, kinds: {} }, POPS = {}, S = { seed: SEED, people: {}, leaders: {}, moods: {}, seats: [], local: {} };
const lines = new Set(["county", "city"]), loading = {};
const VOTE = { places: {}, wide: [], local: {}, summary: null }, BOOK = { stats: {}, traits: {}, likes: {}, personality: {}, dials: null }, POPID = {};
const ORG = { list: [], kinds: [["church", "Churches"], ["union", "Unions"], ["business", "Business groups"], ["civic", "Civic and advocacy groups"], ["party", "Parties"]], chapters: {}, departments: {}, boards: {}, executives: {} }, POSTS = {};
const FUNCTION = { police: "police", fire: "fire", roads: "roads", water: "water and power", waste: "solid waste", parks: "parks", libraries: "libraries", health: "health", welfare: "social services", housing: "housing", planning: "planning",
  environment: "natural resources", airports: "airports", transit: "transit", finance: "finance", administration: "administration" };
const OFFICERS = { "county.sheriff": "police and corrections", "county.clerk": "records and audit", "county.property_appraiser": "assessment", "county.tax_collector": "tax collection", "county.elections": "elections" };
const ISS = { list: [], usual: {}, places: {}, on: -1 };
const CAMP = { list: [], places: {}, on: "" }, SIDES = ["dem", "ind", "rep"];
const SH = { fields: [], places: {}, districts: {}, names: {}, on: -1 };   /* every field the map can shade by, for every outlined place */
const shField = (key) => SH.fields.findIndex((f) => f.key === key);
const shVal = (id, i) => (SH.places[id] ? SH.places[id][i + 1] / 1000 : null);
/* issues: positive is the left end. A pop's number is the issue's base plus the pulls of what the pop is, the same sum as build/issues.py */
const WORKPULL = { "Government and military": "government work", "Schools and health": "schools and health", "Shops and service": "service work", "Building and transport": "blue-collar", "Factory and plant": "blue-collar", "Farm and ranch": "farm", "Oil, gas and mining": "oil and mining" };
function popIssues(p) {
  const t = { Republican: p.pie[0], Democrat: p.pie[2], [p.race]: 1, [p.area]: 1, church: 0, union: 0, business: 0 };
  for (let i = 0; i < p.orgs.length; i += 2) { const k = ORG.list[p.orgs[i]][2]; if (k in t) t[k] += p.orgs[i + 1] / 100; }
  t[{ "Under $35,000": "under $35k", "Over $150,000": "over $150k" }[p.income]] = 1; t[{ "18 to 29": "under 30", "65 and over": "65 and over" }[p.age]] = 1;
  if (p.education === "Bachelor's or more") t.college = 1;
  t[WORKPULL[p.work]] = 1;
  return ISS.list.map((x) => Math.max(-100, Math.min(100, Math.round(x.base + Object.entries(x.pulls).reduce((a, [g, v]) => a + v * (t[g] || 0), 0)))));
}
const signed = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v);
const nearest = (x, v) => x.stops.reduce((a, b) => (Math.abs(b[0] - v) < Math.abs(a[0] - v) ? b : a));
const issueColour = (v) => (v === 0 ? "inherit" : v > 0 ? "#1a7790" : "#b9560f");
function issueTable(nums) {
  let last = "";
  return `<table class="wt iss"><tr><th>Issue</th><th class="n">Stands at</th><th>Nearest position</th></tr>${ISS.list.map((x, k) => { const head = x.category === last ? "" : `<tr class="cat"><td colspan="3">${esc(x.category)}</td></tr>`; last = x.category;
    return `${head}<tr><td>${esc(x.name)}</td><td class="n" style="color:${issueColour(nums[k])}">${signed(nums[k])}</td><td>${esc(nearest(x, nums[k])[1])}</td></tr>`; }).join("")}</table>`;
}
/* camps: a pop's Democrats, independents and Republicans each sit in one camp; p.camps is [dem, ind, rep], p.pie is [rep, ind, dem] */
const popCamp = (p) => { if (!p.camps) return null; const share = [p.pie[2], p.pie[1], p.pie[0]], top = share.indexOf(Math.max(...share)); return CAMP.list[p.camps[top]]; };
const popWords = (p) => p.words.concat(popCamp(p) ? [popCamp(p).name] : []).join(", ");
const campLead = (row, side) => { let best = -1; row.forEach((v, i) => { if ((!side || CAMP.list[i].party === side) && (best < 0 || v > row[best])) best = i; }); return best; };
const campBars = (row, total) => SIDES.map((side) => { const mine = CAMP.list.map((c, i) => [c, row[i]]).filter(([c, v]) => c.party === side && v > 0).sort((a, b) => b[1] - a[1]);
  return mine.length ? `<div><div class="ib-h">${PARTIES[side].name}s</div>${mine.map(([c, v]) => mbar(c.name, v / total, c.colour)).join("")}</div>` : ""; }).join("");
function campState(side) {
  if (!map || CAMP.on === side) return;
  CAMP.on = side;
  for (const [id, row] of Object.entries(CAMP.places)) if (id !== "__state") map.setFeatureState(feature(id), { camp: campLead(row, side === "all" ? "" : side) });
}
const layerOf = (id) => (/^(house|senate|congress)-\d+$/.test(id) ? id.split("-")[0] : G.kinds[id] || (IDX.byId[id] ? "county" : /-D\d+$/.test(id) ? "district" : /^[A-Z]{3}-\d+$/.test(id) ? "hood" : "muni"));
const feature = (id) => { const sourceLayer = layerOf(id); return { source: "fl", sourceLayer, id: FAR.has(sourceLayer) ? +id.split("-")[1] : id }; };
function fieldState(i) {
  if (!map || SH.on === i) return;
  SH.on = i;
  for (const [id, row] of Object.entries(SH.places)) map.setFeatureState(feature(id), { val: row[i + 1] / 1000 });
}
/* a far district's own numbers, set once: the same names the tiles give the other layers */
function farState() {
  const f = (k) => shField(k), races = ["White", "Black", "Hispanic", "Asian", "Other"], areas = ["urban", "suburban", "small town", "rural"], top = (keys, id) => keys.reduce((a, b) => (shVal(id, f(b)) > shVal(id, f(a)) ? b : a));
  for (const id of Object.keys(SH.districts)) { const row = SH.places[id]; if (!row) continue;
    map.setFeatureState(feature(id), { pops: row[0], pr: shVal(id, f("R")), pi: shVal(id, f("I")), pd: shVal(id, f("D")), r24: row[row.length - 2] === null ? 0.5 : row[row.length - 2] / 1000, local: row[row.length - 1] / 10, race: top(races, id), area: top(areas, id) }); }
}
function farVotes() {
  for (const [id, hoods] of Object.entries(SH.districts)) { let r = 0, n = 0;
    for (const h of hoods) { const v = VOTE.places[h]; if (v && v[0] !== null) { r += v[0] * v[1]; n += v[1]; } }
    VOTE.places[id] = [n ? Math.round(r / n * 1000) / 1000 : null, Math.round(n)];
    if (map && n) map.setFeatureState(feature(id), { s24: r / n }); }
}
function farPlace(kind, n) { const id = kind + "-" + n, row = SH.places[id] || [0], f = (k) => shVal(id, shField(k));
  return { id, name: SH.names[id] || id, pops: row[0], pr: f("R"), pi: f("I"), pd: f("D"), r24: row.length > 2 && row[row.length - 2] !== null ? row[row.length - 2] / 1000 : null, local: row.length > 2 ? row[row.length - 1] / 10 : 0,
    race: ["White", "Black", "Hispanic", "Asian", "Other"].reduce((a, b) => (f(b) > f(a) ? b : a)), area: ["urban", "suburban", "small town", "rural"].reduce((a, b) => (f(b) > f(a) ? b : a)) }; }
function issueState(k) {
  if (!map || ISS.on === k) return;
  ISS.on = k;
  for (const [id, v] of Object.entries(ISS.places)) if (id !== "__state") map.setFeatureState(feature(id), { iss: v[k] });
}
let map, state = { layer: "hood", shade: "party", selected: null, tab: "overview", ptab: "overview", olevel: "local", county: HOME };

/* ---------- loading ---------- */
function ensure(fips) {
  if (!fips || !IDX.byFips[fips]) return Promise.resolve();
  return (loading[fips] ||= Promise.all([get(`data/game/fl-${fips}.json`), get(`data/pops/fl-${fips}.json`), get(`data/seeds/${SEED}/fl-${fips}.json`), get(`data/seeds/${SEED}/election-2024/fl-${fips}.json`).catch(() => ({ races: [] })),
    get(`data/orgs/fl-${fips}.json`).catch(() => ({ organizations: [], pies: [] })), get(`data/camps/fl-${fips}.json`).catch(() => ({ pops: [] }))]).then(([g, p, s, v, o, k]) => {
    VOTE.local[fips] = v.races;
    Object.assign(G.places, g.places);
    if (o.organizations.length) ORG.list = o.organizations;
    p.pops.forEach((x, i) => { x.pie = [x.pie.R, x.pie.I, x.pie.D]; x.orgs = o.pies[i] || []; x.camps = k.pops[i] || null; (POPS[x.hood] ||= []).push(x); POPID[x.id] = x; });
    Object.assign(S.people, s.people); Object.assign(S.leaders, s.leaders); Object.assign(S.moods, s.moods);
    S.local[fips] = s.seats;
    ORG.chapters[fips] = s.chapters || []; ORG.departments[fips] = s.departments || []; ORG.boards[fips] = s.boards || []; Object.assign(ORG.executives, s.executives || {});
    const post = (pid, text) => (POSTS[pid] ||= []).push(text);
    for (const d of ORG.departments[fips]) post(d.head, `Head of ${d.name}, ${g.places[d.gov].name}`);
    for (const b of ORG.boards[fips]) for (const m of b.members) post(m, `${b.name}, ${g.places[b.gov].name}`);
    for (const c of ORG.chapters[fips]) post(c.leader, `Leads the ${c.name}, ${g.county} County`);
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
  if (POSTS[pid]) return POSTS[pid].join("; ");
  return c.pop ? (S.leaders[c.pop] === pid ? "Speaks for a pop in " : "Lives in ") + c.home : "";
};
const slices = (flat) => { const out = []; for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]); return out; };
/* a character's camp is that of their party's people in their own pop; their camp organization is whichever in their county holds that camp */
const campOf = (c, pop) => (pop && pop.camps && c.party !== "ind" ? CAMP.list[pop.camps[c.party === "dem" ? 0 : 2]] : null);
const clubOf = (c, pop) => { const camp = campOf(c, pop), hood = pop && place(pop.hood); return camp && hood ? (ORG.chapters[hood.fips] || []).find((ch) => ch.camps && ch.camps.includes(camp.id)) : null; };
/* portraits: sex comes from the first name, age from the pop's age band, clothes from the highest office held or else the job */
const NAMESEX = {};
const hash = (text) => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; };
const sexOf = (c) => { const first = c.name.split(" ")[0], s = NAMESEX[first]; return s === "M" || s === "F" ? s : hash(c.id) % 2 ? "M" : "F"; };
const AGES = { "18 to 29": [22, 29], "30 to 44": [30, 44], "45 to 64": [45, 64], "65 and over": [65, 84] };
const ageOf = (c, pop) => { const [a, b] = (pop && AGES[pop.age]) || [38, 72]; return a + hash(c.id + "age") % (b - a + 1); };
const OUTFIT = { farmer: "farm", rancher: "farm", farmworker: "farm", fisherman: "farm", tradesman: "trades", lineman: "trades", mechanic: "trades", construction_worker: "trades", factory_worker: "trades", truck_driver: "trades", warehouse_worker: "trades", custodian: "trades",
  nurse: "health", healthcare_aide: "health", physician: "health", police_officer: "uniform", firefighter: "uniform", corrections_officer: "uniform", restaurant_worker: "service", hospitality_worker: "service", barber: "service", salesperson: "service" };
function dressOf(c) {
  const offices = seatsOf(c.id).map((s) => s.office);
  if (offices.includes("county.sheriff")) return { dress: 0, job: "uniform" };
  const level = offices.reduce((a, o) => Math.max(a, /^us\.|^fl\.(governor|lieutenant_governor|attorney_general|chief_financial_officer|agriculture)/.test(o) ? 4 : /^fl\./.test(o) ? 3 : 2), 0);
  if (level) return { dress: level, job: "office" };
  const job = OUTFIT[(c.traits || [])[2]];
  return job ? { dress: 0, job } : { dress: 1, job: "office" };
}
function face(c, pop, size) {
  if (typeof portrait !== "function") return "";
  return portraitSvg(portrait(hash(c.id), { sex: sexOf(c), age: ageOf(c, pop), race: c.race || (pop && pop.race) || undefined, build: (hash(c.id + "build") % 200) / 100 - 1, party: c.party, mood: 0, ...dressOf(c) }), size);
}
const joined = (pop) => ORG.kinds.map(([kind]) => slices(pop.orgs).filter(([i]) => ORG.list[i][2] === kind).sort((a, b) => b[1] - a[1])[0]).filter(Boolean).map(([i]) => ORG.list[i][1]);
function orgBars(ps, most) {
  const sum = {};
  ps.forEach((p) => slices(p.orgs).forEach(([i, n]) => { sum[i] = (sum[i] || 0) + n; }));
  const rows = Object.entries(sum).sort((a, b) => b[1] - a[1]).slice(0, most);
  return rows.map(([i, n]) => mbar(ORG.list[i][1], n / (ps.length * 100 || 1))).join("");
}
/* ---------- opinion: -100 to 100, a list of reasons. Only what exists before anyone acts: stats, traits, where they live, party. ---------- */
const AUD = { everyone: () => true, no_college: (p) => p.education === "No college", college: (p) => p.education === "Bachelor's or more", low_income: (p) => p.income === "Under $35,000", high_income: (p) => p.income === "Over $150,000",
  rural: (p) => p.area === "rural", small_town: (p) => p.area === "small town", urban: (p) => p.area === "urban", suburban: (p) => p.area === "suburban", young: (p) => p.age === "18 to 29", old: (p) => p.age === "65 and over",
  farm: (p) => p.work === "Farm and ranch", blue_collar: (p) => BOOK.dials.blue.includes(p.work), service: (p) => p.work === "Shops and service", government: (p) => p.work === "Government and military" };
function knownTo(c, pop) {
  const a = c.known_in, h = place(pop.hood);
  if (!a || a === "Elsewhere") return false;
  return a === "state" || a === "country" || a === pop.hood || (h ? covers({ area: a }, h) : false);
}
function popOpinion(pop, c) {
  const d = BOOK.dials;
  if (!d || !c || !c.traits) return null;
  const reach = d.unknown + (1 - d.unknown) * (c.known / 100) * (knownTo(c, pop) ? 1 : d.elsewhere), rows = [], side = ORDER.indexOf(c.party);
  for (const [k, per] of Object.entries(d.stat)) if (c.stats[k]) rows.push([`${BOOK.stats[k]} ${c.stats[k]}`, c.stats[k] * per * reach * d.opinion]);
  for (const t of c.traits) {
    let v = 0;
    for (const [aud, w] of Object.entries(BOOK.likes[t] || {})) v += w * (aud === "base" ? pop.pie[side] : aud === "independents" ? pop.pie[1] : aud === "same_race" ? +(pop.race === c.race) : aud === "against_incumbent" ? 0 : +AUD[aud](pop));
    if (v) rows.push([BOOK.traits[t], v * reach * d.opinion]);
  }
  const mine = place(pop.hood), theirs = place(c.home);
  if (c.home === pop.hood) rows.push(["Lives in this neighbourhood", d.home_hood * d.opinion]);
  if (mine && theirs && mine.fips === theirs.fips && mine.district === theirs.district) rows.push(["Lives in this commission district", d.home_area * d.opinion]);
  rows.push([`${pct(pop.pie[side])} of the pop is ${PARTIES[c.party].name}`, d.party * (pop.pie[side] - 1 / 3)]);
  return opinion(rows, `Known here: ${pct(reach)} of their appeal lands`);
}
function between(a, b, rivals) {
  const d = BOOK.dials, rows = [];
  if (!d || !a || !b) return null;
  if (a.party === b.party) rows.push(["Same party", d.same_party]);
  if (a.home === b.home && place(a.home)) rows.push(["Same neighbourhood", d.same_hood]);
  for (const t of a.traits || []) if (t in BOOK.personality) {
    if ((b.traits || []).includes(t)) rows.push(["Both " + BOOK.traits[t], d.same_trait]);
    else if (BOOK.personality[t] && (b.traits || []).includes(BOOK.personality[t])) rows.push([`${BOOK.traits[t]} against ${BOOK.traits[BOOK.personality[t]]}`, d.opposed_trait]);
  }
  if (rivals) rows.push(["Ran for the same seat", d.same_seat]);
  return opinion(rows);
}
function opinion(rows, note) {
  rows = rows.map(([t, v]) => [t, Math.round(v)]).filter((r) => r[1]).sort((x, y) => y[1] - x[1]);
  const total = Math.max(-100, Math.min(100, rows.reduce((s, r) => s + r[1], 0))), sign = (v) => (v > 0 ? "+" : "") + v;
  return `<details class="op"><summary><b class="${total >= 0 ? "pos" : "neg"}">${sign(total)}</b></summary>${rows.map(([t, v]) => `<div class="${v > 0 ? "pos" : "neg"}"><span>${sign(v)}</span>${esc(t)}</div>`).join("")}${note ? `<div class="pt">${esc(note)}</div>` : ""}</details>`;
}
const popName = (p) => `${p.race}, ${p.age}, ${p.education.toLowerCase()}`;
const popLink = (p) => `<button class="lk" data-pop="${esc(p.id)}">${esc(popName(p))}</button>`;
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
const split = (value, span) => ["interpolate", ["linear"], value, ...stops("o", [7, 5, 3, 1].map((i) => [-span * i / 7, i])), 0, css("--m0"), ...stops("c", [1, 3, 5, 7].map((i) => [span * i / 7, i]))];
const match = (field, table) => ["match", ["get", field], ...Object.entries(table).flat(), "#ffffff"];
function shadeOf(kind) {
  const s = state.shade, n = (k) => (FAR.has(kind) ? ["coalesce", ["feature-state", k], k === "race" || k === "area" ? "" : 0] : ["get", k]);
  const fi = s.startsWith("f_") ? +s.slice(2) : -1;
  const margin = (a, b, c) => ["-", n(a), ["max", n(b), n(c)]];
  const by = (ramp, a, b, c, list) => ["interpolate", ["linear"], margin(a, b, c), ...stops(ramp, list)];
  const colour = fi >= 0 ? grey(["coalesce", ["feature-state", "val"], 0], SH.fields[fi].top / 1000) : s === "party" ? ["case", ["all", [">=", n("pr"), n("pi")], [">=", n("pr"), n("pd")]], by("r", "pr", "pi", "pd", [[0, 1], [0.1, 3], [0.25, 5], [0.45, 7]]),
    [">=", n("pd"), n("pi")], by("d", "pd", "pi", "pr", [[0, 1], [0.1, 3], [0.25, 5], [0.45, 7]]), by("g", "pi", "pr", "pd", [[0, 1], [0.1, 2], [0.25, 3], [0.45, 4]])]
    : s.startsWith("camp_") ? ["match", ["coalesce", ["feature-state", "camp"], -1], ...CAMP.list.flatMap((c, i) => [i, c.colour]), "#ffffff"]
    : s.startsWith("iss_") ? ["case", ["==", ["feature-state", "iss"], null], "#ffffff", split(["feature-state", "iss"], 60)]
    : s === "r2024" ? ["case", ["==", ["feature-state", "s24"], null], "#ffffff", diverge(["-", ["feature-state", "s24"], 0.5], 0.3)] : s === "real" ? diverge(["-", n("r24"), 0.5], 0.3) : s === "local" ? diverge(n("local"), 15) : s === "race" ? ["match", n("race"), ...Object.entries(RACE_COL).flat(), "#ffffff"] : s === "area" ? ["match", n("area"), ...Object.entries(AREA_COL).flat(), "#ffffff"]
    : grey(n("pops"), MOST[kind]);
  return ["case", ["==", n("pops"), 0], "#ffffff", colour];
}
/* what the map is shading by, for one place: shown when the pointer is over it */
function shown(p) {
  const s = state.shade, rd = (x) => `<span style="color:${PARTIES[x >= 0.5 ? "rep" : "dem"].colour}">${x >= 0.5 ? "R" : "D"} ${pct(Math.max(x, 1 - x))}</span>`, v = VOTE.places[p.id];
  const k = s.startsWith("iss_") ? +s.slice(4) : -1, iv = k >= 0 && ISS.places[p.id] ? ISS.places[p.id][k] : null;
  const cs = s.startsWith("camp_") ? s.slice(5) : "", crow = cs && CAMP.places[p.id], ci = crow ? campLead(crow, cs === "all" ? "" : cs) : -1;
  const ctotal = crow ? crow.reduce((a, v, i) => a + (cs === "all" || CAMP.list[i].party === cs ? v : 0), 0) : 0;
  const fx = s.startsWith("f_") ? +s.slice(2) : -1;
  const text = fx >= 0 ? (shVal(p.id, fx) === null ? "" : `${esc(SH.fields[fx].label)} ${pct(shVal(p.id, fx))}`) : cs ? (ci < 0 ? "" : `${esc(CAMP.list[ci].name)} ${pct(crow[ci] / ctotal)}`) : k >= 0 ? (iv === null ? "" : `${esc(ISS.list[k].name)} <span style="color:${issueColour(iv)}">${signed(iv)}</span> · ${esc(nearest(ISS.list[k], iv)[1])}`) : s === "party" ? "Party ID " + lead([p.pr, p.pi, p.pd]) : s === "r2024" ? (v && v[0] !== null ? "President, 2024 " + rd(v[0]) : "") : s === "real" ? "Real 2024 " + rd(p.r24) : s === "local" ? "Local lean " + lean(p.local)
    : s === "race" ? "Largest group " + esc(p.race) : s === "area" ? "Area type " + esc(p.area) : s === "pops" ? ""  : "";
  return p.pops && text ? "<br>" + text : "";
}
function legend() {
  const s = state.shade, bar = (cols, a, b) => `<div class="bar">${cols.map((c) => `<span style="background:${c}"></span>`).join("")}</div><div class="ends"><span>${a}</span><span>${b}</span></div>`;
  const dv = [7, 5, 3, 1].map((i) => css("--d" + i)).concat([1, 3, 5, 7].map((i) => css("--r" + i))), gr = [0, 1, 2, 3, 4, 5, 6].map((i) => css("--g" + i));
  const cat = (table) => `<div class="cat">${Object.entries(table).map(([k, c]) => `<span><i style="background:${c}"></i>${esc(k[0].toUpperCase() + k.slice(1))}</span>`).join("")}</div>`;
  const ik = s.startsWith("iss_") ? ISS.list[+s.slice(4)] : null;
  const cside = s.startsWith("camp_") ? s.slice(5) : "";
  const lf = s.startsWith("f_") ? SH.fields[+s.slice(2)] : null;
  const title = lf ? lf.label : cside ? { all: "Largest camp", dem: "Largest camp among Democrats", rep: "Largest camp among Republicans", ind: "Largest camp among independents" }[cside] : ik ? ik.name : { party: "Party ID", r2024: "President, 2024", real: "Real 2024", local: "Local lean", race: "Largest group", area: "Area type", pops: "Pops", ba: "Bachelor's degree", old: "Age 65 and over", income: "Income under $35,000" }[s] || "Share " + s.slice(5);
  const party = () => ORDER.map((k) => `<div class="prow"><span>${PARTIES[k].letter}</span><div class="bar">${(k === "ind" ? [1, 2, 3, 4] : [1, 3, 5, 7]).map((i) => `<span style="background:${css("--" + PARTIES[k].ramp + i)}"></span>`).join("")}</div></div>`).join("") + `<div class="ends"><span>Narrow lead</span><span>Wide lead</span></div>`;
  const body = cside ? cat(Object.fromEntries(CAMP.list.filter((c) => cside === "all" || c.party === cside).map((c) => [c.name, c.colour]))) : ik ? bar([7, 5, 3, 1].map((i) => css("--c" + i)).concat([1, 3, 5, 7].map((i) => css("--o" + i))), esc(ik.stops[0][1]), esc(ik.stops[ik.stops.length - 1][1])) : s === "party" ? party() : s === "r2024" || s === "real" || s === "local" ? bar(dv, "Democratic", "Republican") : s === "race" ? cat(RACE_COL) : s === "area" ? cat(AREA_COL) : bar(gr, "Fewer", "More");
  $("legend").innerHTML = `<div class="t">${title}</div>${body}`;
}
function paint() {
  if (!map || !map.getLayer("fill-hood")) return;
  if (state.shade.startsWith("iss_")) issueState(+state.shade.slice(4));
  if (state.shade.startsWith("camp_")) campState(state.shade.slice(5));
  if (state.shade.startsWith("f_")) fieldState(+state.shade.slice(2));
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
  if (tab === "issues") return ISS.places[q.id] ? issueTable(ISS.places[q.id]) : "";
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
    const camps = CAMP.places[q.id] ? `<div class="ib-h">Camps</div><div class="cols">${campBars(CAMP.places[q.id], 1000)}</div>` : "";
    const heads = { rep: 0, ind: 0, dem: 0 }, n = ps.length || 1;
    ps.forEach((p) => heads[S.people[S.leaders[p.id]].party]++);
    return `<table><tr><th>Party ID</th><td>${lead(q.party)}</td></tr><tr><th>President, 2024</th><td>${result(q.id)}</td></tr><tr><th>Expected turnout</th><td>${pct(q.turnout)}</td></tr></table>${camps}
      <div class="ib-h">Party ID</div>${partyBars(q.party)}
      <div class="ib-h">Mood</div><table class="mini">${["federal", "state", "local"].map((l) => { const c = {}; ps.forEach((p) => { const m = S.moods[p.id][l]; c[m] = (c[m] || 0) + 1; });
        return `<tr><td>${l[0].toUpperCase() + l.slice(1)}</td><td><span class="pie wide">${Object.keys(MOOD_COL).map((m) => `<i style="width:${(c[m] || 0) / n * 100}%;background:${MOOD_COL[m]}"></i>`).join("")}</span></td><td class="pt">${Object.keys(MOOD_COL).filter((m) => c[m]).map((m) => `${m} ${num(c[m])}`).join(", ")}</td></tr>`; }).join("")}</table>
      <div class="ib-h">Pop leaders</div>${partyBars(ORDER.map((k) => heads[k] / n))}
      <div class="ib-h">Organizations, share of people</div>${orgBars(ps, wide ? 14 : 6)}`;
  }
  return seatTable(seatsOver(q), wide);
}
function seatTable(seats, wide) {
  const groups = {};
  const head = (s) => s.government === "federal" ? "United States" : !s.county ? "State of " + G.state : s.government === "county" || s.office === "fl.county_judge" ? s.county + " County"
    : s.government === "city" ? "City of " + (place(s.area) || {}).name : s.government === "school" ? s.county + " County School District" : s.county + " County, other districts";
  seats.forEach((s) => (groups[head(s)] ||= []).push(s));
  return Object.entries(groups).map(([g, list]) => `<div class="ib-h">${esc(g)}</div><table class="mini${wide ? " wide" : ""}">${list.map((s) =>
    `<tr><td>${esc(s.title)}${s.label ? ` <span class="pt">${esc(s.label)}</span>` : ""}${s.chair ? ' <span class="pt">Chair</span>' : ""}</td><td>${who(s.holder)}</td>${wide ? `<td class="pt">${s.chosen === "elected" ? (s.partisan ? "Elected by party" : "Elected, no party") : "Appointed"}</td><td class="n">${s.next.join(", ")}</td>` : ""}</tr>`).join("")}</table>`).join("");
}
function relations(id) {
  const c = S.people[id], links = [];
  if (c.after) links.push([c.after, "Led this pop before", false]);
  if (c.heir) links.push([c.heir, "Leads their old pop", false]);
  for (const r of VOTE.wide.concat(...Object.values(VOTE.local))) if (r.cands.length === 2 && r.cands.some((x) => x.id === id)) links.push([r.cands.find((x) => x.id !== id).id, `Opponent for ${r.title}${r.label ? ", " + r.label : ""}, 2024`, true]);
  const rows = links.filter(([pid]) => S.people[pid]).map(([pid, what, rivals]) => `<tr><td>${who(pid)}</td><td class="pt">${esc(what)}</td><td>${between(c, S.people[pid], rivals) || ""}</td></tr>`).join("");
  return rows ? `<h2>Relations</h2><table class="wt"><tr><th>Character</th><th></th><th>Opinion of each other</th></tr>${rows}</table>` : "";
}
function appointed(fips) {
  const govs = [...new Set(ORG.departments[fips].map((d) => d.gov))];
  return govs.map((gov) => {
    const q = place(gov), officers = q.kind === "county" ? S.local[fips].filter((s) => OFFICERS[s.office]) : [];
    const rows = officers.map((s) => `<tr><td>${esc(s.title)}</td><td class="pt">${OFFICERS[s.office]}</td><td>${who(s.holder)}</td><td class="pt">Elected</td><td></td></tr>`)
      .concat(ORG.departments[fips].filter((d) => d.gov === gov).map((d) => `<tr><td>${esc(d.name)}</td><td class="pt">${d.functions.map((f) => FUNCTION[f]).join(", ")}</td><td>${who(d.head)}</td><td class="pt">${d.hired ? "Hired from within" : "Appointed"}</td><td class="n">${d.skill}</td></tr>`));
    const boards = ORG.boards[fips].filter((b) => b.gov === gov).map((b) => `<tr><td>${esc(b.name)}</td><td>${b.members.map(who).join(", ")}</td></tr>`).join("");
    return `<div class="ib-h">${esc(q.name)} · named by ${who(ORG.executives[gov])}</div><table class="mini wide"><tr><th>Department</th><th>Covers</th><th>Head</th><th></th><th>Skill</th></tr>${rows.join("")}</table>
      ${boards ? `<table class="mini wide"><tr><th>Board</th><th>Members</th></tr>${boards}</table>` : ""}`;
  }).join("");
}
function popTable(all) {
  const ps = all.slice(0, 300), more = all.length > ps.length ? `<p class="pt">First ${ps.length} of ${num(all.length)} pops</p>` : "";
  return `<table class="wt"><tr><th>Pop</th><th>Neighbourhood</th><th>Leader</th><th>Work</th><th>Party ID</th><th>Turnout</th><th>Mood, local</th></tr>${ps.map((p) =>
    `<tr><td>${popLink(p)}<span class="pt">${esc(popWords(p))}</span></td><td>${placeLink(p.hood)}</td><td>${who(S.leaders[p.id])}</td><td>${esc(p.work)}</td><td>${pie(p.pie)}${lead(p.pie)}</td><td class="n">${pct(p.turnout)}</td><td>${mood(p.id, "local")}</td></tr>`).join("")}</table>${more}`;
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
  $("tip").hidden = true;
  show(view);
  const here = IDX.byFips[state.county];
  if (["voters", "elections", "officials", "groups", "issues"].includes(view)) await ensure(state.county);
  if (view === "place" || view === "pop") await ensure(fipsOfPlace(id));
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
      <p>${countyPicker("pcounty", state.county)}</p><div class="ib-body">${seatTable(seats, true)}</div>${level === "local" ? `<h2>Departments and boards</h2><div class="ib-body">${appointed(state.county)}</div>` : ""}${soon("office")}${soon("history")}`);
    pickCounty("pcounty");
  } else if (view === "groups") {
    const people = county.pops * 100, all = ORG.chapters[state.county];
    page(`<h1>Organizations</h1><div class="from">${esc(here.name)} · ${all.length} chapters · seed ${S.seed}</div><p>${countyPicker("pcounty", state.county)}</p>
      ${ORG.kinds.map(([kind, label]) => { const rows = all.filter((c) => c.kind === kind).sort((a, b) => b.members - a.members);
        return `<h2>${label}</h2><table class="wt"><tr><th>Organization</th><th>Members</th><th>Share of people</th><th>Leader</th><th>Leadership vote</th></tr>${rows.map((c) =>
          `<tr><td>${esc(c.name)}${c.camps && c.camps.length > 1 ? `<div class="pt">${c.camps.map((id) => esc((CAMP.list.find((x) => x.id === id) || {}).name || id)).join(", ")}</div>` : ""}</td><td class="n">${num(c.members)}</td><td class="n">${pct(c.members / people)}</td><td>${who(c.leader)}</td><td>${c.vote.map(([pid, v]) => `${who(pid)} <span class="pt" style="display:inline">${num(v)}</span>`).join(" · ")}</td></tr>`).join("")}</table>`; }).join("")}`);
    pickCounty("pcounty");
  } else if (view === "issues") {
    const fl = ISS.places.__state || [], co = ISS.places[here.id] || [], LV = ["Local", "State", "National"]; let last = "";
    const cell = (v) => (v === undefined ? "" : `<span style="color:${issueColour(v)}">${signed(v)}</span>`);
    page(`<h1>Issues</h1><div class="from">${ISS.list.length} issues · ${esc(G.state)} and ${esc(here.name)}</div><p>${countyPicker("pcounty", state.county)}</p>
      <table class="wt isspage"><tr><th>Issue</th><th>Positions</th><th class="n">Nation</th><th class="n">${esc(G.state)}</th><th class="n">${esc(here.name.replace(/ County$/, ""))}</th></tr>${ISS.list.map((x, k) => {
        const head = x.category === last ? "" : `<tr class="cat"><td colspan="5">${esc(x.category)}</td></tr>`; last = x.category;
        const who = (i) => ["dem", "ind", "rep"].filter((p) => (ISS.usual[p] || [])[k] === i).map((p) => `<b style="color:${PARTIES[p].colour}">${PARTIES[p].letter}</b>`).join("");
        const near = [fl[k], co[k]].map((v) => (v === undefined ? null : nearest(x, v)));
        return `${head}<tr><td><b>${esc(x.name)}</b><div class="pt">${x.weights.map((w, i) => (w ? LV[i] + " " + w : "")).filter(Boolean).join(" · ")}</div></td>
          <td>${x.stops.map((st, i) => `<div class="stop${near[1] === st ? " at" : ""}"><span class="sv" style="color:${issueColour(st[0])}">${signed(st[0])}</span>${esc(st[1])} ${who(i)}</div>`).join("")}</td>
          <td class="n pt">–</td><td class="n">${cell(fl[k])}</td><td class="n">${cell(co[k])}</td></tr>`; }).join("")}</table>`);
    pickCounty("pcounty");
  } else if (view === "stats") {
    page(`<h1>Stats</h1><div class="from">State of ${esc(G.state)}</div>${ISS.places.__state ? "<h2>Issues</h2>" + issueTable(ISS.places.__state) : ""}${soon("services")}${soon("bills")}${soon("issues")}`);
  } else if (view === "soon" && SOON[id]) {
    page(`<h1>${esc(SOON[id][0])}</h1>${soon(id)}`);
  } else if (view === "place" && place(id)) {
    const q = place(id), up = q.kind === "county" ? [] : [q.county];
    if (q.kind === "hood") up.push(q.code + "-D" + q.district);
    page(`<div class="crumbs"><button class="back" data-go="#/map">Map</button>${up.map((u) => placeLink(u)).join(" › ")}</div><h1>${esc(q.name)}</h1><div class="from">${esc(q.sub)}</div>
      <div class="tabs2" role="tablist">${TABS.map(([k, l]) => `<button role="tab" aria-selected="${state.ptab === k}" data-ptab="${k}">${l}</button>`).join("")}</div><div class="ib-body">${placeTab(q, state.ptab, true)}</div>`);
    document.querySelectorAll("[data-ptab]").forEach((b) => b.onclick = () => { state.ptab = b.dataset.ptab; route(); });
  } else if (view === "pop" && POPID[id]) {
    const p = POPID[id], hood = place(p.hood), boss = S.leaders[p.id], seen = new Set([boss]);
    const pies = ORG.kinds.filter(([k]) => k !== "party").map(([kind, label]) => { const mine = slices(p.orgs).filter(([i]) => ORG.list[i][2] === kind).sort((a, b) => b[1] - a[1]), out = 100 - mine.reduce((s, x) => s + x[1], 0);
      return `<div><div class="ib-h">${label}</div>${mine.map(([i, n]) => mbar(ORG.list[i][1], n / 100)).join("")}${mbar("Uninvolved", out / 100, "var(--g2)")}</div>`; }).join("");
    const rows = [[boss, "Leads this pop"]].concat(seatsOver(hood).filter((s) => !seen.has(s.holder) && seen.add(s.holder)).map((s) => [s.holder, s.title + (s.label ? ", " + s.label : "")]))
      .filter(([pid]) => S.people[pid] && S.people[pid].traits).map(([pid, what]) => `<tr><td>${who(pid)}</td><td class="pt">${esc(what)}</td><td>${popOpinion(p, S.people[pid])}</td></tr>`).join("");
    page(`<div class="crumbs"><button class="back" data-go="#/map">Map</button>${placeLink(hood.county)} › ${placeLink(hood.id)}</div><h1>${esc(popName(p))}</h1><div class="from">A pop of 100 people in ${esc(hood.name)} · ${esc(popWords(p))}</div>
      <table class="facts"><tr><th>Leader</th><td><div style="display:flex;gap:10px;align-items:center">${S.people[boss] ? face(S.people[boss], p, 44) : ""}${who(boss)}</div></td></tr><tr><th>Neighbourhood</th><td>${placeLink(hood.id)}</td></tr><tr><th>Work</th><td>${esc(p.work)}</td></tr><tr><th>Household income</th><td>${esc(p.income)}</td></tr>
      <tr><th>Area type</th><td>${esc(p.area)}</td></tr><tr><th>Party ID</th><td>${pie(p.pie)}${lead(p.pie)}</td></tr><tr><th>Expected turnout</th><td>${pct(p.turnout)}</td></tr>
      <tr><th>Mood</th><td>${["federal", "state", "local"].map((l) => `${l[0].toUpperCase() + l.slice(1)} ${mood(p.id, l)}`).join(" · ")}</td></tr></table>
      <h2>Organizations</h2><div class="cols">${pies}</div>
      ${p.camps ? `<h2>Camps</h2><div class="cols">${campBars(CAMP.list.map((c, i) => SIDES.reduce((a, side, n) => a + (p.camps[n] === i ? [p.pie[2], p.pie[1], p.pie[0]][n] : 0), 0)), 1)}</div>` : ""}
      <h2>Issues</h2>${ISS.list.length ? issueTable(popIssues(p)) : ""}
      <h2>Opinions</h2><table class="wt"><tr><th>Character</th><th></th><th>Opinion</th></tr>${rows}</table>${soon("known")}`);
  } else if (view === "person" && S.people[id]) {
    const c = S.people[id], seats = seatsOf(id), pop = c.pop && (POPS[c.home] || []).find((p) => p.id === c.pop);
    page(`<div class="crumbs"><button class="back" data-go="#/map">Map</button></div><div class="facehead">${face(c, pop, 120)}<div><h1 class="who ${c.party}" style="text-decoration:none;cursor:default;display:block">${esc(c.name)}</h1><div class="from">${esc(role(id))}</div>
      <table class="facts"><tr><th>Party</th><td>${PARTIES[c.party].name}</td></tr><tr><th>Home</th><td>${place(c.home) ? placeLink(c.home) : esc(c.home)}</td></tr>
      ${c.known !== undefined ? `<tr><th>Name ID</th><td><b>${c.known}</b>${place(c.known_in) ? ` <span class="pt">known in ${esc(place(c.known_in).name)}</span>` : c.known_in === "state" ? ' <span class="pt">known across the state</span>' : c.known_in === "country" ? ' <span class="pt">known across the country</span>' : ""}</td></tr>` : ""}
      ${(POSTS[id] || []).map((t) => `<tr><th>Post</th><td>${esc(t)}</td></tr>`).join("")}${c.hired ? `<tr><th>Hired</th><td>From within ${esc(c.hired)}</td></tr>` : ""}
      ${c.after && S.people[c.after] ? `<tr><th>Took over from</th><td>${who(c.after)}</td></tr>` : ""}${c.heir && S.people[c.heir] ? `<tr><th>Pop now led by</th><td>${who(c.heir)}</td></tr>` : ""}
      ${pop ? `<tr><th>${S.leaders[pop.id] === id ? "Speaks for" : "Home pop"}</th><td>${popLink(pop)} <span class="pt">${esc(popWords(pop))}</span></td></tr>${c.traits ? `<tr><th>Its opinion</th><td>${popOpinion(pop, c)}</td></tr>` : ""}<tr><th>Work</th><td>${esc(pop.work)}</td></tr>
      <tr><th>Mood</th><td>${["federal", "state", "local"].map((l) => `${l[0].toUpperCase() + l.slice(1)} ${mood(pop.id, l)}`).join(" · ")}</td></tr>
      <tr><th>Belongs to</th><td>${joined(pop).concat(c.party === "ind" ? [] : [c.party === "rep" ? "Republican Party" : "Democratic Party"]).concat(clubOf(c, pop) ? [clubOf(c, pop).name] : []).map(esc).join(", ")}</td></tr>${campOf(c, pop) ? `<tr><th>Camp</th><td>${esc(campOf(c, pop).name)}</td></tr>` : ""}` : ""}
      ${seats.map((s) => `<tr><th>Office</th><td>${esc(s.title)}${s.label ? ", " + esc(s.label) : ""}${s.next.length ? ` <span class="pt">next election ${s.next.join(", ")}</span>` : ""}</td></tr>`).join("")}
      ${c.ran ? `<tr><th>Ran for</th><td>${esc(c.ran)}</td></tr>` : ""}
      <tr><th>Seed</th><td>${S.seed}</td></tr></table></div></div><h2>Character</h2>
      ${c.traits ? `<table class="facts"><tr><th>Stats</th><td>${Object.entries(c.stats).map(([k, v]) => `${esc(BOOK.stats[k] || k)} <b>${v}</b>`).join(" · ")}</td></tr><tr><th>Traits</th><td>${c.traits.map((t) => `<span class="trait">${esc(BOOK.traits[t] || t)}</span>`).join(" ")}</td></tr></table>` : ""}${relations(id)}${soon("you")}${soon("known")}${soon("intrigue")}`);
  }
}

/* ---------- start ---------- */
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);
Promise.all([get("data/game/fl-index.json"), get(`data/seeds/${SEED}/fl-state.json`), get(`data/seeds/${SEED}/election-2024/map.json`).catch(() => ({})),
  get(`data/seeds/${SEED}/election-2024/fl-state.json`).catch(() => ({ races: [], summary: null })), get("data/traits.json").catch(() => ({ stats: {}, traits: {} })),
  get("data/issues.json").catch(() => ({ issues: [], usual: {}, places: {} })), get("data/camps.json").catch(() => ({ camps: [], places: {} })),
  get("data/shades.json").catch(() => ({ fields: [], places: {}, districts: {}, names: {} })),
  get("data/names.json").catch(() => ({ first: {} }))]).then(async ([index, top, shares, wide, book, issues, camps, shades, names]) => {
  for (const [key, list] of Object.entries(names.first)) for (const [n] of list) NAMESEX[n] = NAMESEX[n] && NAMESEX[n] !== key[0] ? "?" : key[0];
  Object.assign(SH, shades, { on: -1 });
  const menuOf = (groups) => SH.fields.flatMap((f, i) => (groups.includes(f.group) ? [[f, i]] : [])).flatMap(([f, i], n, all) => (n === 0 || all[n - 1][0].group !== f.group ? (n ? [null] : []).concat([["", f.heading]]) : []).concat([["f_" + i, f.label]]));
  if (SH.fields.length) {
    SHADES.find((x) => x.id === "race").menu = [["race", "Largest group"], null].concat(menuOf(["race"]).slice(1));
    SHADES.find((x) => x.id === "demo").menu = [["pops", "Pops"], ["area", "Area type"], null].concat(menuOf(["age", "education", "income", "area", "home", "vote"]));
    SHADES.find((x) => x.id === "work").menu = menuOf(["work"]).slice(1);
  }
  CAMP.list = camps.camps; CAMP.places = camps.places;
  ISS.list = issues.issues; ISS.usual = issues.usual; ISS.places = issues.places;
  if (ISS.list.length) { let last = ""; SHADES.find((x) => x.id === "issues").menu = ISS.list.flatMap((x, k) => { const head = x.category === last ? [] : (last ? [null] : []).concat([["", x.category]]); last = x.category; return head.concat([["iss_" + k, x.name]]); }); }
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
    map.addSource("fl", { type: "vector", url: "pmtiles://" + new URL("tiles/game-fl.pmtiles", location.href).href, promoteId: { hood: "id", district: "id", muni: "id", county: "id", house: "n", senate: "n", congress: "n" } });
    farState(); farVotes();
    for (const [id, v] of Object.entries(VOTE.places)) if (v[0] !== null && id !== "__state") map.setFeatureState(feature(id), { s24: v[0] });
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
      if (!FAR.has(kind)) map.on("click", "fill-" + kind, async (e) => { const p = e.features[0].properties; await ensure(p.fips); state.selected = p.id; paint(); infobox(); });
      map.on("mousemove", "fill-" + kind, (e) => { const p = FAR.has(kind) ? farPlace(kind, e.features[0].properties.n) : e.features[0].properties;
        tip(`<b>${esc(p.name)}</b>${kind === "county" || FAR.has(kind) ? "" : "<br>" + esc(IDX.byFips[p.fips].name)}<br>${num(p.pops)} pops${shown(p)}`, e.originalEvent); map.getCanvas().style.cursor = FAR.has(kind) ? "" : "pointer"; });
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
$("hback").onclick = () => history.back();
$("hfwd").onclick = () => history.forward();
document.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  document.querySelectorAll(".ddmenu").forEach((m) => { if (!t || t.dataset.menu !== m.id.slice(2)) m.hidden = true; });
  $("tip").hidden = true;
  if (!t) return;
  if (t.dataset.menu) { const m = $("m-" + t.dataset.menu); m.hidden = !m.hidden; }
  if (t.dataset.view) location.hash = "#/" + t.dataset.view;
  if (t.dataset.go) location.hash = t.dataset.go;
  if (t.dataset.href) location.href = t.dataset.href;
  if (t.dataset.place) location.hash = "#/place/" + encodeURIComponent(t.dataset.place);
  if (t.dataset.pid) location.hash = "#/person/" + t.dataset.pid;
  if (t.dataset.pop) location.hash = "#/pop/" + encodeURIComponent(t.dataset.pop);
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
    .map((r) => `<button data-pid="${r[0]}"><span class="who ${r[2]}" style="text-decoration:none">${esc(r[1])}</span><span class="k">${esc(r[3] || (r[4] ? "Lives in " + r[4] : PARTIES[r[2]].name))}</span></button>`);
  box.innerHTML = places.concat(people).join("") || `<button disabled>Nothing found</button>`;
  box.hidden = false;
};

/* ---------- the world panel: shifts that move pops before the vote, recounted here for the presidential race ---------- */
const WORLD = { data: null, shifts: {}, groups: [
  ["Lean", "lean", [["everyone", "Everyone"]]],
  ["Lean by race", "lean", [["race:White", "White"], ["race:Black", "Black"], ["race:Hispanic", "Hispanic"], ["race:Asian", "Asian"], ["race:Other", "Other"]]],
  ["Lean by area", "lean", [["area:urban", "Urban"], ["area:suburban", "Suburban"], ["area:small town", "Small town"], ["area:rural", "Rural"]]],
  ["Lean by age", "lean", [["age:18 to 29", "18 to 29"], ["age:30 to 44", "30 to 44"], ["age:45 to 64", "45 to 64"], ["age:65 and over", "65 and over"]]],
  ["Lean by education", "lean", [["education:No college", "No college"], ["education:Some college", "Some college"], ["education:Bachelor's or more", "Degree"]]],
  ["Lean by party", "lean", [["party:republicans", "Republicans"], ["party:independents", "Independents"], ["party:democrats", "Democrats"]]],
  ["Turnout", "turnout", [["everyone", "Everyone"], ["age:18 to 29", "18 to 29"], ["age:65 and over", "65 and over"], ["race:Black", "Black"], ["race:Hispanic", "Hispanic"], ["party:republicans", "Republicans"], ["party:independents", "Independents"], ["party:democrats", "Democrats"]]],
] };
const WORDS = { everyone: "everyone", white: "race:White", black: "race:Black", hispanic: "race:Hispanic", asian: "race:Asian", other: "race:Other", urban: "area:urban", suburban: "area:suburban", town: "area:small town", rural: "area:rural",
  young: "age:18 to 29", old: "age:65 and over", college: "education:Bachelor's or more", nocollege: "education:No college", republicans: "party:republicans", independents: "party:independents", democrats: "party:democrats" };
async function worldData() {
  if (WORLD.data) return WORLD.data;
  const [meta, buf] = await Promise.all([get(`data/seeds/${SEED}/election-2024/pops.json`), fetch(`data/seeds/${SEED}/election-2024/pops.bin`).then((r) => r.arrayBuffer())]);
  const types = { uint16: Uint16Array, int16: Int16Array, uint8: Uint8Array, int8: Int8Array };
  let at = 0;
  for (const [name, type] of meta.columns) { meta[name] = new types[type](buf, at, meta.n); at += meta.n * types[type].BYTES_PER_ELEMENT; }
  return (WORLD.data = meta);
}
async function recount() {
  const d = await worldData(), n = d.n, H = d.hoods.length, R = new Float64Array(H), D = new Float64Array(H);
  const list = Object.entries(WORLD.shifts).map(([key, v]) => { const [kind, who] = key.split("|"), [field, value] = who.split(":"); return { kind, field, code: field === "party" || field === "everyone" ? value : d.lists[field].indexOf(value), v }; }).filter((x) => x.v);
  const fired = { republicans: 0, independents: 0, democrats: 0 };
  list.filter((x) => x.kind === "turnout" && x.field === "party").forEach((x) => { fired[x.code] += x.v; });
  const width = { race: 7, age: 3, education: 3, area: 3, income: 3, work: 15 };
  for (let i = 0; i < n; i++) {
    const r = d.r[i] / 255, ind = d.i[i] / 255, dem = Math.max(0, 1 - r - ind);
    let move = 0, more = 0;
    for (const x of list) {
      if (x.field === "party") { if (x.kind === "lean") move += x.v * (x.code === "republicans" ? r : x.code === "independents" ? ind : dem); continue; }
      if (x.field !== "everyone" && ((d.kind[i] >> d.bits[x.field]) & width[x.field]) !== x.code) continue;
      if (x.kind === "lean") move += x.v; else more += x.v;
    }
    const share = 1 / (1 + Math.exp(-(d.lean[i] / 100 + d.point * (d.gap[i] / 10 + move))));
    const cast = d.size * Math.min(0.98, Math.max(0.02, d.turnout[i] / 200 + more / 100)), h = d.hood[i];
    R[h] += cast * share + d.size * (fired.republicans * r + fired.independents * ind * share) / 100;
    D[h] += cast * (1 - share) + d.size * (fired.democrats * dem + fired.independents * ind * (1 - share)) / 100;
  }
  const sums = {};
  let allR = 0, allD = 0;
  for (let h = 0; h < H; h++) {
    allR += R[h]; allD += D[h];
    for (const id of [d.hoods[h], ...d.parents[h]]) { const s = (sums[id] ||= [0, 0]); s[0] += R[h]; s[1] += D[h]; }
  }
  for (const [id, [r, dd]] of Object.entries(sums)) {
    const share = r + dd ? r / (r + dd) : null;
    VOTE.places[id] = [share === null ? null : Math.round(share * 1000) / 1000, Math.round(r + dd)];
    if (map && share !== null) map.setFeatureState(feature(id), { s24: share });
  }
  farVotes();
  const fl = allR / (allR + allD), nation = (2 * fl - 1) * 100 - d.nation_gap;
  VOTE.places.__state = [fl, Math.round(allR + allD)];
  $("wread").innerHTML = `Florida <span style="color:${PARTIES[fl >= 0.5 ? "rep" : "dem"].colour}">${fl >= 0.5 ? "R" : "D"} ${(Math.max(fl, 1 - fl) * 100).toFixed(1)}%</span><br>Country <span style="color:${PARTIES[nation > 0 ? "rep" : "dem"].colour}">${nation > 0 ? "R" : "D"} +${Math.abs(nation).toFixed(1)}</span>`;
  if (state.shade !== "r2024") { state.shade = "r2024"; }
  paint();
}
function worldPanel() {
  const slider = (kind, who, label) => `<label class="sl"><span>${esc(label)}</span><input type="range" min="-15" max="15" step="1" value="${WORLD.shifts[kind + "|" + who] || 0}" data-shift="${esc(kind + "|" + who)}"><output>${WORLD.shifts[kind + "|" + who] || 0}</output></label>`;
  $("worldpanel").innerHTML = `<div class="read" id="wread"></div><select id="wpreset" aria-label="Preset"><option value="">Preset</option>${Object.keys((WORLD.data || {}).presets || {}).map((k) => `<option>${esc(k)}</option>`).join("")}</select>
    <input type="text" id="wcmd" placeholder="lean hispanic 8" aria-label="Command" autocomplete="off">
    ${WORLD.groups.map(([title, kind, rows], i) => `<details${i === 0 ? " open" : ""}><summary>${title}</summary>${rows.map(([who, label]) => slider(kind, who, label)).join("")}</details>`).join("")}
    <button class="btn" id="wreset">Reset</button>`;
  $("worldpanel").querySelectorAll("[data-shift]").forEach((el) => { el.oninput = () => { WORLD.shifts[el.dataset.shift] = +el.value; el.nextElementSibling.textContent = el.value; }; el.onchange = recount; });
  $("wpreset").onchange = (e) => { if (!e.target.value) return; WORLD.shifts = {}; for (const s of WORLD.data.presets[e.target.value]) for (const kind of ["lean", "turnout"]) if (s[kind]) WORLD.shifts[kind + "|" + s.who] = s[kind]; worldPanel(); recount(); };
  $("wreset").onclick = () => { WORLD.shifts = {}; worldPanel(); recount(); };
  $("wcmd").onkeydown = (e) => {
    if (e.key !== "Enter") return;
    const [verb, ...rest] = e.target.value.trim().toLowerCase().split(/\s+/);
    if (verb === "reset") WORLD.shifts = {};
    else if (verb === "preset") { const name = Object.keys(WORLD.data.presets).find((k) => k.toLowerCase().startsWith(rest.join(" "))); if (name) { WORLD.shifts = {}; for (const s of WORLD.data.presets[name]) for (const kind of ["lean", "turnout"]) if (s[kind]) WORLD.shifts[kind + "|" + s.who] = s[kind]; } }
    else if ((verb === "lean" || verb === "turnout") && WORDS[rest[0]] && !isNaN(+rest[rest.length - 1])) WORLD.shifts[verb + "|" + WORDS[rest[0]]] = (rest[1] === "d" ? -1 : 1) * +rest[rest.length - 1];
    else return;
    worldPanel(); recount();
  };
}
worldData().then(() => { worldPanel(); const s = VOTE.summary; if (s) $("wread").innerHTML = `Florida <span style="color:${PARTIES.rep.colour}">R ${s.florida_rep}%</span><br>Country <span style="color:${PARTIES[s.nation_margin > 0 ? "rep" : "dem"].colour}">${s.nation_margin > 0 ? "R" : "D"} +${Math.abs(s.nation_margin).toFixed(1)}</span>`; });
