const fmt = (n) => Number(n).toLocaleString("en-US");
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "");

function table(host, headers, rows, numeric) {
  const t = document.createElement("table");
  t.className = "wiki";
  const head = t.createTHead().insertRow();
  headers.forEach((h, i) => {
    const th = document.createElement("th");
    th.textContent = h;
    if (numeric(i)) th.className = "n";
    head.append(th);
  });
  const body = t.createTBody();
  const draw = (data) => {
    body.textContent = "";
    data.forEach((row) => {
      const tr = body.insertRow();
      row.forEach((v, i) => {
        const td = tr.insertCell();
        td.textContent = typeof v === "number" ? fmt(v) : v;
        if (numeric(i)) td.className = "n";
      });
    });
  };
  draw(rows);
  document.getElementById(host).append(t);
  return { t, head, draw };
}

const fit = (a, b, total, split) => [a, b, total, total - split, split, pct(total - split, total)];
const FIT_HEAD = ["Smaller", "Larger", "Total", "Whole", "Split", "Whole %"];
const fitNumeric = (i) => i >= 2;

Promise.all([
  fetch("data/containment.json").then((r) => r.json()),
  fetch("data/florida.json").then((r) => r.json()),
  fetch("data/precincts2024.json").then((r) => r.json()),
]).then(([c, fl, p24]) => {
  const n = c.national;
  table("national", FIT_HEAD, [
    fit("Block", "Block group", n.blocks, 0),
    fit("Block", "County", n.blocks, 0),
    fit("Block group", "County", n.block_groups, 0),
    fit("Township", "County", n.townships, 0),
    fit("Precinct", "County", n.precincts, 0),
    fit("City", "County", n.cities, n.cities_multi_county),
    fit("Block group", "Municipality", n.block_groups, n.block_groups - n.bg_one_muni),
    fit("Precinct", "Municipality", n.precincts, n.precinct_cross_muni),
    fit("Precinct", "Congressional district", n.precincts, n.precinct_cross_cd),
    fit("Precinct", "State Senate district", n.precincts, n.precinct_cross_sldu),
    fit("Precinct", "State House district", n.precincts, n.precinct_cross_sldl),
    fit("Precinct", "Block group", n.precincts, n.precinct_cross_bg),
    fit("Block group", "Precinct", n.bg_with_precinct, n.bg_cross_precinct),
  ], fitNumeric);

  table("florida", FIT_HEAD, [
    fit("Precinct", "County", fl.precincts, fl.precinct_multi_county),
    fit("Precinct", "City", fl.precincts, fl.precinct_cross_muni),
    fit("Precinct", "Congressional district", fl.precincts, fl.precinct_cross_cd),
    fit("Precinct", "State Senate district", fl.precincts, fl.precinct_cross_sldu),
    fit("Precinct", "State House district", fl.precincts, fl.precinct_cross_sldl),
    fit("Precinct", "Block group", fl.precincts, fl.precinct_cross_bg),
    fit("Block group", "Precinct", fl.bg_with_people, fl.bg_cross_precinct),
  ], fitNumeric);

  const q = p24.national;
  table("p2024", FIT_HEAD, [
    fit("Precinct", "County", q.precincts, q.unknown_county),
    fit("Precinct", "Municipality", q.precincts, q.cross_muni),
  ], fitNumeric);

  table("neighborhoods", ["Area", "Precincts", "Neighborhoods", "Per precinct"], [
    ["United States, 2024 precincts, municipal lines", q.precincts, q.pieces, (q.pieces / q.precincts).toFixed(2)],
    ["United States, 2020 lines", n.precincts, n.neighborhoods, (n.neighborhoods / n.precincts).toFixed(2)],
    ["Florida, 2024 lines, populated", fl.precincts, fl.neighborhoods, (fl.neighborhoods / fl.precincts).toFixed(2)],
  ], (i) => i > 0);

  table("cross", ["City", "State", "Counties", "Blocks"], c.cross_county_cities.map((x) => [x.name, x.state, x.counties, x.blocks]), (i) => i > 1);

  const stateRows = (key = "state", dir = 1) => [...c.states]
    .sort((a, b) => (a[key] > b[key] ? dir : a[key] < b[key] ? -dir : 0))
    .map((s) => [s.state, s.counties, s.cities, s.townships, s.block_groups, s.precincts, s.blocks, s.neighborhoods]);
  const keys = ["state", "counties", "cities", "townships", "block_groups", "precincts", "blocks", "neighborhoods"];
  const st = table("states", ["State", "Counties", "Cities", "Townships", "Block groups", "Precincts", "Blocks", "Neighborhoods"], stateRows(), (i) => i > 0);
  let current = "state", dir = 1;
  [...st.head.cells].forEach((th, i) => {
    th.dataset.key = keys[i];
    th.addEventListener("click", () => {
      dir = current === keys[i] ? -dir : i ? -1 : 1;
      current = keys[i];
      st.draw(stateRows(current, dir));
    });
  });
});
