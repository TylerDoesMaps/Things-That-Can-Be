const TIERS = [
  { id: "federal", name: "Federal" },
  { id: "state", name: "State" },
  { id: "county", name: "County", layer: "county" },
  { id: "municipal", name: "Municipal", layer: "municipal" },
  { id: "within", name: "Inside municipal", layer: "within" },
];
const KINDS = [
  { kind: "County", color: "#eef1f6", tier: 2 },
  { kind: "Township", color: "#d5deec", tier: 3 },
  { kind: "Township, inactive", color: "#f3f3f0", tier: 3 },
  { kind: "City outside any township", color: "#1f3a68", tier: 3 },
  { kind: "City inside a township", color: "#c8862a", tier: 4 },
];
const INK = "#16181d", NAVY = "#1f3a68";
const US = [[-125, 24.2], [-66.6, 49.6]];

let tier = 0, summary = null, hover = "";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const color = (kind) => KINDS.find((k) => k.kind === kind).color;

const protocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

const map = new maplibregl.Map({
  container: "map",
  style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#ffffff" } }] },
  bounds: US,
  fitBoundsOptions: { padding: 12 },
  minZoom: 1.5,
  maxZoom: 13,
  dragRotate: false,
  pitchWithRotate: false,
  attributionControl: false,
});
map.touchZoomRotate.disableRotation();
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
new ResizeObserver(() => map.resize()).observe($("map"));

TIERS.forEach((t, i) => {
  const b = document.createElement("button");
  b.type = "button";
  b.innerHTML = `<span class="n">${i + 1}</span>${esc(t.name)}`;
  b.onclick = () => go(i);
  $("tiers").append(b);
});
$("back").onclick = () => go(tier - 1);
$("next").onclick = () => go(tier + 1);
addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") go(tier + 1);
  if (e.key === "ArrowLeft") go(tier - 1);
});

Promise.all([
  fetch("data/tiers/ks.json").then((r) => r.json()),
  new Promise((done) => map.on("load", done)),
]).then(([data]) => {
  summary = data;
  const src = { source: "tiers" };
  const width = (a, b) => ["interpolate", ["linear"], ["zoom"], 4, a, 10, b];
  map.addSource("tiers", { type: "vector", url: "pmtiles://" + new URL("tiles/tiers-ks.pmtiles", location.href).href });

  map.addLayer({ id: "us", type: "fill", ...src, "source-layer": "us", paint: { "fill-color": "#eceef1" } });
  map.addLayer({ id: "us-line", type: "line", ...src, "source-layer": "us", paint: { "line-color": "#ffffff", "line-width": width(0.6, 1.2) } });
  map.addLayer({ id: "state", type: "fill", ...src, "source-layer": "us", filter: ["==", ["get", "here"], true], paint: { "fill-color": NAVY } });

  map.addLayer({ id: "county", type: "fill", ...src, "source-layer": "county", paint: { "fill-color": color("County") } });
  map.addLayer({
    id: "municipal", type: "fill", ...src, "source-layer": "municipal",
    paint: { "fill-color": ["match", ["get", "kind"], ...KINDS.filter((k) => k.tier === 3).flatMap((k) => [k.kind, k.color]), "#ffffff"] },
  });
  map.addLayer({ id: "municipal-line", type: "line", ...src, "source-layer": "municipal", paint: { "line-color": "#8e9bb3", "line-width": width(0.15, 0.8) } });
  map.addLayer({ id: "within", type: "fill", ...src, "source-layer": "within", paint: { "fill-color": color("City inside a township") } });
  map.addLayer({ id: "within-line", type: "line", ...src, "source-layer": "within", minzoom: 8, paint: { "line-color": "#7a4f12", "line-width": 0.6 } });
  map.addLayer({ id: "county-line", type: "line", ...src, "source-layer": "county", paint: { "line-color": INK, "line-width": width(0.4, 1.4), "line-opacity": 0.7 } });
  map.addLayer({ id: "state-line", type: "line", ...src, "source-layer": "us", filter: ["==", ["get", "here"], true], paint: { "line-color": INK, "line-width": width(1.2, 2.4) } });
  map.addLayer({ id: "hover", type: "line", ...src, "source-layer": "us", filter: ["==", ["get", "name"], ""], paint: { "line-color": INK, "line-width": 2 } });

  map.on("mousemove", show);
  map.on("click", show);
  map.getCanvas().addEventListener("mouseleave", hide);
  go(0, true);
});

