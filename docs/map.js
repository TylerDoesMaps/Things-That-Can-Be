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
let showMargin = true;

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
  if (!showMargin) return null;
  if (enabled.has("precinct") && map.getZoom() >= 8) return "precinct";
  if (enabled.has("county")) return "county";
  if (enabled.has("state")) return "state";
  return null;
}

function marginColor(t) {
  const stops = [];
  for (let i = 6; i >= 0; i--) stops.push(-5 * (i + 1), t.rep[i]);
  for (let i = 0; i <= 7; i++) stops.push(5 * i, t.dem[i]);
  return ["case", ["has", "m"], ["step", ["get", "m"], t.rep[7], ...stops], t.noData];
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
  if (token === refreshToken) setTimeout(drawLabels, 120);
  applyPaint();
}

function drawLabels() {
  labelHost.textContent = "";
  if (!enabled.has("city") || map.getZoom() < 8) return;
  const seen = new Set();
  const features = map.queryRenderedFeatures({ layers: ["city-fill"] }).filter((f) => {
    if (seen.has(f.properties.GEOID)) return false;
    seen.add(f.properties.GEOID);
    return true;
  });
  const placed = [];
  const ranked = features.map((f) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const rings = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    rings.forEach((poly) => poly[0].forEach(([x, y]) => {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }));
    return { f, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, size: (x1 - x0) * (y1 - y0) };
  }).sort((a, b) => b.size - a.size);
  for (const { f, cx, cy } of ranked.slice(0, 400)) {
    const p = map.project([cx, cy]);
    const w = f.properties.NAME.length * 6.2 + 8;
    const box = [p.x - w / 2, p.y - 9, p.x + w / 2, p.y + 9];
    if (placed.some((b) => b[0] < box[2] && b[2] > box[0] && b[1] < box[3] && b[3] > box[1])) continue;
    placed.push(box);
    const span = document.createElement("span");
    span.textContent = f.properties.NAME;
    span.style.left = `${p.x}px`;
    span.style.top = `${p.y}px`;
    labelHost.appendChild(span);
    if (placed.length >= 70) break;
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
  form.append(checkbox("2024 margin", showMargin, (on) => {
    showMargin = on;
    tip.hidden = true;
    applyPaint();
    setTimeout(drawLabels, 120);
  }));
  for (const l of LAYERS) {
    form.append(checkbox(l.label, enabled.has(l.id), (on) => toggle(l.id, on), t[l.id], zoom < l.min));
  }
}

function toggle(id, on) {
  on ? enabled.add(id) : enabled.delete(id);
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

function showTip(point, layer, p) {
  const t = theme();
  tip.textContent = "";
  const title = document.createElement("strong");
  title.textContent = placeName(layer, p);
  const total = document.createElement("div");
  total.className = "total";
  total.textContent = `Total votes: ${fmt(p.t)}`;
  tip.append(title, total);
  const other = Math.max(0, p.t - p.d - p.r);
  const rows = [["Trump", p.r, t.rep[5]], ["Harris", p.d, t.dem[5]], ["Other", other, "#8d8d8d"]]
    .filter((row) => row[1] > 0).sort((a, b) => b[1] - a[1]);
  for (const [name, votes, color] of rows) {
    const row = document.createElement("div");
    row.className = "row";
    const swatch = document.createElement("i");
    swatch.style.background = color;
    const label = document.createElement("b");
    label.textContent = `${name}: ${pct(votes, p.t)}`;
    const count = document.createElement("span");
    count.textContent = `(${fmt(votes)})`;
    row.append(swatch, label, count);
    tip.append(row);
  }
  const margin = document.createElement("div");
  margin.className = "margin";
  margin.textContent = `Margin: ${marginText(p)} (${fmt(Math.abs(p.d - p.r))} votes)`;
  tip.append(margin);
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
  const [states, counties, results] = await Promise.all([
    loadTopo("data/state.json"),
    loadTopo("data/county.json"),
    fetchJson("data/results/national.json"),
  ]);
  states.forEach((f) => attachVotes(f.properties, results.state[f.properties.STUSPS]));
  counties.forEach((f) => attachVotes(f.properties, results.county[f.properties.GEOID]));
  addSupport(results.us);

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
  map.on("zoomend", applyPaint);
  map.on("mousemove", (e) => {
    const layer = resultLayer();
    const hit = layer && map.queryRenderedFeatures(e.point, { layers: [`${layer}-fill`] })[0];
    if (hit && hit.properties.t) showTip(e.point, layer, hit.properties);
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
