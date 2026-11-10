const REPO = "TylerDoesMaps/Things-That-Can-Be";
const BRANCH = "main";
const BASE = "docs/content/";
const FIELDS = ["id", "was", "title", "group", "order", "type", "level", "status", "fires", "needs", "text", "answers", "leads"];

const $ = (id) => document.getElementById(id);
const form = $("form");
const lines = (text) => text.split("\n").map((s) => s.trim()).filter(Boolean);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let index = [], registry = { scopes: {}, values: {} }, picks = {}, scopes = {}, current = null;

const store = {
  get token() { try { return localStorage.getItem("ttcb_token") || ""; } catch (e) { return ""; } },
  set token(v) { try { v ? localStorage.setItem("ttcb_token", v) : localStorage.removeItem("ttcb_token"); } catch (e) { /* stays for this visit only */ } },
};
let token = store.token;

const encode = (text) => { let s = ""; new TextEncoder().encode(text).forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };
const decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

async function github(path, options = {}) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${BASE}${path}${options.method ? "" : `?ref=${BRANCH}`}`, {
    ...options,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  if (res.status === 404 && !options.method) return null;
  if (!res.ok) throw new Error(`GitHub said ${res.status}`);
  return res.json();
}

// With a token, read the repository itself so a save shows up at once. Without one, read the published copy.
async function read(path) {
  if (token) {
    const file = await github(path);
    return file ? { text: decode(file.content), sha: file.sha } : null;
  }
  const res = await fetch(`content/${path}`, { cache: "no-store" });
  return res.ok ? { text: await res.text(), sha: null } : null;
}

async function write(path, text, sha, message) {
  const body = { message, content: encode(text), branch: BRANCH };
  if (sha) body.sha = sha;
  return github(path, { method: "PUT", body: JSON.stringify(body) });
}

const flatten = (items) => items.flatMap((x) => (Array.isArray(x) ? flatten(x) : [x]));

function known(call) {
  const scope = Object.keys(scopes).sort((a, b) => b.length - a.length).find((s) => call.startsWith(s + "."));
  return Boolean(scope) && scopes[scope].has(call.slice(scope.length + 1));
}

function problemsIn(text) {
  const out = [];
  let open = false;
  for (const [, raw] of (text || "").matchAll(/\{([^{}]*)\}/g)) {
    const inner = raw.trim();
    if (inner.startsWith("pick:")) {
      if (!(inner.slice(5).trim() in picks)) out.push(`Unknown pick {${inner}}`);
    } else if (inner.startsWith("when ")) {
      const m = inner.match(/^when (\S+) is (not )?(.+)$/);
      if (!m || !known(m[1])) out.push(`Bad condition {${inner}}`);
      else if (registry.values[m[1]] && !registry.values[m[1]].includes(m[3])) out.push(`${m[3]} is not a value of ${m[1]}`);
      open = true;
    } else if (inner === "otherwise") {
      if (!open) out.push("{otherwise} outside a {when} block");
    } else if (inner === "end") {
      if (!open) out.push("{end} without {when}");
      open = false;
    } else if (!known(inner.split("|")[0].trim())) {
      out.push(`Unknown call {${inner}}`);
    }
  }
  if (open) out.push("{when} block is never closed with {end}");
  return out;
}

function targets() {
  const set = new Set();
  for (const row of index) {
    set.add(row.id);
    (row.answers || []).forEach((a) => set.add(`${row.id}#${a}`));
  }
  return set;
}

function collect() {
  const data = Object.fromEntries(new FormData(form));
  const answers = [...$("answers").children].map((box) => {
    const get = (f) => box.querySelector(`[data-f="${f}"]`).value;
    return { id: get("id").trim(), text: get("text"), needs: lines(get("needs")), effects: get("effects"), note: get("note") };
  });
  const event = { ...data, id: data.id.trim(), order: Number(data.order) || 0, needs: lines(data.needs), answers };
  return Object.fromEntries(FIELDS.map((f) => [f, event[f]]));
}

function review() {
  const event = collect();
  const texts = [event.text, ...event.answers.map((a) => a.text)];
  const problems = texts.flatMap(problemsIn);
  const exists = targets();
  event.answers.forEach((a) => exists.add(`${event.id}#${a.id}`));
  for (const need of [...event.needs, ...event.answers.flatMap((a) => a.needs)]) {
    if (!exists.has(need)) problems.push(`Locked behind ${need}, which does not exist`);
  }
  if (!/^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(event.id)) problems.push("The ID needs lowercase words joined by dots");
  if (current && current.isNew && index.some((r) => r.id === event.id)) problems.push("That ID is taken");
  const ids = event.answers.map((a) => a.id);
  if (ids.some((id, i) => !/^[a-z0-9_]+$/.test(id) || ids.indexOf(id) !== i)) problems.push("Every answer needs its own lowercase ID");
  const brackets = texts.reduce((n, t) => n + ((t || "").match(/\[[^\[\]]*\]/g) || []).length, 0);
  $("brackets").textContent = `${brackets} in brackets`;
  $("problems").innerHTML = [...new Set(problems)].map((p) => `<li>${esc(p)}</li>`).join("");
  $("save").disabled = !token || problems.length > 0;
  $("save").textContent = token ? "Save" : "Token needed to save";
  return { event, brackets };
}

function addAnswer(answer = {}) {
  const box = $("answer").content.firstElementChild.cloneNode(true);
  for (const f of ["id", "text", "effects", "note"]) box.querySelector(`[data-f="${f}"]`).value = answer[f] ?? "";
  box.querySelector('[data-f="needs"]').value = (answer.needs || []).join("\n");
  box.querySelector("[data-remove]").addEventListener("click", () => { box.remove(); review(); });
  $("answers").append(box);
}

