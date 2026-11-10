const LEVELS = ["federal", "state", "county", "city", "township", "district"];
const LABEL = { federal: "Federal", state: "State", county: "County", city: "City", township: "Township", district: "District" };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = (n) => n.toLocaleString("en-US");
const staffText = ([full, part]) => [full ? `${num(full)} full-time` : "", part ? `${num(part)} part-time` : ""].filter(Boolean).join(", ");

let functions = [], place = null;

const codesOf = (f) => (f.census || (functions.find((x) => x.id === f.part_of) || {}).census || []).map((c) => String(c).padStart(3, "0"));
const sum = (unit, codes) => codes.reduce((t, c) => { const s = unit.staff[c] || [0, 0]; return [t[0] + s[0], t[1] + s[1]]; }, [0, 0]);
const unitsOf = (level) => place.units.filter((u) => (level === "district" ? u.kind === "district" || u.kind === "school" : u.kind === level));

// Who staffs a function at one level in this county, largest first.
function staffed(f, level) {
  const codes = codesOf(f);
  return unitsOf(level).map((u) => ({ unit: u, staff: sum(u, codes) })).filter((r) => r.staff[0] + r.staff[1] > 0)
    .sort((a, b) => b.staff[0] + b.staff[1] - (a.staff[0] + a.staff[1]));
}

function chosen(entry) {
  if (entry.chosen === "elected") return "Elected";
  if (entry.chosen === "appointed") return `Appointed by ${entry.by || "someone"}`;
  if (entry.chosen === "varies") return "Elected or appointed, by district";
  return "Not held";
}

function staffBlock(f, level) {
  if (level === "federal") return "";
  if (f.part_of) return `<p class="staff">Staff counted inside ${esc(functions.find((x) => x.id === f.part_of).name)}</p>`;
  const rows = staffed(f, level);
  const inside = "";
  if (!rows.length) return `<p class="staff">No staff reported${inside}</p>`;
  if (level === "state") return `<p class="staff">${staffText(rows[0].staff)} statewide${inside}</p>`;
  if (level === "county") return `<p class="staff">${staffText(rows[0].staff)}${inside}</p>`;
  const total = rows.reduce((t, r) => [t[0] + r.staff[0], t[1] + r.staff[1]], [0, 0]);
  const head = `${rows.length} of ${unitsOf(level).length}: ${staffText(total)}${inside}`;
  const shown = level === "township" ? [] : rows;
  return `<div class="staff">${head}<ul>${shown.map((r) => `<li><span>${esc(r.unit.name)}</span><span>${staffText(r.staff)}</span></li>`).join("")}</ul></div>`;
}

function box(f, level, inner) {
  const entry = f.levels[level];
  const hasStaff = level !== "federal" && !f.part_of && staffed(f, level).length > 0;
  if (!entry && !hasStaff) return inner;
  if (!entry) {
    return `<div class="umbrella not-listed"><div class="level"><b>${LABEL[level]}</b><span class="tag warn">not in the list</span></div>${staffBlock(f, level)}${inner}</div>`;
  }
  const ks = entry.kansas;
  const tags = [entry.cabinet === true || (ks && ks.cabinet === true) ? '<span class="tag">Cabinet</span>' : "",
    ks && !ks.checked ? '<span class="tag warn">unchecked</span>' : ""].join("");
  const real = ks ? `<p class="real">Kansas: ${esc(ks.title)}, ${esc(ks.department)}. ${esc(chosen(ks))}.</p>${ks.note ? `<p class="real-note">${esc(ks.note)}</p>` : ""}` : "";
  return `<div class="umbrella"><div class="level"><b>${LABEL[level]}</b>${tags}</div>
    <p class="who"><span class="title">${esc(entry.title)}</span>, ${esc(entry.department)}</p>
    <p class="how">${esc(chosen(entry))}</p>${real}${staffBlock(f, level)}${inner}</div>`;
}

function render() {
  const only = $("unchecked").checked;
  const local = (f) => ["county", "city", "township", "district"].flatMap((l) => staffed(f, l)).reduce((t, r) => t + r.staff[0] + r.staff[1], 0);
  let html = "", group = "";
  for (const f of functions) {
    const unchecked = Object.values(f.levels).some((e) => e.kansas && !e.kansas.checked);
    if (only && !unchecked) continue;
    if (f.group !== group) { group = f.group; html += `<h2>${esc(group)}</h2>`; }
    const locals = ["city", "township", "district"].map((l) => box(f, l, "")).join("");
    const nested = ["county", "state", "federal"].reduce((inner, l) => box(f, l, inner), locals ? `<div class="locals">${locals}</div>` : "");
    const held = LEVELS.filter((l) => f.levels[l] && f.levels[l].chosen !== "none" && !(f.levels[l].kansas && f.levels[l].kansas.chosen === "none")).map((l) => LABEL[l]).join(" · ");
    const people = local(f);
    html += `<details class="fn" id="${esc(f.id)}"><summary><span class="name">${esc(f.name)}</span><span class="held">${held}</span>
      <span class="count">${f.part_of ? "" : people ? `${num(people)} local staff` : "no local staff"}</span></summary>
      ${f.note ? `<p class="note">${esc(f.note)}</p>` : ""}${nested || '<p class="note">Nothing holds this here.</p>'}</details>`;
  }
  $("functions").innerHTML = html;
}

Promise.all([
  fetch("content/government/functions.yaml", { cache: "no-store" }).then((r) => r.text()).then((t) => jsyaml.load(t)),
  fetch("data/government/rice-ks.json", { cache: "no-store" }).then((r) => r.json()),
]).then(([list, county]) => {
  functions = list;
  place = county;
  const kinds = (k) => unitsOf(k).length;
  const people = place.units.find((u) => u.kind === "county").people;
  const local = place.units.filter((u) => u.kind !== "state").reduce((t, u) => t + (u.staff["000"] ? u.staff["000"][0] + u.staff["000"][1] : 0), 0);
  $("place").textContent = `${place.county} County, ${place.state}`;
  $("summary").textContent = `${num(people)} people · 1 county, ${kinds("city")} cities, ${kinds("township")} townships, ${kinds("district")} districts · ${num(local)} local government staff · ${functions.length} functions · staff from the ${place.year} Census of Governments`;
  render();
}).catch((error) => { $("functions").textContent = `Could not load. ${error.message}`; });

$("unchecked").addEventListener("change", render);
$("open-all").addEventListener("click", () => document.querySelectorAll("details.fn").forEach((d) => { d.open = true; }));
$("close-all").addEventListener("click", () => document.querySelectorAll("details.fn").forEach((d) => { d.open = false; }));
