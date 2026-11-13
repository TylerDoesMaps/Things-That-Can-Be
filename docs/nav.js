(function () {
  const pages = [["index.html", "Election Night"], ["map.html", "Map"], ["offices.html", "Offices"], ["pops.html", "Pops"], ["builder.html", "Events"], ["kansas.html", "Kansas"]];
  const here = location.pathname.split("/").pop() || "index.html";
  const current = /-ks\.html$|^government\.html$/.test(here) ? "kansas.html" : here;
  document.querySelector("header").innerHTML = `<span class="mark">Things That Can Be</span><nav>${pages.map(([href, name]) => `<a href="${href}"${href === current ? ' aria-current="page"' : ""}>${name}</a>`).join("")}</nav>`;
})();
