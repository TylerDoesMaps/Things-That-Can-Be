const LAYERS = [
  { id: "state", label: "States", min: 0, base: true, width: [3, 1.1, 10, 2.4] },
  { id: "county", label: "Counties", min: 0, base: true, width: [3, 0.25, 8, 1, 12, 1.7] },
  { id: "city", label: "Cities", min: 5.5, on: true, width: [6, 0.5, 12, 1.4] },
  { id: "township", label: "Townships", min: 6.5, width: [7, 0.4, 12, 1.1] },
  { id: "bg", label: "Block groups", min: 8, width: [8, 0.25, 13, 1] },
  { id: "precinct", label: "Precincts", min: 8, width: [8, 0.35, 13, 1.3] },
  { id: "blocks", label: "Blocks", min: 11.5, width: [11.5, 0.2, 15, 0.8] },
];
const CLICK_ORDER = ["blocks", "bg", "precinct", "township", "city", "county", "state"];
const KEY = { blocks: "id", precinct: "p" };
const idOf = (layer, props) => props[KEY[layer] || "GEOID"];

const WIKI_DEM = ["#eef3fd", "#dee8fb", "#b4c7ec", "#8da9e2", "#678cd7", "#4170cd", "#3358a2", "#244079"];
const WIKI_REP = ["#fdeeee", "#fbdedd", "#f1b4b2", "#ed8783", "#e55651", "#d02923", "#b00600", "#850400"];
const THEMES = {
  wiki: {
    sea: "#dfe3e8", land: "#ffffff", state: "#000000", county: "#3a3a3a", city: "#6b3fa0", township: "#1b7f5c",
    bg: "#1f6fb2", precinct: "#c1272d", blocks: "#8a8f96", sel: "#f2a900", cityFill: 0.12,
    noData: "#cfd4dc", overFill: "rgba(0,0,0,0.3)", stateOver: "#000000", dem: WIKI_DEM, rep: WIKI_REP,
  },
  dark: {
    sea: "#101418", land: "#202122", state: "#eaecf0", county: "#a2a9b1", city: "#b79cdd", township: "#5ec9a3",
    bg: "#7db7e8", precinct: "#ff8a8f", blocks: "#72777d", sel: "#ffcc33", cityFill: 0.16,
    noData: "#54595d", overFill: "rgba(16,20,24,0.4)", stateOver: "#101418", dem: WIKI_DEM, rep: WIKI_REP,
  },
  ttnw: {
    sea: "#dfdfd9", land: "#f5f3ee", state: "#111111", county: "#5c5a55", city: "#7a2a43", township: "#2f6b5f",
    bg: "#3f6f95", precinct: "#9c1f3f", blocks: "#9a968c", sel: "#d98a00", cityFill: 0.12,
    noData: "#bcb8ae", overFill: "rgba(17,17,17,0.28)", stateOver: "#111111",
    dem: ["#faf1f2", "#f3dfe4", "#ecc9d2", "#e0a9b7", "#cf7f95", "#b84e6d", "#a02a4c", "#8a1233"],
    rep: ["#f0f4f7", "#dbe5ec", "#c1d2de", "#a5bdce", "#84a4bb", "#6389a6", "#4a7396", "#2f5f85"],
  },
};
const theme = () => THEMES[document.documentElement.dataset.theme] || THEMES.wiki;

const cache = new Map();
const decorated = new Map();
const relCache = new Map();
const enabled = new Set(LAYERS.filter((l) => l.base || l.on).map((l) => l.id));
let manifest;
let selection = null;
let view = "m";
const VIEWS = [
  ["m", "2024 margin", 2024], ["s", "2024 vote share", 2024], ["x24", "Shift from 2020", 2024],
  ["m20", "2020 margin", 2020], ["x20", "Shift from 2016", 2020], ["m16", "2016 margin", 2016], ["", "None", 0],
];
const BREAKS = { m: [0, 5, 10, 15, 20, 25, 30, 35], s: [0, 10, 20, 30, 40, 50, 60, 70], x: [0, 1, 2, 3, 5, 7.5, 10, 15] };
const breaksFor = (v) => (v === "s" ? BREAKS.s : v.startsWith("x") ? BREAKS.x : BREAKS.m);
const NOMINEE = { 2024: "Harris", 2020: "Biden", 2016: "Clinton" };
const viewYear = () => (VIEWS.find((v) => v[0] === view) || [])[2] || 2024;

