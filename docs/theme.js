(function () {
  const THEMES = [
    ["wiki", "Wikipedia"],
    ["dark", "Wikipedia dark"],
    ["ttnw", "Things That Never Were"],
  ];
  const read = () => {
    try {
      return localStorage.getItem("theme");
    } catch (error) {
      return null;
    }
  };
  const write = (value) => {
    try {
      localStorage.setItem("theme", value);
    } catch (error) {
      // Theme still applies for this visit.
    }
  };
  const saved = read();
  document.documentElement.dataset.theme = THEMES.some(([id]) => id === saved) ? saved : "wiki";

  document.addEventListener("DOMContentLoaded", () => {
    const nav = document.querySelector(".top nav");
    const select = document.createElement("select");
    select.id = "theme";
    select.setAttribute("aria-label", "Theme");
    THEMES.forEach(([id, name]) => select.add(new Option(name, id)));
    select.value = document.documentElement.dataset.theme;
    select.addEventListener("change", () => {
      document.documentElement.dataset.theme = select.value;
      write(select.value);
      window.dispatchEvent(new Event("themechange"));
    });
    nav.append(select);
  });
})();
