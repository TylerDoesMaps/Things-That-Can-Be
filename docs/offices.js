const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fill = (text, a) => String(text).replace(/\{(\w+)\}/g, (_, k) => a[k] ?? "");
let data, at = 0;

fetch("content/government/offices.yaml").then((r) => r.text()).then((text) => {
  data = jsyaml.load(text);
  data.addresses.forEach((a, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = a.name;
    b.onclick = () => { at = i; draw(); };
    $("addresses").append(b);
  });
  $("rules").innerHTML = data.rules.map((r) => `<div class="rule"><b>${esc(r.name)}</b><div>${esc(r.rule)}</div><span class="${r.checked ? "" : "warn"}">${r.checked ? esc(r.source) : "unchecked"}</span></div>`).join("")
    + `<div class="rule"><b>Real or generic</b><div>${esc(data.cutoff.rule)}</div><span></span></div>`;
  draw();
});

function seatsFor(gov, a) {
  return data.offices.filter((o) => o.government === gov && (!o.class || o.class === a.class));
}

function how(o) {
  if (o.chosen === "appointed") return "Appointed by " + o.by + (o.retained ? `, then kept or removed by voters every ${o.term} years` : "");
  return (o.partisan ? "Elected by party" : "Elected, no party on the ballot") + (o.term ? `, ${o.term} years` : "");
}

function table(offices, a) {
  return `<table class="seats">${offices.map((o) => {
    const count = o.seats ? (o.of ? `1 of ${o.of}` : o.seats > 1 ? `${o.seats} seats` : "1 seat") : "";
    const tags = (o.player === "later" ? `<span class="tag later">later</span>` : "") + (o.checked ? "" : `<span class="tag warn">unchecked</span>`);
    return `<tr><td><span class="t">${esc(o.title)}</span>${tags}<span class="n">${esc(o.kind)} · ${esc(fill(o.area, a))}${o.note ? " · " + esc(o.note) : ""}</span></td>`
      + `<td class="soft">${esc(count)}</td><td class="soft">${esc(how(o))}</td><td>${o.next ? o.next.join(", ") : ""}</td></tr>`;
  }).join("")}</table>`;
}

function box(gov, a, inner = "") {
  const g = data.governments.find((x) => x.id === gov), offices = seatsFor(gov, a);
  const tier = gov === "city" ? (a.township ? 5 : 4) : g.tier;
  const label = tier === "beside" ? "Beside the tiers" : "Tier " + tier;
  return `<div class="umbrella"><div class="level"><b>${esc(fill(g.name, a))}</b><span class="tag">${label}</span></div>${table(offices, a)}${inner}</div>`;
}

function draw() {
  const a = data.addresses[at];
  [...$("addresses").children].forEach((b, i) => b.setAttribute("aria-pressed", i === at));
  const chain = ["federal", "state", "county", a.township && "township", a.city && "city"].filter(Boolean);
  const beside = `<div class="beside">${box("school", a)}${box("district", a)}</div>`;
  let html = "";
  for (const gov of chain.reverse()) html = box(gov, a, (gov === "county" ? beside : "") + html);
  $("stack").innerHTML = html;
  const all = [...chain, "school", "district"].flatMap((g) => seatsFor(g, a));
  const seats = all.reduce((n, o) => n + (o.of ? 1 : o.seats || 1), 0);
  $("place").textContent = `${a.name}, ${a.county} County, ${data.state}`;
  $("summary").textContent = `${a.kind} · ${all.length} offices · ${seats} seats · ${all.filter((o) => o.player === "yes").length} offices open to the player now · ${all.filter((o) => !o.checked).length} unchecked`;
}
