const LAYERS = [
  { id: "state", label: "States", color: "#000000", min: 0, base: true, width: [3, 1.1, 10, 2.4] },
  { id: "county", label: "Counties", color: "#3a3a3a", min: 0, base: true, width: [3, 0.25, 8, 1, 12, 1.7] },
  { id: "city", label: "Cities", color: "#6b3fa0", min: 5.5, on: true, width: [6, 0.5, 12, 1.4], fill: "#6b3fa0", fillOpacity: 0.12 },
  { id: "township", label: "Townships", color: "#1b7f5c", min: 6.5, width: [7, 0.4, 12, 1.1] },
  { id: "bg", label: "Block groups", color: "#1f6fb2", min: 8, width: [8, 0.25, 13, 1] },
  { id: "precinct", label: "Precincts", color: "#c1272d", min: 8, width: [8, 0.35, 13, 1.3] },
  { id: "blocks", label: "Blocks", color: "#8a8f96", min: 11.5, width: [11.5, 0.2, 15, 0.8] },
];
const CLICK_ORDER = ["blocks", "bg", "precinct", "township", "city", "county", "state"];
const KEY = { blocks: "id", precinct: "p" };
const idOf = (layer, props) => props[KEY[layer] || "GEOID"];

const cache = new Map();
const relCache = new Map();
const enabled = new Set(LAYERS.filter((l) => l.base || l.on).map((l) => l.id));
let manifest;
let selection = null;

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
    layers: [{ id: "sea", type: "background", paint: { "background-color": "#dfe3e8" } }],
  },
});
map.touchZoomRotate.disableRotation();
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-left");

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

let refreshToken = 0;
async function refresh() {
  const token = ++refreshToken;
  const bounds = map.getBounds();
  const zoom = map.getZoom();
  await Promise.all(LAYERS.filter((l) => !l.base).map(async (l) => {
    const active = enabled.has(l.id) && zoom >= l.min;
    const paths = active ? pathsFor(l.id, bounds) : [];
    const groups = await Promise.all(paths.map(loadTopo));
    if (token !== refreshToken) return;
    map.getSource(l.id).setData({ type: "FeatureCollection", features: groups.flat() });
  }));
  if (token === refreshToken) setTimeout(drawLabels, 120);
  renderLayerList();
}

function drawLabels() {
  const host = document.getElementById("labels");
  host.textContent = "";
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
    host.appendChild(span);
    if (placed.length >= 70) break;
  }
}

function renderLayerList() {
  const form = document.getElementById("layers");
  const zoom = map.getZoom();
  form.textContent = "";
  for (const l of LAYERS) {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = enabled.has(l.id);
    box.addEventListener("change", () => toggle(l.id, box.checked));
    const swatch = document.createElement("i");
    swatch.style.borderColor = l.color;
    label.append(box, swatch, l.label);
    if (zoom < l.min) label.className = "off";
    form.appendChild(label);
  }
}

function toggle(id, on) {
  on ? enabled.add(id) : enabled.delete(id);
  const visibility = on ? "visible" : "none";
  map.setLayoutProperty(`${id}-line`, "visibility", visibility);
  map.setLayoutProperty(`${id}-fill`, "visibility", visibility);
  map.setLayoutProperty(`${id}-sel`, "visibility", visibility);
  refresh();
}

function interpolate(stops) {
  return ["interpolate", ["linear"], ["zoom"], ...stops];
}

function addLayerSet(l, beforeLines) {
  map.addLayer({
    id: `${l.id}-fill`, type: "fill", source: l.id,
    layout: { visibility: enabled.has(l.id) ? "visible" : "none" },
    paint: { "fill-color": l.fill || "#000", "fill-opacity": l.fill ? l.fillOpacity : 0 },
  }, beforeLines);
  map.addLayer({
    id: `${l.id}-line`, type: "line", source: l.id,
    layout: { visibility: enabled.has(l.id) ? "visible" : "none", "line-join": "round" },
    paint: { "line-color": l.color, "line-width": interpolate(l.width) },
  });
  map.addLayer({
    id: `${l.id}-sel`, type: "line", source: l.id,
    layout: { visibility: enabled.has(l.id) ? "visible" : "none", "line-join": "round" },
    filter: ["==", ["get", KEY[l.id] || "GEOID"], "__none__"],
    paint: { "line-color": "#f2a900", "line-width": 3 },
  });
}

const fmt = (n) => Number(n).toLocaleString("en-US");
const stateOf = (fips) => Object.keys(manifest.fips).find((k) => manifest.fips[k] === fips.slice(0, 2));

async function countyName(fips) {
  const features = await loadTopo("data/county.json");
  const hit = features.find((f) => f.properties.GEOID === fips);
  return hit ? hit.properties.NAME : fips;
}

async function rowsFor(hit) {
  const p = hit.props;
  const rows = [];
  const add = (k, v) => rows.push([k, v]);
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

function titleFor(hit) {
  const p = hit.props;
  if (hit.layer === "blocks") return `Block ${p.id}`;
  if (hit.layer === "bg") return `Block group ${p.GEOID}`;
  if (hit.layer === "precinct") return `Precinct ${p.p.includes("-:-") ? p.p.split("-:-").pop() : p.p.slice(6)}`;
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

map.on("load", async () => {
  manifest = await fetchJson("data/manifest.json");
  const [states, counties] = await Promise.all([loadTopo("data/state.json"), loadTopo("data/county.json")]);
  map.addSource("state", { type: "geojson", data: { type: "FeatureCollection", features: states } });
  map.addSource("county", { type: "geojson", data: { type: "FeatureCollection", features: counties } });
  map.addLayer({ id: "land", type: "fill", source: "state", paint: { "fill-color": "#ffffff" } });
  for (const l of LAYERS) {
    if (!l.base) map.addSource(l.id, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }
  for (const id of ["blocks", "bg", "precinct", "township", "city", "county", "state"]) {
    addLayerSet(LAYERS.find((l) => l.id === id));
  }
  map.on("moveend", refresh);
  map.on("click", (e) => {
    const stack = [];
    for (const id of CLICK_ORDER) {
      if (!enabled.has(id)) continue;
      const hit = map.queryRenderedFeatures(e.point, { layers: [`${id}-fill`] })[0];
      if (hit) stack.push({ layer: id, props: hit.properties });
    }
    if (stack.length) select(stack[0], stack);
  });
  renderLayerList();
  refresh();
  window.mapReady = true;
});
