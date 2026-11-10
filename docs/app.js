const LEVELS = [
  { id: "state", name: "State", years: true },
  { id: "county", name: "County", years: true },
  { id: "city", name: "City" },
  { id: "township", name: "Township" },
  { id: "precinct", name: "Precinct", bands: ["precinct-a", "precinct-b"] },
  { id: "sldl", name: "State House" },
  { id: "sldu", name: "State Senate" },
  { id: "cd", name: "Congress" },
];
const YEARS = ["2016", "2020", "2024"];
const NAMES = { 2016: ["Clinton", "Trump"], 2020: ["Biden", "Trump"], 2024: ["Harris", "Trump"] };
const EV_2010 = { AL: 9, AK: 3, AZ: 11, AR: 6, CA: 55, CO: 9, CT: 7, DE: 3, DC: 3, FL: 29, GA: 16, HI: 4, ID: 4, IL: 20, IN: 11, IA: 6, KS: 6, KY: 8, LA: 8, ME: 4, MD: 10, MA: 11, MI: 16, MN: 10, MS: 6, MO: 10, MT: 3, NE: 5, NV: 6, NH: 4, NJ: 14, NM: 5, NY: 29, NC: 15, ND: 3, OH: 18, OK: 7, OR: 7, PA: 20, RI: 4, SC: 9, SD: 3, TN: 11, TX: 38, UT: 6, VT: 3, VA: 13, WA: 12, WV: 5, WI: 10, WY: 3 };
const EV_2020 = { AL: 9, AK: 3, AZ: 11, AR: 6, CA: 54, CO: 10, CT: 7, DE: 3, DC: 3, FL: 30, GA: 16, HI: 4, ID: 4, IL: 19, IN: 11, IA: 6, KS: 6, KY: 8, LA: 8, ME: 4, MD: 10, MA: 11, MI: 15, MN: 10, MS: 6, MO: 10, MT: 4, NE: 5, NV: 6, NH: 4, NJ: 14, NM: 5, NY: 28, NC: 16, ND: 3, OH: 17, OK: 7, OR: 8, PA: 19, RI: 4, SC: 9, SD: 3, TN: 11, TX: 40, UT: 6, VT: 3, VA: 13, WA: 12, WV: 4, WI: 10, WY: 3 };
const EV = { 2016: EV_2010, 2020: EV_2010, 2024: EV_2020 };

// Margin bins in points, Democratic to Republican.
const STOPS = [-40, -25, -15, -8, -3, 0, 3, 8, 15, 25, 40];
const COLORS = ["#123f7a", "#2563ad", "#4a8bd0", "#86b4e4", "#bcd5f0", "#e3edf8", "#fbe6e3", "#f5c1ba", "#ec8f86", "#dc5a52", "#bf2c2c", "#8a1418"];
const EMPTY = "#eeeeec";

const state = { level: "county", year: "2024", shift: 0 };
let states = {}, districts = {}, hover = null;
const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const lean = (m) => (Math.abs(m) < 0.05 ? "Even" : (m > 0 ? "R+" : "D+") + Math.abs(m).toFixed(1));

function fill() {
  const y = state.year.slice(2);
  const t = ["to-number", ["get", "t" + y], 0];
  const margin = ["+", ["/", ["*", 100, ["-", ["to-number", ["get", "r" + y], 0], ["to-number", ["get", "d" + y], 0]]], t], state.shift];
  const steps = ["step", margin, COLORS[0]];
  STOPS.forEach((s, i) => steps.push(s, COLORS[i + 1]));
  return ["case", ["<=", t, 0], EMPTY, steps];
}

const protocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);
const tiles = (name) => "pmtiles://" + new URL(`tiles/${name}.pmtiles`, location.href).href;

const map = new maplibregl.Map({
  container: "map",
  style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#ffffff" } }] },
  bounds: [[-125, 24.2], [-66.6, 49.6]],
  fitBoundsOptions: { padding: 12 },
  minZoom: 1.5,
  maxZoom: 14,
  dragRotate: false,
  pitchWithRotate: false,
  attributionControl: false,
});
map.touchZoomRotate.disableRotation();
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

