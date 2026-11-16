const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const LINE = { "Precincts": "#bf2c2c", "City": "#16181d", "State House districts": "#7a3fb0" };
let data, option = "C", shown = new Set(["City"]);

const map = new maplibregl.Map({
  container: "map",
  style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#ffffff" } }] },
  dragRotate: false, attributionControl: false, maxZoom: 15,
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
new ResizeObserver(() => map.resize()).observe($("map"));

Promise.all([fetch("data/neighbourhoods/jefferson-fl.json").then((r) => r.json()), new Promise((done) => map.on("load", done))]).then(([d]) => {
  data = d;
  const b = d.bounds;
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 24, duration: 0 });
  map.addSource("shapes", { type: "geojson", data: d.options[option].shapes });
  map.addLayer({ id: "fill", type: "fill", source: "shapes", paint: { "fill-color": ["interpolate", ["linear"], ["get", "adults"], 0, "#ffffff", 100, "#e3e9f3", 300, "#b7c6de", 800, "#6f8dbb", 1400, "#1f3a68"] } });
  map.addLayer({ id: "edge", type: "line", source: "shapes", paint: { "line-color": "#16181d", "line-width": 1.1 } });
  for (const [name, shape] of Object.entries(d.lines)) {
    map.addSource(name, { type: "geojson", data: shape });
    map.addLayer({ id: name, type: "line", source: name, paint: { "line-color": LINE[name], "line-width": name === "Precincts" ? 1 : 2.2, "line-dasharray": name === "Precincts" ? [2, 2] : [1, 0] } });
  }
  for (const key of Object.keys(d.options)) button("options", `${key}. ${d.options[key].label}`, () => { option = key; draw(); });
  for (const name of Object.keys(d.lines)) button("lines", name, () => { shown.has(name) ? shown.delete(name) : shown.add(name); draw(); });
  map.on("mousemove", "fill", (e) => {
    const p = e.features[0].properties, tip = $("tip");
    const rows = [["Adults", Number(p.adults).toLocaleString("en-US")], ["Pops", p.pops], ["Place", p.city || "Outside any city"], ["State House", p.house], ["Precincts", p.precinct]];
    tip.innerHTML = `<h3>${esc(p.code)}</h3><dl>${rows.map(([a, v]) => `<dt>${a}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
    tip.hidden = false;
    const box = $("map").getBoundingClientRect();
    tip.style.left = Math.max(0, Math.min(e.point.x + 16, box.width - tip.offsetWidth)) + "px";
    tip.style.top = Math.max(0, Math.min(e.point.y + 16, box.height - tip.offsetHeight)) + "px";
  });
  map.on("mouseleave", "fill", () => { $("tip").hidden = true; });
  const keys = Object.keys(d.options), stats = Object.keys(d.options.A.stats);
  $("compare").innerHTML = `<table class="seats"><thead><tr><td></td>${keys.map((k) => `<td>${k}. ${esc(d.options[k].label)}</td>`).join("")}</tr></thead><tbody>${stats.map((s) =>
    `<tr><td class="t">${esc(s[0].toUpperCase() + s.slice(1))}</td>${keys.map((k) => `<td>${Number(d.options[k].stats[s]).toLocaleString("en-US")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
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
  [...$("options").children].forEach((b) => b.setAttribute("aria-pressed", b.textContent.startsWith(option + ".")));
  [...$("lines").children].forEach((b) => { b.setAttribute("aria-pressed", shown.has(b.textContent)); map.setLayoutProperty(b.textContent, "visibility", shown.has(b.textContent) ? "visible" : "none"); });
  $("summary").textContent = `${o.label}: ${o.stats.neighbourhoods} neighbourhoods · median ${o.stats["median adults"]} adults · ${o.stats["too small for one pop (under 50 adults)"]} too small to hold a pop · ${o.stats["pops placed"]} pops placed`;
}