const map = new maplibregl.Map({
  container: "map",
  hash: true,
  center: [-96.5, 38.6],
  zoom: 3.6,
  minZoom: 2.5,
  maxZoom: 17,
  dragRotate: false,
  attributionControl: { compact: false, customAttribution: "Census Bureau, Redistricting Data Hub, <a href=\"https://github.com/nytimes/presidential-precinct-map-2024\">New York Times precincts</a>" },
  pitchWithRotate: false,
  style: {
    version: 8,
    sources: {},
    layers: [{ id: "sea", type: "background", paint: { "background-color": theme().sea } }],
  },
});
map.touchZoomRotate.disableRotation();
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-left");

const mapHost = document.getElementById("map");
const labelHost = document.getElementById("labels");
const tip = document.getElementById("tip");
mapHost.append(labelHost, tip);

const fetchJson = (path) => fetch(path).then((r) => (r.ok ? r.json() : Promise.reject(new Error(path))));

function loadTopo(path) {
  if (!cache.has(path)) {
    cache.set(path, fetchJson(path).then((topo) => {
      const object = topo.objects[Object.keys(topo.objects)[0]];
      const parsed = topojson.feature(topo, object);
      return parsed.features || [parsed];
    }).catch(() => []));
  }
  return cache.get(path);
}

function attachVotes(props, votes) {
  if (!votes || !votes[2]) return;
  [props.d, props.r, props.t] = votes;
  props.m = (100 * (votes[0] - votes[1])) / votes[2];
  props.s = votes[0] >= votes[1] ? (100 * votes[0]) / votes[2] : (-100 * votes[1]) / votes[2];
}

function attachYears(props, years) {
  if (!years) return;
  attachVotes(props, years["2024"]);
  for (const y of [20, 16]) {
    const v = years[`20${y}`];
    if (v && v[2]) {
      [props[`d${y}`], props[`r${y}`], props[`t${y}`]] = v;
      props[`m${y}`] = (100 * (v[0] - v[1])) / v[2];
    }
  }
  if (props.m !== undefined && props.m20 !== undefined) props.x24 = props.m - props.m20;
  if (props.m20 !== undefined && props.m16 !== undefined) props.x20 = props.m20 - props.m16;
}

function loadLayer(path) {
  const match = path.match(/precinct\/(\w+)\.json/);
  if (!match) return loadTopo(path);
  if (!decorated.has(path)) {
    decorated.set(path, Promise.all([
      loadTopo(path),
      fetchJson(`data/results/${match[1]}.json`).catch(() => ({})),
    ]).then(([features, results]) => {
      features.forEach((f) => attachVotes(f.properties, results[f.properties.p]));
      return features;
    }));
  }
  return decorated.get(path);
}

function loadRel(state) {
  if (!relCache.has(state)) relCache.set(state, fetchJson(`data/rel/${state}.json`));
  return relCache.get(state);
}

function visible(bounds, box) {
  return box[0] <= bounds.getEast() && box[2] >= bounds.getWest() && box[1] <= bounds.getNorth() && box[3] >= bounds.getSouth();
}

function pathsFor(layer, bounds) {
  if (layer === "blocks") {
    return manifest.blockCounties.filter((f) => visible(bounds, manifest.counties[f])).map((f) => `data/blocks/${f}.json`);
  }
  const states = Object.keys(manifest.states).filter((s) => visible(bounds, manifest.states[s]));
  if (layer === "precinct") return states.filter((s) => manifest.precinctStates.includes(s)).map((s) => `data/precinct/${s}.json`);
  return states.map((s) => `data/${layer}/${s}.json`);
}

function resultLayer() {
  if (!view) return null;
  if ((view === "m" || view === "s") && enabled.has("precinct") && map.getZoom() >= 8) return "precinct";
  if (enabled.has("county")) return "county";
  if (enabled.has("state")) return "state";
  return null;
}

function marginColor(t) {
  const breaks = breaksFor(view);
  const stops = [];
  for (let i = 6; i >= 0; i--) stops.push(-breaks[i + 1], t.rep[i]);
  for (let i = 0; i <= 7; i++) stops.push(breaks[i], t.dem[i]);
  return ["case", ["has", view], ["step", ["get", view], t.rep[7], ...stops], t.noData];
}