const layerIds = (level) => (level.bands || [level.id]);

map.on("load", () => {
  for (const level of LEVELS) {
    layerIds(level).forEach((src, i, all) => {
      map.addSource(src, { type: "vector", url: tiles(src) });
      const range = all.length > 1 ? (i === 0 ? { maxzoom: 9 } : { minzoom: 9 }) : {};
      map.addLayer({ id: src, type: "fill", source: src, "source-layer": level.id, layout: { visibility: "none" }, paint: { "fill-color": EMPTY, "fill-antialias": false }, ...range });
      map.addLayer({
        id: src + "-line", type: "line", source: src, "source-layer": level.id, layout: { visibility: "none" },
        paint: {
          "line-color": "#ffffff",
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, level.id === "state" ? 0.6 : 0.15, 9, 0.7, 13, 1.4],
          "line-opacity": ["state", "county", "cd"].includes(level.id) ? 1 : ["interpolate", ["linear"], ["zoom"], 4.5, 0, 6.5, 1],
        },
        ...(level.id === "precinct" ? { minzoom: Math.max(7, range.minzoom || 0), ...(range.maxzoom ? { maxzoom: range.maxzoom } : {}) } : range),
      });
      map.addLayer({ id: src + "-hover", type: "line", source: src, "source-layer": level.id, layout: { visibility: "none" }, filter: ["==", ["get", "name"], ""], paint: { "line-color": "#16181d", "line-width": 1.6 }, ...range });
      map.on("mousemove", src, (e) => show(e, level));
      map.on("click", src, (e) => show(e, level));
      map.on("mouseleave", src, hide);
    });
  }
  map.addLayer({ id: "state-border", type: "line", source: "state", "source-layer": "state", paint: { "line-color": "#16181d", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.35, 8, 0.9], "line-opacity": 0.55 } });
  render();
});

function render() {
  for (const level of LEVELS) {
    const on = level.id === state.level ? "visible" : "none";
    for (const id of layerIds(level)) {
      for (const suffix of ["", "-line", "-hover"]) map.setLayoutProperty(id + suffix, "visibility", on);
      if (on === "visible") map.setPaintProperty(id, "fill-color", fill());
    }
  }
  map.setLayoutProperty("state-border", "visibility", state.level === "state" ? "none" : "visible");
  board();
  hide();
}

function shifted(d, r, t) {
  const move = (state.shift / 200) * t;
  return [Math.max(0, d - move), Math.max(0, r + move)];
}

function board() {
  const y = state.year, ev = EV[y];
  let dem = 0, rep = 0, D = 0, R = 0, T = 0;
  for (const [st, years] of Object.entries(states)) {
    const [d, r, t] = years[y];
    D += d; R += r; T += t;
    const m = (100 * (r - d)) / t + state.shift;
    const atLarge = st === "ME" || st === "NE" ? 2 : ev[st];
    if (m >= 0) rep += atLarge; else dem += atLarge;
  }
  for (const m of Object.values(districts[y] || {})) {
    if (m + state.shift >= 0) rep += 1; else dem += 1;
  }
  const [d, r] = shifted(D, R, T);
  $("dem-name").textContent = NAMES[y][0];
  $("rep-name").textContent = NAMES[y][1];
  $("dem-ev").textContent = dem;
  $("rep-ev").textContent = rep;
  $("dem-pv").textContent = T ? ((100 * d) / T).toFixed(1) + "%" : "";
  $("rep-pv").textContent = T ? ((100 * r) / T).toFixed(1) + "%" : "";
  $("dem-bar").style.width = (100 * dem) / 538 + "%";
  $("rep-bar").style.width = (100 * rep) / 538 + "%";
  $("shift-value").textContent = lean(state.shift);
}

