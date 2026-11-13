const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fill = (text, a) => String(text).replace(/\{(\w+)\}/g, (_, k) => a[k] ?? "");
let data, at = 0;

const ST = document.body.dataset.state || "fl";
fetch(`content/government/offices-${ST}.yaml`).then((r) => r.text()).then((text) => {
  data = jsyaml.load(text);
  data.addresses.forEach((a, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = a.name;
    b.onclick = () => { at = i; draw(); };
    $("addresses").append(b);
  });
  const all = document.createElement("button");
  all.type = "button";
  all.textContent = "All of " + data.state;
  all.onclick = () => { at = -1; draw(); };
  $("addresses").append(all);
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

const HOW = { ballot: "On the ballot", meeting: "Chosen by the district or its landowners", appointed: "Appointed", mixed: "Elected or retained" };
const label = (id) => (data.offices.find((o) => o.id === id || o.id.startsWith(id + ".")) || {}).title || ({ "city.council": "City council or commission member", "college.trustee": "Community college trustee", "district.housing": "Housing authority commissioner", "district.library": "Library district board member", "district.drainage": "Drainage district director", "district.other": "Other district board member", "city.mayor": "Mayor", "county.mayor": "County mayor", "district.community": "Community development district supervisor", "district.fire": "Fire district commissioner", "district.parks": "Parks district board member", "district.hospital": "Hospital district board member" })[id] || id;
const num = (n) => Number(n || 0).toLocaleString("en-US");
const sum = (seats, how) => Object.values(seats).reduce((n, h) => n + (h[how] || 0), 0);

function seatRows(seats) {
  return Object.entries(seats).map(([id, h]) => `<tr><td class="t">${esc(label(id))}</td><td class="soft">${Object.keys(h).map((k) => HOW[k]).join(", ")}</td><td>${num(Object.values(h).reduce((a, b) => a + b, 0))}</td></tr>`).join("");
}

async function whole() {
  const k = whole.data || (whole.data = await fetch(`data/offices/${ST}.json`).then((r) => r.json()));
  const g = k.governments, local = k.local;
  const ballot = sum(local, "ballot") + sum(k.statewide, "ballot") + sum(k.federal, "ballot");
  $("place").textContent = "All of " + data.state;
  $("summary").textContent = `${num(Object.values(g).reduce((a, b) => a + b, 0))} local governments · ${num(ballot)} seats on the ballot · ${num(sum(local, "meeting"))} chosen by a district's own meeting or members · ${num(sum(local, "appointed"))} appointed boards and officers`;
  const part = (title, seats) => `<div class="umbrella"><div class="level"><b>${title}</b></div><table class="seats">${seatRows(seats)}</table></div>`;
  const rows = k.counties.map((c, i) => `<tr data-i="${i}"><td class="t">${esc(c.name)}</td><td>${num(c.people)}</td><td>${num(Object.values(c.governments).reduce((a, b) => a + b, 0))}</td><td>${num(sum(c.seats, "ballot"))}</td><td>${num(sum(c.seats, "meeting") + sum(c.seats, "appointed"))}</td></tr>`).join("");
  $("stack").innerHTML = part("Federal seats filled from " + data.state, k.federal) + part("State", k.statewide) + (k.notes && k.notes.length ? `<p class="n">${k.notes.map(esc).join(" ")}</p>` : "") + part(`Local, all ${k.counties.length} counties`, local)
    + `<h2>County by county</h2><table class="seats counties"><thead><tr><td>County</td><td>People</td><td>Governments</td><td>On the ballot</td><td>Other seats</td></tr></thead><tbody>${rows}</tbody></table>`;
  $("stack").querySelectorAll("tr[data-i]").forEach((tr) => tr.onclick = () => {
    if (tr.nextSibling && tr.nextSibling.className === "open") return tr.nextSibling.remove();
    const c = k.counties[tr.dataset.i], more = document.createElement("tr");
    more.className = "open";
    const facts = [...c.facts, ...c.real, ...c.notes];
    more.innerHTML = `<td colspan="5"><p class="n">${facts.map(esc).join(" · ")}</p><table class="seats">${seatRows(c.seats)}</table></td>`;
    tr.after(more);
  });
}

function draw() {
  [...$("addresses").children].forEach((b, i, all) => b.setAttribute("aria-pressed", at === -1 ? i === all.length - 1 : i === at));
  if (at === -1) return whole();
  const a = data.addresses[at];
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