function applyPaint() {
  if (!map.getLayer("land")) return;
  const t = theme();
  const active = resultLayer();
  map.setPaintProperty("sea", "background-color", t.sea);
  map.setPaintProperty("land", "fill-color", t.land);
  for (const l of LAYERS) {
    let color = t[l.id];
    if (active && l.id === "county") color = t.overFill;
    if (active && l.id === "state") color = t.stateOver;
    map.setPaintProperty(`${l.id}-line`, "line-color", color);
    map.setPaintProperty(`${l.id}-sel`, "line-color", t.sel);
    if (l.id === active) {
      map.setPaintProperty(`${l.id}-fill`, "fill-color", marginColor(t));
      map.setPaintProperty(`${l.id}-fill`, "fill-opacity", 1);
    } else if (l.id === "city") {
      map.setPaintProperty("city-fill", "fill-color", t.city);
      map.setPaintProperty("city-fill", "fill-opacity", active ? 0 : t.cityFill);
    } else {
      map.setPaintProperty(`${l.id}-fill`, "fill-color", "#000000");
      map.setPaintProperty(`${l.id}-fill`, "fill-opacity", 0);
    }
  }
  renderLayerList();
}

let refreshToken = 0;
async function refresh() {
  const token = ++refreshToken;
  const bounds = map.getBounds();
  const zoom = map.getZoom();
  await Promise.all(LAYERS.filter((l) => !l.base).map(async (l) => {
    const active = enabled.has(l.id) && zoom >= l.min;
    const paths = active ? pathsFor(l.id, bounds) : [];
    const groups = await Promise.all(paths.map(loadLayer));
    if (token !== refreshToken) return;
    map.getSource(l.id).setData({ type: "FeatureCollection", features: groups.flat() });
  }));
  applyPaint();
}

let cityLabels = [];
const labelSpans = new Map();

function drawLabels() {
  const showing = new Set();
  if (enabled.has("city")) {
    const zoom = map.getZoom();
    const bounds = map.getBounds();
    for (const label of cityLabels) {
      const [name, lon, lat, minZoom] = label;
      if (zoom < minZoom || lon < bounds.getWest() || lon > bounds.getEast() || lat < bounds.getSouth() || lat > bounds.getNorth()) continue;
      showing.add(label);
      let span = labelSpans.get(label);
      if (!span) {
        span = document.createElement("span");
        span.textContent = name;
        labelHost.appendChild(span);
        labelSpans.set(label, span);
      }
      const p = map.project([lon, lat]);
      span.style.transform = `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`;
    }
  }
  for (const [label, span] of labelSpans) {
    if (!showing.has(label)) {
      span.remove();
      labelSpans.delete(label);
    }
  }
}

function checkbox(text, checked, onChange, swatchColor, dim) {
  const label = document.createElement("label");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  box.addEventListener("change", () => onChange(box.checked));
  label.append(box);
  if (swatchColor) {
    const swatch = document.createElement("i");
    swatch.style.borderColor = swatchColor;
    label.append(swatch);
  }
  label.append(text);
  if (dim) label.className = "off";
  return label;
}

function renderLayerList() {
  const form = document.getElementById("layers");
  const zoom = map.getZoom();
  const t = theme();
  form.textContent = "";
  const select = document.createElement("select");
  select.id = "view";
  select.setAttribute("aria-label", "Map view");
  VIEWS.forEach(([id, name]) => select.add(new Option(name, id)));
  select.value = view;
  select.addEventListener("change", () => {
    view = select.value;
    tip.hidden = true;
    applyPaint();
  });
  form.append(select);
  for (const l of LAYERS) {
    form.append(checkbox(l.label, enabled.has(l.id), (on) => toggle(l.id, on), t[l.id], zoom < l.min));
  }
}

function toggle(id, on) {
  on ? enabled.add(id) : enabled.delete(id);
  drawLabels();
  const visibility = on ? "visible" : "none";
  map.setLayoutProperty(`${id}-line`, "visibility", visibility);
  map.setLayoutProperty(`${id}-sel`, "visibility", visibility);
  if (id !== "state" && id !== "county" && id !== "precinct") map.setLayoutProperty(`${id}-fill`, "visibility", visibility);
  refresh();
}

