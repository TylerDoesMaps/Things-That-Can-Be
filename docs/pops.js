const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (x) => (x === null || x === undefined ? "" : Math.round(x * 100) + "%");
const VIEWS = ["Pops", "Kinds", "Against 2024"];
let data, view = 0;

const pie = (p) => `<span class="pie"><i class="rep" style="width:${p[0] * 100}%"></i><i class="ind" style="width:${p[1] * 100}%"></i><i class="dem" style="width:${p[2] * 100}%"></i></span>${pct(p[0])} · ${pct(p[1])} · ${pct(p[2])}`;

const ST = document.body.dataset.state || "fl";
fetch(`data/pops/${ST}.json`).then((r) => r.json()).then((d) => {
  data = d;
  VIEWS.forEach((v, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = v;
    b.onclick = () => { view = i; draw(); };
    $("views").append(b);
  });
  const s = d.summary;
  $("place").textContent = s.name;
  $("summary").textContent = `${s.adults.toLocaleString("en-US")} adults · ${s.pops} pops of 100 · from demographics alone: ${pct(s.predicted.rep)} Republican of the two-party vote, ${s.predicted.votes.toLocaleString("en-US")} votes · 2024 actual: ${pct(s.actual.rep)}, ${s.actual.votes.toLocaleString("en-US")} votes`;
  draw();
});

function draw() {
  [...$("views").children].forEach((b, i) => b.setAttribute("aria-pressed", i === view));
  if (view === 0) {
    const places = {};
    data.pops.forEach((p) => (places[p.city || "Outside any city"] ||= []).push(p));
    const order = Object.keys(places).sort((a, b) => places[b].length - places[a].length);
    $("out").innerHTML = `<table class="seats pops"><thead><tr><td>Pop</td><td>Leader</td><td>Work</td><td>Household income</td><td class="r">Owners</td><td class="r">Children</td><td>Republican · Independent · Democrat</td><td class="r">Turnout</td><td class="r">Wealth</td></tr></thead><tbody>`
      + order.map((name) => `<tr class="place"><td colspan="9">${esc(name)} · ${places[name].length} pops</td></tr>` + places[name].map((p) =>
        `<tr><td><span class="t">${esc(p.race)}, ${esc(p.age)}, ${esc(p.education.toLowerCase())}</span><span class="n">${esc(p.id)}${p.township && !p.city ? " · " + esc(p.township) + " Township" : ""}</span></td><td>${p.leader ? `<span class="person ${p.leader.party}">${esc(p.leader.name)}</span>` : ""}</td><td>${esc(p.work)}</td><td>${esc(p.income)}</td><td class="r">${pct(p.owners)}</td><td class="r">${pct(p.children)}</td><td>${pie(p.pie)}</td><td class="r">${pct(p.turnout)}</td><td class="r">${p.wealth}</td></tr>`).join("")).join("")
      + `</tbody></table>`;
  } else if (view === 1) {
    const kinds = {};
    data.pops.forEach((p) => {
      const k = (kinds[`${p.race}, ${p.age}, ${p.education.toLowerCase()}`] ||= { n: 0, lean: 0 });
      k.n++;
      k.lean += p.lean;
    });
    $("out").innerHTML = `<table class="seats pops"><thead><tr><td>Kind</td><td class="r">Pops</td><td class="r">Republican lean</td></tr></thead><tbody>`
      + Object.entries(kinds).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `<tr><td class="t">${esc(k)}</td><td class="r">${v.n}</td><td class="r">${pct(v.lean / v.n)}</td></tr>`).join("") + `</tbody></table>`;
  } else {
    $("out").innerHTML = `<table class="seats pops"><thead><tr><td>Precinct</td><td>Places</td><td class="r">Pops</td><td class="r">Predicted Republican</td><td class="r">Actual</td><td class="r">Gap</td><td class="r">Predicted votes</td><td class="r">Actual votes</td></tr></thead><tbody>`
      + data.precincts.map((c) => `<tr><td class="t">${esc(c.precinct.split("-")[1])}</td><td>${esc(c.places.join(", "))}</td><td class="r">${c.pops}</td><td class="r">${pct(c.predicted_rep)}</td><td class="r">${pct(c.actual_rep)}</td><td class="r gap">${c.predicted_rep === null ? "" : (c.actual_rep - c.predicted_rep > 0 ? "+" : "") + Math.round((c.actual_rep - c.predicted_rep) * 100)}</td><td class="r">${c.predicted_votes}</td><td class="r">${c.actual_votes}</td></tr>`).join("") + `</tbody></table>`;
  }
}
