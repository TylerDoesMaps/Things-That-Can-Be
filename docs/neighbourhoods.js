const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = (n) => Number(n).toLocaleString("en-US");
const pct = (x) => Math.round(x * 100) + "%";
const LINE = { "Precincts": "#bf2c2c", "City": "#16181d", "State House districts": "#7a3fb0" };
const BY_POPS = ["interpolate", ["linear"], ["get", "pops"], 0, "#ffffff", 1, "#e3e9f3", 4, "#b7c6de", 9, "#6f8dbb", 16, "#1f3a68"];
const BY_VOTE = ["interpolate", ["linear"], ["get", "rep"], 0.35, "#2563ad", 0.5, "#f4f1f4", 0.65, "#bf2c2c"];
let data, drawn, option = "C", shown = new Set(["City"]);

const map = new maplibregl.Map({
  container: "map",
  style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#ffffff" } }] },
  dragRotate: false, attributionControl: false, maxZoom: 15,
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
new ResizeObserver(() => map.resize()).observe($("map"));

Promise.all([
  fetch("data/neighbourhoods/jefferson-fl.json").then((r) => r.json()),
  fetch("data/pops/fl.json").then((r) => r.json()),
  fetch("data/districts/jefferson-fl.json").then((r) => r.json()),
  new Promise((done) => map.on("load", done)),
]).then(([d, pops, districts]) => {
  data = d;
  drawn = districts;
  const count = {};
  pops.pops.forEach((p) => { count[p.precinct] = (count[p.precinct] || 0) + 1; });
  d.options.C.shapes.features.forEach((f) => { f.properties.pops = count[f.properties.code] || 0; });
  const all = d.options.C.shapes.features.map((f) => f.properties.pops).sort((a, b) => a - b);
  Object.assign(d.options.C.stats, { "pops": all.reduce((a, b) => a + b, 0), "median pops": (all[Math.floor((all.length - 1) / 2)] + all[Math.ceil((all.length - 1) / 2)]) / 2, "largest, in pops": all[all.length - 1] });
  d.options.D = { label: "Drawn commission districts", shapes: districts.shapes };
  const b = d.bounds;
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 24, duration: 0 });
  map.addSource("shapes", { type: "geojson", data: d.options[option].shapes });
  map.addLayer({ id: "fill", type: "fill", source: "shapes", paint: { "fill-color": BY_POPS } });
  map.addLayer({ id: "edge", type: "line", source: "shapes", paint: { "line-color": "#16181d", "line-width": 1.1 } });
  for (const [name, shape] of Object.entries(d.lines)) {
    map.addSource(name, { type: "geojson", data: shape });
    map.addLayer({ id: name, type: "line", source: name, paint: { "line-color": LINE[name], "line-width": name === "Precincts" ? 1 : 2.2, "line-dasharray": name === "Precincts" ? [2, 2] : [1, 0] } });
  }
  for (const key of Object.keys(d.options)) button("options", `${key}. ${d.options[key].label}`, () => { option = key; draw(); });
  for (const name of Object.keys(d.lines)) button("lines", name, () => { shown.has(name) ? shown.delete(name) : shown.add(name); draw(); });
  map.on("mousemove", "fill", (e) => {
    const p = e.features[0].properties, tip = $("tip");
    const rows = [["Pops", p.pops], ["People", num(p.pops * 100)]];
    if (option === "D") rows.push(["Republican, 2024", pct(p.rep)], ["Neighbourhoods", p.precinct]);
    else rows.push(["Place", p.city || "Outside any city"], ["State House", p.house], ["Precincts", p.precinct]);
    tip.innerHTML = `<h3>${esc(p.code)}</h3><dl>${rows.map(([a, v]) => `<dt>${a}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
    tip.hidden = false;
    const box = $("map").getBoundingClientRect();
    tip.style.left = Math.max(0, Math.min(e.point.x + 16, box.width - tip.offsetWidth)) + "px";
    tip.style.top = Math.max(0, Math.min(e.point.y + 16, box.height - tip.offsetHeight)) + "px";
  });
  map.on("mouseleave", "fill", () => { $("tip").hidden = true; });
  const keys = ["A", "B", "C"], stats = Object.keys(d.options.A.stats);
  $("compare").innerHTML = `<table class="seats"><thead><tr><td></td>${keys.map((k) => `<td>${k}. ${esc(d.options[k].label)}</td>`).join("")}</tr></thead><tbody>${stats.map((s) =>
    `<tr><td class="t">${esc(s[0].toUpperCase() + s.slice(1))}</td>${keys.map((k) => `<td>${num(d.options[k].stats[s])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  $("districts").innerHTML = `<table class="seats"><thead><tr><td>District</td><td>Neighbourhoods</td><td>Pops</td><td>People</td><td>Republican, 2024</td><td>Roundness</td></tr></thead><tbody>${districts.districts.map((r) =>
    `<tr><td class="t">${r.district}</td><td>${esc(r.neighbourhoods.join(", "))}</td><td>${r.pops}</td><td>${num(r.people)}</td><td>${pct(r.rep)}</td><td>${r.roundness}</td></tr>`).join("")}</tbody></table>`;
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
  const o = data.options[option];
  map.getSource("shapes").setData(o.shapes);
  map.setPaintProperty("fill", "fill-color", option === "D" ? BY_VOTE : BY_POPS);
  [...$("options").children].forEach((b) => b.setAttribute("aria-pressed", b.textContent.startsWith(option + ".")));
  [...$("lines").children].forEach((b) => { b.setAttribute("aria-pressed", shown.has(b.textContent)); map.setLayoutProperty(b.textContent, "visibility", shown.has(b.textContent) ? "visible" : "none"); });
  $("summary").textContent = option === "D"
    ? `${drawn.name}: ${drawn.districts.length} districts drawn from ${Object.keys(drawn.assignment).length} neighbourhoods · ${drawn.districts.map((r) => r.pops).join(", ")} pops · best of ${num(drawn.trials)} tries`
    : `${o.label}: ${o.stats.neighbourhoods} neighbourhoods · ${o.stats.pops} pops · median ${o.stats["median pops"]} pops · ${o.stats["with no pops"]} with no pops`;
}