function show(e, level) {
  const f = e.features && e.features[0];
  if (!f) return;
  const p = f.properties, y = state.year.slice(2);
  const key = [p.name, p.st, p.c || ""].join("|");
  if (hover !== key) {
    hover = key;
    const filter = ["all", ["==", ["get", "name"], p.name ?? ""], ["==", ["get", "st"], p.st ?? ""]];
    if (p.c !== undefined) filter.push(["==", ["get", "c"], p.c]);
    for (const id of layerIds(level)) map.setFilter(id + "-hover", filter);
  }
  const t = Number(p["t" + y]) || 0;
  const place = level.id === "precinct" ? [p.c, p.st].filter(Boolean).join(", ") : level.id === "state" ? "" : p.st;
  let html = `<h3>${esc(level.id === "precinct" ? "Precinct " + p.name : p.name)}</h3><p>${esc(place)}</p>`;
  if (t > 0) {
    const [d, r] = shifted(Number(p["d" + y]) || 0, Number(p["r" + y]) || 0, t);
    const names = NAMES[state.year];
    html += `<table><tr class="d"><td>${names[0]}</td><td>${fmt(d)}</td><td>${((100 * d) / t).toFixed(1)}%</td></tr>` +
      `<tr class="r"><td>${names[1]}</td><td>${fmt(r)}</td><td>${((100 * r) / t).toFixed(1)}%</td></tr></table>` +
      `<div class="m">${lean((100 * (r - d)) / t)}<span>${p.cov !== undefined && p.cov < 98 ? p.cov + "% in" : fmt(t) + " votes"}</span></div>`;
  } else {
    html += `<div class="m"><span>No results</span></div>`;
  }
  const tip = $("tip");
  tip.innerHTML = html;
  tip.hidden = false;
  const box = $("map").getBoundingClientRect();
  const x = e.point.x + 18, yy = e.point.y + 18;
  tip.style.left = Math.min(x, box.width - tip.offsetWidth - 8) + "px";
  tip.style.top = Math.min(yy, box.height - tip.offsetHeight - 8) + "px";
  map.getCanvas().style.cursor = "default";
}

function hide() {
  if (hover === null) return;
  hover = null;
  $("tip").hidden = true;
  for (const level of LEVELS) for (const id of layerIds(level)) if (map.getLayer(id + "-hover")) map.setFilter(id + "-hover", ["==", ["get", "name"], ""]);
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function tabs() {
  const level = LEVELS.find((l) => l.id === state.level);
  if (!level.years) state.year = "2024";
  $("levels").innerHTML = LEVELS.map((l) => `<button type="button" data-level="${l.id}" aria-pressed="${l.id === state.level}">${l.name}</button>`).join("");
  $("years").innerHTML = YEARS.map((y) => `<button type="button" data-year="${y}" aria-pressed="${y === state.year}" ${level.years || y === "2024" ? "" : "disabled"}>${y}</button>`).join("");
}

$("levels").addEventListener("click", (e) => {
  const id = e.target.dataset.level;
  if (!id) return;
  state.level = id;
  tabs();
  render();
});
$("years").addEventListener("click", (e) => {
  const y = e.target.dataset.year;
  if (!y || e.target.disabled) return;
  state.year = y;
  tabs();
  render();
});
$("shift").addEventListener("input", (e) => {
  state.shift = Number(e.target.value);
  const level = LEVELS.find((l) => l.id === state.level);
  for (const id of layerIds(level)) if (map.getLayer(id)) map.setPaintProperty(id, "fill-color", fill());
  board();
  hide();
});
$("shift-reset").addEventListener("click", () => {
  $("shift").value = 0;
  $("shift").dispatchEvent(new Event("input"));
});

$("legend").innerHTML = `<span>D+40</span>${COLORS.map((c) => `<i style="background:${c}"></i>`).join("")}<span>R+40</span>`;

Promise.all([fetch("data/states.json").then((r) => r.json()), fetch("data/districts.json").then((r) => r.json())]).then(([s, d]) => {
  states = s;
  districts = d;
  tabs();
  if (map.loaded() && map.getLayer("state-border")) render(); else board();
});
tabs();

new ResizeObserver(() => map.resize()).observe($("map"));