const fmt = (n) => Number(n).toLocaleString("en-US");
const pct = (n, t) => `${((100 * n) / t).toFixed(1)}%`;
const stateOf = (fips) => Object.keys(manifest.fips).find((k) => manifest.fips[k] === fips.slice(0, 2));

function marginText(p) {
  const leader = p.d >= p.r ? "Harris" : "Trump";
  return `${leader} +${Math.abs(p.m).toFixed(1)}%`;
}

async function countyName(fips) {
  const features = await loadTopo("data/county.json");
  const hit = features.find((f) => f.properties.GEOID === fips);
  return hit ? hit.properties.NAME : fips;
}

async function rowsFor(hit) {
  const p = hit.props;
  const rows = [];
  const add = (k, v) => rows.push([k, v]);
  if (p.t) {
    add("Votes", fmt(p.t));
    add("Margin", marginText(p));
  }
  if (hit.layer === "state") {
    const s = manifest.stateCounts[p.STUSPS] || {};
    add("Counties", fmt(s.counties));
    add("Cities", fmt(s.cities));
    add("Townships", fmt(s.townships));
    add("Block groups", fmt(s.block_groups));
    add("Precincts", fmt(s.precincts));
    add("Blocks", fmt(s.blocks));
    add("Neighborhoods", fmt(s.neighborhoods));
    return rows;
  }
  const state = hit.layer === "precinct" ? (p.ST || "FL") : stateOf(idOf(hit.layer, p));
  const rel = hit.layer === "precinct" ? null : await loadRel(state);
  if (hit.layer === "county") {
    const r = rel.county[p.GEOID];
    add("Block groups", fmt(r.bg));
    add("Precincts", fmt(r.precincts));
    add("Blocks", fmt(r.blocks));
    add("Cities", r.cities.length ? r.cities.map((c) => rel.names[c]).join(", ") : "None");
    if (r.towns.length) add("Townships", r.towns.map((c) => rel.names[c]).join(", "));
  } else if (hit.layer === "city" || hit.layer === "township") {
    const r = rel[hit.layer === "city" ? "city" : "town"][p.GEOID];
    if (r) {
      add(r.counties.length > 1 ? "Counties" : "County", (await Promise.all(r.counties.map(countyName))).join(", "));
      add("Block groups inside", fmt(r.bg_in));
      add("Block groups split", fmt(r.bg_part));
      add("Blocks", fmt(r.blocks));
    }
  } else if (hit.layer === "bg") {
    const r = rel.bg[p.GEOID];
    add("County", await countyName(p.GEOID.slice(0, 5)));
    add("Tract", p.GEOID.slice(5, 11));
    add("Municipalities", r.m.length ? r.m.map((c) => rel.names[c]).join(", ") : "None");
    add("Unincorporated", r.un ? "Yes" : "No");
    add("Blocks", fmt(r.blocks));
  } else if (hit.layer === "precinct") {
    const fips = /^\d{5}/.test(p.p) ? p.p.slice(0, 5) : `12${manifest.flCountyByName[p.p.split("-:-")[0]] || ""}`;
    add("County", await countyName(fips));
    if (p.pop !== undefined) add("Population", fmt(p.pop));
  } else if (hit.layer === "blocks") {
    add("Population", fmt(p.pop));
    add("Block group", p.id.slice(0, 12));
    add("County", await countyName(p.id.slice(0, 5)));
    add("City", p.c ? rel.names[p.c] : "None");
    if (p.p) add("Precinct", p.p.split("-:-").pop());
    if (p.cd) add("Congress", p.cd);
    if (p.su) add("State Senate", p.su);
    if (p.sl) add("State House", p.sl);
  }
  return rows;
}

function precinctName(p) {
  return p.p.includes("-:-") ? p.p.split("-:-").pop() : p.p.slice(6);
}

function titleFor(hit) {
  const p = hit.props;
  if (hit.layer === "blocks") return `Block ${p.id}`;
  if (hit.layer === "bg") return `Block group ${p.GEOID}`;
  if (hit.layer === "precinct") return `Precinct ${precinctName(p)}`;
  return p.NAME;
}

const LAYER_NAME = { state: "State", county: "County", city: "City", township: "Township", bg: "Block group", precinct: "Precinct", blocks: "Block" };