function fill(event, isNew, sha) {
  current = { isNew, sha, file: isNew ? null : index.find((r) => r.id === event.id)?.file };
  for (const f of ["id", "was", "title", "group", "order", "type", "level", "status", "fires", "text", "leads"]) form.elements[f].value = event[f] ?? "";
  form.elements.needs.value = (event.needs || []).join("\n");
  form.elements.id.readOnly = !isNew;
  $("answers").replaceChildren();
  (event.answers || []).forEach(addAnswer);
  form.hidden = false;
  $("empty").hidden = true;
  $("saved").textContent = "";
  review();
}

async function open(id) {
  const row = index.find((r) => r.id === id);
  const file = await read(row.file);
  if (!file) { $("empty").textContent = "That event could not be read."; return; }
  fill(jsyaml.load(file.text), false, file.sha);
  list();
}

function list() {
  const q = $("search").value.trim().toLowerCase();
  const group = $("group").value, status = $("status").value;
  const rows = index.filter((r) => (!group || r.group === group) && (!status || r.status === status)
    && (!q || `${r.id} ${r.title} ${r.was}`.toLowerCase().includes(q)));
  const openId = form.hidden ? "" : form.elements.id.value;
  $("list").innerHTML = rows.map((r) => `<li data-id="${esc(r.id)}"${r.id === openId ? ' aria-current="true"' : ""}>
    <div class="t"><span>${esc(r.title)}</span><span class="s">${esc(r.status)}${r.brackets ? ` · ${r.brackets}` : ""}</span></div>
    <div class="i">${esc(r.id)}</div></li>`).join("");
  const tally = {};
  index.forEach((r) => { tally[r.status] = (tally[r.status] || 0) + 1; });
  $("counts").innerHTML = `<span><b>${index.length}</b> events</span>` + registry.values.statuses.map((s) => `<span><b>${tally[s] || 0}</b> ${esc(s)}</span>`).join("");
}

function options(select, values, first) {
  select.innerHTML = (first ? `<option value="">${esc(first)}</option>` : "") + values.map((v) => `<option>${esc(v)}</option>`).join("");
}

async function start() {
  const [reg, pk, idx] = await Promise.all([read("registry.yaml"), read("picks.yaml"), read("index.json")]);
  registry = jsyaml.load(reg.text);
  picks = jsyaml.load(pk.text);
  index = JSON.parse(idx.text);
  scopes = Object.fromEntries(Object.entries(registry.scopes).map(([k, v]) => [k, new Set(flatten(v))]));
  const groups = [...new Set(index.map((r) => r.group))];
  options($("group"), groups, "All groups");
  options($("status"), registry.values.statuses, "Any status");
  $("groups").innerHTML = groups.map((g) => `<option value="${esc(g)}">`).join("");
  options(form.elements.type, registry.values.types);
  options(form.elements.level, registry.values.levels);
  options(form.elements.status, registry.values.statuses);
  const people = Object.keys(registry.scopes).filter((s) => scopes[s].has("first_name"));
  $("calls").innerHTML = `<div><b>People</b> ${people.map(esc).join(", ")}<br><code>${[...scopes[people[0]]].filter((p) => !["office", "field", "upbringing", "faith", "motivation", "money", "hometown"].includes(p)).map(esc).join(" · ")}</code></div>`
    + Object.keys(registry.scopes).filter((s) => !people.includes(s) || s === "player").map((s) => `<div><b>${esc(s)}</b> <code>${[...scopes[s]].filter((p) => s !== "player" || ["office", "field", "upbringing", "faith", "motivation", "money", "hometown"].includes(p)).map(esc).join(" · ")}</code></div>`).join("");
  $("picks").innerHTML = Object.keys(picks).map((p) => `<div><code>{pick: ${esc(p)}}</code></div>`).join("");
  list();
}

$("list").addEventListener("click", (e) => { const li = e.target.closest("li"); if (li) open(li.dataset.id); });
for (const id of ["search", "group", "status"]) $(id).addEventListener("input", list);
form.addEventListener("input", review);
$("add-answer").addEventListener("click", () => { addAnswer(); review(); });
$("new").addEventListener("click", () => {
  fill({ id: "", type: "decision", level: "local", status: "drafted", order: (index.at(-1)?.order || 0) + 10, text: "[]", answers: [] }, true, null);
  form.elements.id.focus();
});

$("token").value = token;
$("token").addEventListener("change", (e) => { token = e.target.value.trim(); store.token = token; start().catch(fail); if (!form.hidden) review(); });

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const { event, brackets } = review();
  if ($("save").disabled) return;
  $("save").disabled = true;
  $("saved").textContent = "Saving";
  try {
    const file = current.file || `events/${event.id.split(".")[0]}/${event.id}.yaml`;
    const saved = await write(file, jsyaml.dump(event, { lineWidth: -1 }), current.sha, `${current.isNew ? "Add" : "Edit"} ${event.id}`);
    const live = await github("index.json");
    const rows = JSON.parse(decode(live.content)).filter((r) => r.id !== event.id);
    rows.push({ id: event.id, file, was: event.was, title: event.title, group: event.group, order: event.order, type: event.type, level: event.level, status: event.status, answers: event.answers.map((a) => a.id), brackets });
    rows.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    await write("index.json", JSON.stringify(rows, null, 0) + "\n", live.sha, `Index ${event.id}`);
    index = rows;
    current = { isNew: false, sha: saved.content.sha, file };
    form.elements.id.readOnly = true;
    $("saved").textContent = "Saved";
    list();
  } catch (error) {
    $("saved").textContent = `Not saved. ${error.message}`;
  }
  review();
});

const fail = (error) => { $("empty").hidden = false; $("empty").textContent = `Could not load the events. ${error.message}`; };
start().catch(fail);
