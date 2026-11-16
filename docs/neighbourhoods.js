const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = (n) => Number(n).toLocaleString("en-US");
const pct = (x) => (x === null || x === undefined ? "" : Math.round(x * 100) + "%");
const COUNTY = new URLSearchParams(location.search).get("county") || "12065";
const LINE = { "Precincts": "#bf2c2c", "City": "#16181d", "State House districts": "#7a3fb0", "State Senate districts": "#0b7a75", "Congressional districts": "#b36b00" };
const AREA = ["match", ["get", "area"], "urban", "#54278f", "suburban", "#9e9ac8", "small town", "#fdae6b", "#a1d99b"];
const VOTE = (key) => ["interpolate", ["linear"], ["coalesce", ["get", key], 0.5], 0.3, "#2563ad", 0.5, "#f4f1f4", 0.7, "#bf2c2c"];
const VIEWS = {
  "Pops": () => ["interpolate", ["linear"], ["get", "pops"], 0, "#ffffff", 3, "#e3e9f3", 12, "#b7c6de", 25, "#6f8dbb", 50, "#1f3a68"],
  "Area type": () => AREA,
  "Worked out": () => VOTE("inherent"),
  "2024 vote": () => VOTE("real"),
  "Local lean": () => ["interpolate", ["linear"], ["get", "local"], -15, "#2563ad", 0, "#f4f1f4", 15, "#bf2c2c"],
  "Drawn districts": () => VOTE("rep"),
};
let hoods, drawn, view = "Pops", shown = new Set(["City"]);

const map = new maplibregl.Map({
  container: "map",
  style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#ffffff" } }] },
  dragRotate: false, attributionControl: false, maxZoom: 15,
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
new ResizeObserver(() => map.resize()).observe($("map"));

Promise.all([
  fetch(`data/neighbourhoods/fl-${COUNTY}.json`).then((r) => r.json()), fetch(`data/pops/fl-${COUNTY}.json`).then((r) => r.json()),
  fetch(`data/districts/fl-${COUNTY}.json`).then((r) => r.json()), fetch("data/game/built.json").then((r) => r.json()), new Promise((go) => map.on("load", go)),
]).then(([d, pops, districts, counties]) => {
  hoods = d; drawn = districts;
  const by = Object.fromEntries(pops.neighbourhoods.map((h) => [h.hood, h]));
  d.shapes.features.forEach((f) => { const h = by[f.properties.code] || {}; Object.assign(f.properties, { pops: h.pops || 0, inherent: h.inherent, real: h.real, local: h.local || 0, fitted: h.rep }); });
  $("title").textContent = `Neighbourhoods, ${d.county} County`;
  $("county").innerHTML = counties.map((c) => `<option value="${c.fips}"${c.fips === COUNTY ? " selected" : ""}>${esc(c.name)} County</option>`).join("");
  $("county").onchange = (e) => { location.href = "neighbourhoods.html?county=" + e.target.value; };
  const b = d.bounds;
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 24, duration: 0 });
  map.addSource("shapes", { type: "geojson", data: d.shapes });
  map.addLayer({ id: "fill", type: "fill", source: "shapes", paint: { "fill-color": "#ffffff" } });
  map.addLayer({ id: "edge", type: "line", source: "shapes", layout: { "line-join": "round" }, paint: { "line-color": "#72777d", "line-width": 0.6 } });
  for (const [name, shape] of Object.entries(d.lines)) {
    map.addSource(name, { type: "geojson", data: shape });
    map.addLayer({ id: name, type: "line", source: name, paint: { "line-color": LINE[name], "line-width": name === "Precincts" ? 0.8 : 1.8, "line-dasharray": name === "Precincts" ? [2, 2] : [1, 0] } });
  }
  for (const key of Object.keys(VIEWS)) button("options", key, () => { view = key; draw(); });
  for (const name of Object.keys(d.lines)) button("lines", name, () => { shown.has(name) ? shown.delete(name) : shown.add(name); draw(); });
  map.on("mousemove", "fill", (e) => {
    const p = e.features[0].properties, tip = $("tip");
    const rows = [["Pops", p.pops], ["People", num(p.pops * 100)]];
    if (view === "Drawn districts") rows.push(["Republican, 2024", pct(p.rep)]);
    else rows.push(["Place", p.city || "Outside any city"], ["Area type", p.area], ["Worked out", pct(p.inherent)], ["2024", pct(p.real)], ["Local lean", p.local ? (p.local > 0 ? "R +" : "D +") + Math.abs(p.local).toFixed(1) : "None"],
      ["State House", p.house], ["State Senate", p.senate], ["Congress", p.congress], ["Precincts", p.precinct]);
    tip.innerHTML = `<h3>${esc(p.code)}</h3><dl>${rows.map(([a, v]) => `<dt>${a}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
    tip.hidden = false;
    const box = $("map").getBoundingClientRect();
    tip.style.left = Math.max(0, Math.min(e.point.x + 16, box.width - tip.offsetWidth)) + "px";
    tip.style.top = Math.max(0, Math.min(e.point.y + 16, box.height - tip.offsetHeight)) + "px";
  });
  map.on("mouseleave", "fill", () => { $("tip").hidden = true; });
  const s = d.stats;
  $("stats").innerHTML = `<table class="seats"><tbody>${Object.entries(s).map(([k, v]) => `<tr><td class="t">${esc(k[0].toUpperCase() + k.slice(1))}</td><td>${typeof v === "object" ? Object.entries(v).map(([a, n]) => `${a} ${n}`).join(", ") : num(v)}</td></tr>`).join("")}</tbody></table>`;
  $("districts").innerHTML = `<table class="seats"><thead><tr><td>District</td><td>Neighbourhoods</td><td>Pops</td><td>Republican, 2024</td><td>Roundness</td></tr></thead><tbody>${districts.districts.map((r) =>
    `<tr><td class="t">${r.district}</td><td>${r.neighbourhoods.length}</td><td>${r.pops}</td><td>${pct(r.rep)}</td><td>${r.roundness}</td></tr>`).join("")}</tbody></table>`;
  draw();
});

function button(where, label, act) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.onclick = act;
  $(where).append(b);
}

function draw() {
  map.getSource("shapes").setData(view === "Drawn districts" ? drawn.shapes : hoods.shapes);
  map.setPaintProperty("fill", "fill-color", VIEWS[view]());
  [...$("options").children].forEach((b) => b.setAttribute("aria-pressed", b.textContent === view));
  [...$("lines").children].forEach((b) => { b.setAttribute("aria-pressed", shown.has(b.textContent)); map.setLayoutProperty(b.textContent, "visibility", shown.has(b.textContent) ? "visible" : "none"); });
  const s = hoods.stats;
  $("summary").textContent = view === "Drawn districts"
    ? `${drawn.name}: ${drawn.districts.length} districts drawn from ${Object.keys(drawn.assignment).length} neighbourhoods · ${drawn.districts.map((r) => r.pops).join(", ")} pops · ${drawn.source ? `${drawn.source} · ${(drawn.wrong_side * 100).toFixed(1)}% of people on the wrong side of a real line` : `best of ${num(drawn.trials)} tries`}`
    : `${s.neighbourhoods} neighbourhoods · median ${s["median pops"]} pops · largest ${s["largest, in pops"]} · ${s["under 3 pops"]} under 3 pops`;
}