async function select(hit, stack) {
  selection = hit;
  for (const l of LAYERS) {
    const value = l.id === hit.layer ? idOf(hit.layer, hit.props) : "__none__";
    map.setFilter(`${l.id}-sel`, ["==", ["get", KEY[l.id] || "GEOID"], value]);
  }
  const box = document.getElementById("infobox");
  box.hidden = false;
  box.textContent = "";
  const close = document.createElement("button");
  close.className = "close";
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";
  close.addEventListener("click", () => {
    box.hidden = true;
    for (const l of LAYERS) map.setFilter(`${l.id}-sel`, ["==", ["get", KEY[l.id] || "GEOID"], "__none__"]);
  });
  const title = document.createElement("h2");
  title.textContent = titleFor(hit);
  box.append(close, title);
  const table = document.createElement("table");
  const addRow = (key, node) => {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = key;
    const td = document.createElement("td");
    td.append(node);
    tr.append(th, td);
    table.append(tr);
  };
  for (const other of stack) {
    if (other === hit) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "link";
    button.textContent = other.layer === "blocks" ? other.props.id : other.layer === "bg" ? other.props.GEOID : titleFor(other).replace(/^Precinct /, "");
    button.addEventListener("click", () => select(other, stack));
    addRow(LAYER_NAME[other.layer], button);
  }
  const rows = await rowsFor(hit);
  if (selection !== hit) return;
  const shown = new Set(stack.filter((other) => other !== hit).map((other) => LAYER_NAME[other.layer]));
  const details = rows.filter(([k]) => !shown.has(k));
  details.forEach(([k, v], i) => {
    addRow(k, document.createTextNode(v));
    if (i === 0 && stack.length > 1) table.lastChild.className = "first-detail";
  });
  box.append(table);
}

function placeName(layer, p) {
  if (layer === "county") return `${p.NAME}, ${p.ST}`;
  if (layer === "precinct") return `Precinct ${precinctName(p)}`;
  return p.NAME;
}

function leadText(value) {
  return `${value >= 0 ? "Democrats" : "Republicans"} +${Math.abs(value).toFixed(1)}%`;
}

function showTip(point, layer, p) {
  const t = theme();
  const year = viewYear();
  const suffix = year === 2024 ? "" : String(year % 100);
  const [dem, rep, all] = [p[`d${suffix}`], p[`r${suffix}`], p[`t${suffix}`]];
  if (!all) {
    tip.hidden = true;
    return;
  }
  tip.textContent = "";
  const title = document.createElement("strong");
  title.textContent = placeName(layer, p);
  const total = document.createElement("div");
  total.className = "total";
  total.textContent = `${year} total votes: ${fmt(all)}`;
  tip.append(title, total);
  const other = Math.max(0, all - dem - rep);
  const rows = [["Trump", rep, t.rep[5]], [NOMINEE[year], dem, t.dem[5]], ["Other", other, "#8d8d8d"]]
    .filter((row) => row[1] > 0).sort((a, b) => b[1] - a[1]);
  for (const [name, votes, color] of rows) {
    const row = document.createElement("div");
    row.className = "row";
    const swatch = document.createElement("i");
    swatch.style.background = color;
    const label = document.createElement("b");
    label.textContent = `${name}: ${pct(votes, all)}`;
    const count = document.createElement("span");
    count.textContent = `(${fmt(votes)})`;
    row.append(swatch, label, count);
    tip.append(row);
  }
  const margin = document.createElement("div");
  margin.className = "margin";
  const leader = dem >= rep ? NOMINEE[year] : "Trump";
  margin.textContent = `Margin: ${leader} +${((100 * Math.abs(dem - rep)) / all).toFixed(1)}% (${fmt(Math.abs(dem - rep))} votes)`;
  tip.append(margin);
  const shift = year === 2024 ? p.x24 : year === 2020 ? p.x20 : undefined;
  if (shift !== undefined) {
    const before = year === 2024 ? p.m20 : p.m16;
    const now = (dem - rep) / all;
    const change = document.createElement("div");
    change.className = "shift";
    change.textContent = `${Math.sign(before) === Math.sign(now) ? "Held" : "Flipped"}, shift ${leadText(shift)}`;
    tip.append(change);
  }
  tip.hidden = false;
  const bounds = mapHost.getBoundingClientRect();
  const w = tip.offsetWidth, h = tip.offsetHeight;
  const x = point.x + 16 + w > bounds.width ? point.x - w - 12 : point.x + 16;
  const y = point.y + 16 + h > bounds.height ? point.y - h - 12 : point.y + 16;
  tip.style.left = `${Math.max(4, x)}px`;
  tip.style.top = `${Math.max(4, y)}px`;
}