function go(to, first) {
  if (!summary || to < 0 || to >= TIERS.length || (to === tier && !first)) return;
  const zoomOut = to === 0, zoomIn = tier === 0 && to > 0;
  tier = to;
  const on = (id, yes) => map.setLayoutProperty(id, "visibility", yes ? "visible" : "none");
  on("state", tier === 1);
  on("state-line", tier >= 1);
  on("county", tier === 2);
  on("county-line", tier >= 2);
  on("municipal", tier >= 3);
  on("municipal-line", tier >= 3);
  on("within", tier >= 4);
  on("within-line", tier >= 4);
  [...$("tiers").children].forEach((b, i) => b.setAttribute("aria-pressed", i === tier));
  $("back").disabled = tier === 0;
  $("next").disabled = tier === TIERS.length - 1;
  if (zoomOut && !first) map.fitBounds(US, { padding: 12, duration: 900 });
  if (zoomIn) map.fitBounds(summary.bounds, { padding: 40, duration: 900 });
  key();
  hide();
}

function key() {
  const rows = tier === 0 ? [["#eceef1", "States and the District of Columbia", 51]]
    : tier === 1 ? [[NAVY, summary.state, ""]]
    : KINDS.filter((k) => (tier === 2 ? k.tier === 2 : k.tier >= 3 && k.tier <= tier)).map((k) => [k.color, k.kind, summary.counts[k.kind]]);
  $("key").innerHTML = rows.map(([c, k, n]) => `<span><i style="background:${c}"></i><b>${esc(k)}</b>${n === "" ? "" : Number(n).toLocaleString("en-US")}</span>`).join("");
}

function show(e) {
  const layers = tier === 0 ? ["us"] : tier === 1 ? ["state"] : tier === 2 ? ["county"] : tier === 3 ? ["municipal"] : ["within", "municipal"];
  const found = map.queryRenderedFeatures(e.point, { layers });
  const f = found.find((x) => x.layer.id === "within") || found[0];
  if (!f) return hide();
  const p = f.properties, id = f.layer.id + "|" + p.name + "|" + (p.county || "");
  if (id !== hover) {
    hover = id;
    const filter = ["all", ["==", ["get", "name"], p.name]];
    if (p.county) filter.push(["==", ["get", "county"], p.county]);
    map.removeLayer("hover");
    map.addLayer({ id: "hover", type: "line", source: "tiers", "source-layer": f.sourceLayer, filter, paint: { "line-color": INK, "line-width": 2 } });
  }
  const rows = [];
  if (p.kind && f.layer.id !== "county") rows.push(["Kind", p.kind]);
  if (p.county) rows.push(["County", p.county]);
  if (f.layer.id === "within") {
    const under = found.find((x) => x.layer.id === "municipal");
    if (under) rows.push(["Township", under.properties.name], ["County", under.properties.county]);
  }
  if (p.people !== undefined && p.people !== null) rows.push(["People", Number(p.people).toLocaleString("en-US")]);
  const tip = $("tip");
  tip.innerHTML = `<h3>${esc(p.name)}</h3>` + (rows.length ? `<dl>${rows.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join("")}</dl>` : "");
  tip.hidden = false;
  const box = $("map").getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.max(0, Math.min(e.point.x + 16, box.width - w)) + "px";
  tip.style.top = Math.max(0, Math.min(e.point.y + 16, box.height - h)) + "px";
  map.getCanvas().style.cursor = "default";
}

function hide() {
  hover = "";
  $("tip").hidden = true;
  if (map.getLayer("hover")) map.setFilter("hover", ["==", ["get", "name"], ""]);
}
