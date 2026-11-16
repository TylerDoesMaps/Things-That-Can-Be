const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (x) => (x === null || x === undefined ? "" : Math.round(x * 100) + "%");
const num = (n) => Number(n).toLocaleString("en-US");
const VIEWS = ["Pops", "Kinds", "Against 2024", "Work"];
const COUNTY = new URLSearchParams(location.search).get("county") || "12065";
let data, view = 0;

const pie = (p) => `<span class="pie"><i class="rep" style="width:${p.R * 100}%"></i><i class="ind" style="width:${p.I * 100}%"></i><i class="dem" style="width:${p.D * 100}%"></i></span>${pct(p.R)} · ${pct(p.I)} · ${pct(p.D)}`;
const signed = (v) => (v > 0 ? "+" : "") + v.toFixed(1);

Promise.all([fetch(`data/pops/fl-${COUNTY}.json`).then((r) => r.json()), fetch("data/game/built.json").then((r) => r.json())]).then(([d, counties]) => {
  data = d;
  $("county").innerHTML = counties.map((c) => `<option value="${c.fips}"${c.fips === COUNTY ? " selected" : ""}>${esc(c.name)} County</option>`).join("");
  $("county").onchange = (e) => { location.href = "pops.html?county=" + e.target.value; };
  VIEWS.forEach((v, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = v;
    b.onclick = () => { view = i; draw(); };
    $("views").append(b);
  });
  const s = d.summary, c = s.calibration;
  $("place").textContent = s.name;
  $("summary").textContent = `${num(s.pops)} pops · ${num(s.people)} people · ${s.neighbourhoods} neighbourhoods · worked out from the pops alone: ${pct(c.worked_out)} Republican · 2024: ${pct(c.real)} · region ${signed(c.region_points)}, county ${signed(c.county_points)}${c.flag ? " (over 10)" : ""} · turnout worked out ${pct(c.turnout_worked_out)}, 2024 ${pct(c.turnout_real)}`;
  draw();
});

function draw() {
  [...$("views").children].forEach((b, i) => b.setAttribute("aria-pressed", i === view));
  if (view === 0) {
    const places = {};
    data.pops.forEach((p) => (places[p.hood] ||= []).push(p));
    const shown = Object.keys(places).sort().slice(0, 40);
    $("out").innerHTML = `<table class="seats pops"><thead><tr><td>Pop</td><td>Work</td><td>Household income</td><td class="r">Owners</td><td>Republican · Independent · Democrat</td><td class="r">Worked out</td><td class="r">Turnout</td><td class="r">Wealth</td></tr></thead><tbody>`
      + shown.map((name) => `<tr class="place"><td colspan="8">${esc(name)} · ${esc(places[name][0].area)} · ${places[name].length} pops</td></tr>` + places[name].map((p) =>
        `<tr><td><span class="t">${esc(p.race)}, ${esc(p.age)}, ${esc(p.education.toLowerCase())}</span><span class="n">${esc(p.words.join(", "))}</span></td><td>${esc(p.work)}</td><td>${esc(p.income)}</td><td class="r">${pct(p.owners)}</td><td>${pie(p.pie)}</td><td class="r">${pct(p.inherent)}</td><td class="r">${pct(p.turnout)}</td><td class="r">${p.wealth}</td></tr>`).join("")).join("")
      + `</tbody></table>` + (Object.keys(places).length > shown.length ? `<p class="sub">First ${shown.length} of ${Object.keys(places).length} neighbourhoods</p>` : "");
  } else if (view === 1) {
    const kinds = {};
    data.pops.forEach((p) => {
      const k = (kinds[`${p.race}, ${p.age}, ${p.education.toLowerCase()}`] ||= { n: 0, own: 0, fit: 0 });
      k.n++;
      k.own += p.inherent;
      k.fit += p.rep;
    });
    $("out").innerHTML = `<table class="seats pops"><thead><tr><td>Kind</td><td class="r">Pops</td><td class="r">Republican, worked out</td><td class="r">Republican, fitted</td></tr></thead><tbody>`
      + Object.entries(kinds).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `<tr><td class="t">${esc(k)}</td><td class="r">${v.n}</td><td class="r">${pct(v.own / v.n)}</td><td class="r">${pct(v.fit / v.n)}</td></tr>`).join("") + `</tbody></table>`;
  } else if (view === 2) {
    $("out").innerHTML = `<table class="seats pops"><thead><tr><td>Neighbourhood</td><td>Area</td><td class="r">Pops</td><td class="r">Worked out</td><td class="r">2024</td><td class="r">Gap</td><td class="r">Local lean kept</td><td class="r">Fitted</td><td class="r">Votes</td><td class="r">2024 votes</td></tr></thead><tbody>`
      + data.neighbourhoods.map((h) => `<tr><td class="t">${esc(h.hood)}</td><td>${esc(h.area)}</td><td class="r">${h.pops}</td><td class="r">${pct(h.inherent)}</td><td class="r">${pct(h.real)}</td><td class="r gap">${h.real === null || h.inherent === null ? "" : signed((h.real - h.inherent) * 100)}</td><td class="r">${h.local ? signed(h.local) : ""}</td><td class="r">${pct(h.rep)}</td><td class="r">${num(h.votes)}</td><td class="r">${num(h.votes2024)}</td></tr>`).join("") + `</tbody></table>`;
  } else {
    const work = {};
    data.pops.forEach((p) => { work[p.work] = (work[p.work] || 0) + 1; });
    $("out").innerHTML = `<table class="seats pops"><thead><tr><td>Line of work</td><td class="r">Pops</td><td class="r">Share</td></tr></thead><tbody>`
      + Object.entries(work).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<tr><td class="t">${esc(k)}</td><td class="r">${n}</td><td class="r">${pct(n / data.pops.length)}</td></tr>`).join("") + `</tbody></table>`;
  }
}