function addSupport(us) {
  const box = document.getElementById("support");
  box.textContent = "";
  const h = document.createElement("h2");
  h.textContent = "Estimated support";
  const table = document.createElement("table");
  [["Trump", us[1]], ["Harris", us[0]], ["Other", us[2] - us[0] - us[1]]].forEach(([name, votes]) => {
    const tr = table.insertRow();
    const th = document.createElement("th");
    th.textContent = name;
    const td = tr.insertCell();
    tr.prepend(th);
    td.textContent = pct(votes, us[2]);
  });
  box.append(h, table);
}

map.on("load", async () => {
  manifest = await fetchJson("data/manifest.json");
  const [states, counties, stateYears, countyYears, us] = await Promise.all([
    loadTopo("data/state.json"),
    loadTopo("data/county.json"),
    fetchJson("data/results/state_years.json"),
    fetchJson("data/results/county_years.json"),
    fetchJson("data/results/us_years.json"),
  ]);
  states.forEach((f) => attachYears(f.properties, stateYears[f.properties.STUSPS]));
  counties.forEach((f) => attachYears(f.properties, countyYears[f.properties.GEOID]));
  addSupport(us["2024"]);

  map.addSource("state", { type: "geojson", data: { type: "FeatureCollection", features: states } });
  map.addSource("county", { type: "geojson", data: { type: "FeatureCollection", features: counties } });
  map.addLayer({ id: "land", type: "fill", source: "state", paint: { "fill-color": theme().land } });
  for (const l of LAYERS) {
    if (!l.base) map.addSource(l.id, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }
  const visibility = (id) => (enabled.has(id) ? "visible" : "none");
  for (const id of ["state", "county", "precinct", "township", "city", "bg", "blocks"]) {
    const alwaysQueryable = id === "state" || id === "county" || id === "precinct";
    map.addLayer({
      id: `${id}-fill`, type: "fill", source: id,
      layout: { visibility: alwaysQueryable ? "visible" : visibility(id) },
      paint: { "fill-color": "#000000", "fill-opacity": 0 },
    });
  }
  for (const id of ["blocks", "bg", "precinct", "township", "city", "county", "state"]) {
    const l = LAYERS.find((x) => x.id === id);
    map.addLayer({
      id: `${id}-line`, type: "line", source: id,
      layout: { visibility: visibility(id), "line-join": "round" },
      paint: { "line-color": "#000000", "line-width": ["interpolate", ["linear"], ["zoom"], ...l.width] },
    });
  }
  for (const id of ["blocks", "bg", "precinct", "township", "city", "county", "state"]) {
    map.addLayer({
      id: `${id}-sel`, type: "line", source: id,
      layout: { visibility: visibility(id), "line-join": "round" },
      filter: ["==", ["get", KEY[id] || "GEOID"], "__none__"],
      paint: { "line-color": "#f2a900", "line-width": 3 },
    });
  }

  map.on("moveend", refresh);
  map.on("move", drawLabels);
  cityLabels = await fetchJson("data/city_labels.json");
  drawLabels();
  map.on("zoomend", applyPaint);
  map.on("mousemove", (e) => {
    const layer = resultLayer();
    const hit = layer && map.queryRenderedFeatures(e.point, { layers: [`${layer}-fill`] })[0];
    if (hit) showTip(e.point, layer, hit.properties);
    else tip.hidden = true;
  });
  mapHost.addEventListener("mouseleave", () => { tip.hidden = true; });
  map.on("click", (e) => {
    const stack = [];
    for (const id of CLICK_ORDER) {
      if (!enabled.has(id)) continue;
      const hit = map.queryRenderedFeatures(e.point, { layers: [`${id}-fill`] })[0];
      if (hit) stack.push({ layer: id, props: hit.properties });
    }
    if (stack.length) select(stack[0], stack);
  });
  window.addEventListener("themechange", () => {
    map.resize();
    applyPaint();
  });
  applyPaint();
  refresh();
  window.mapReady = true;
});
