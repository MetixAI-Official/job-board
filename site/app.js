"use strict";

// One day page: the field chooser, the event board and the host cards all read the same JSON
// block written into the page at build time, so the page makes no requests after it loads.
(() => {
  document.documentElement.classList.remove("no-js");

  const data = JSON.parse(document.getElementById("day-data").textContent);

  const TIERS = [
    ["early", "Seed to Series B"],
    ["growth", "Series C and later"],
    ["large", "Public and large"],
    ["vc", "Investors"],
    ["pro", "Professional services"],
  ];
  const REGIONS = [
    ["sf", "San Francisco"],
    ["pen", "Peninsula and South Bay"],
    ["east", "East Bay"],
    ["north", "North Bay"],
    ["remote", "US remote"],
  ];
  const FAMILIES = [
    "AI / ML", "Software engineering", "Data", "Product", "Design", "Solutions / FDE",
    "Sales / BD", "Marketing / growth", "Customer success", "Operations", "Finance / accounting",
    "Legal / compliance", "People / recruiting", "Hardware / supply chain", "Consulting",
    "Contract", "Other",
  ];
  const LEVELS = [
    "Internship", "Entry level", "Associate", "Mid-senior", "Director", "Executive", "Not specified",
  ];
  const REGISTRATION = { open: "Open", waitlist: "Waitlist", full: "Full", closed: "Closed" };
  const PERIODS = [["Morning", "00:00", "11:59"], ["Afternoon", "12:00", "16:59"], ["Evening", "17:00", "23:59"]];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const PREVIEW = 6;
  const FIELD_CHIPS = 8;

  const byId = (id) => document.getElementById(id);
  const esc = (value) =>
    String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const slugify = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const shortDate = (iso) => {
    const [, month, day] = iso.split("-").map(Number);
    return `${MONTHS[month - 1]} ${day}`;
  };
  const clock = (hhmm) => {
    if (!hhmm) return "";
    const [h, m] = hhmm.split(":").map(Number);
    const suffix = h >= 12 ? "pm" : "am";
    const hour = h % 12 || 12;
    return m ? `${hour}:${String(m).padStart(2, "0")}${suffix}` : `${hour}${suffix}`;
  };
  const plural = (n, word) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
  const jobUrl = (id) => `https://www.linkedin.com/jobs/view/${encodeURIComponent(id)}/`;
  const onlyRemote = (role) => role.regions.length === 1 && role.regions[0] === "remote";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const inPost = new Set(data.post);
  const companies = new Map(data.companies.map((c) => [c.name, c]));
  const events = new Map(data.events.map((e) => [e.id, e]));
  const familyCounts = new Map();
  for (const c of data.companies) for (const r of c.roles) familyCounts.set(r.family, (familyCounts.get(r.family) || 0) + 1);
  const fields = FAMILIES.filter((f) => familyCounts.has(f)).sort((a, b) => familyCounts.get(b) - familyCounts.get(a));
  const fieldBySlug = new Map(fields.map((f) => [slugify(f), f]));
  const usedLevels = LEVELS.filter((l) => data.companies.some((c) => c.roles.some((r) => r.level === l)));

  const defaults = () => ({
    field: "", regions: new Set(), tiers: new Set(), q: "", level: "", fresh: false, ai: false, inpost: false,
  });
  let state = defaults();
  let moreFields = false;
  const expanded = new Set();

  // -- URL state ---------------------------------------------------------------------------

  function readQuery() {
    const params = new URLSearchParams(location.search);
    const pick = (key, allowed, into) => {
      for (const value of (params.get(key) || "").split(",")) if (allowed.includes(value)) into.add(value);
    };
    if (fieldBySlug.has(params.get("field"))) state.field = fieldBySlug.get(params.get("field"));
    pick("loc", REGIONS.map(([k]) => k), state.regions);
    pick("stage", TIERS.map(([k]) => k), state.tiers);
    state.q = (params.get("q") || "").trim().toLowerCase();
    if (usedLevels.includes(params.get("level"))) state.level = params.get("level");
    state.fresh = params.get("new") === "1";
    state.ai = params.get("ai") === "1";
    state.inpost = params.get("post") === "1";
  }

  function writeQuery() {
    const params = new URLSearchParams();
    if (state.field) params.set("field", slugify(state.field));
    if (state.regions.size) params.set("loc", [...state.regions].join(","));
    if (state.tiers.size) params.set("stage", [...state.tiers].join(","));
    if (state.q) params.set("q", state.q);
    if (state.level) params.set("level", state.level);
    if (state.fresh) params.set("new", "1");
    if (state.ai) params.set("ai", "1");
    if (state.inpost) params.set("post", "1");
    const query = params.toString();
    try {
      history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
    } catch {
      // Some browsers refuse history changes on file:// pages; the filters still work.
    }
  }

  // -- matching ---------------------------------------------------------------------------

  function roleMatches(role, companyHit) {
    if (state.field && role.family !== state.field) return false;
    if (state.regions.size && !role.regions.some((r) => state.regions.has(r))) return false;
    if (state.level && role.level !== state.level) return false;
    if (state.fresh && !role.new) return false;
    if (state.ai && !role.ai) return false;
    if (state.q && !companyHit && !role.title.toLowerCase().includes(state.q)) return false;
    return true;
  }

  function companyMatches(company) {
    if (state.inpost && !inPost.has(company.name)) return false;
    if (state.tiers.size && !state.tiers.has(company.tier)) return false;
    return true;
  }

  function visibleRows() {
    const rows = [];
    for (const company of data.companies) {
      if (!companyMatches(company)) continue;
      const hit = Boolean(state.q) && company.name.toLowerCase().includes(state.q);
      const roles = company.roles.filter((role) => roleMatches(role, hit));
      if (roles.length) rows.push([company, roles]);
    }
    rows.sort((a, b) =>
      b[1].length - a[1].length ||
      b[1].filter((r) => r.new).length - a[1].filter((r) => r.new).length ||
      a[0].name.localeCompare(b[0].name));
    return rows;
  }

  // -- controls ---------------------------------------------------------------------------

  function chips(container, items, key) {
    container.innerHTML = items
      .map(([value, label]) =>
        `<button type="button" class="chip" data-key="${key}" data-value="${esc(value)}" aria-pressed="false">${esc(label)}</button>`)
      .join("");
  }

  function renderFields() {
    const shown = moreFields ? fields : fields.slice(0, FIELD_CHIPS);
    const total = data.companies.reduce((n, c) => n + c.roles.length, 0);
    const chip = (value, label, count) =>
      `<button type="button" class="chip field" data-key="field" data-value="${esc(value)}" aria-pressed="${String(state.field === value)}">${esc(label)} <b>${count.toLocaleString("en-US")}</b></button>`;
    let html = chip("", "All fields", total) + shown.map((f) => chip(f, f, familyCounts.get(f))).join("");
    if (fields.length > FIELD_CHIPS) {
      html += `<button type="button" class="chip field more-fields" data-more-fields aria-expanded="${String(moreFields)}">${moreFields ? "Fewer fields" : `${fields.length - FIELD_CHIPS} more`}</button>`;
    }
    byId("fields").innerHTML = html;
  }

  function syncControls() {
    for (const chip of document.querySelectorAll(".chip[data-key]")) {
      const { key, value } = chip.dataset;
      const on = key === "field" ? state.field === value : state[key].has(value);
      chip.setAttribute("aria-pressed", String(on));
    }
    byId("level").value = state.level;
    byId("fresh").checked = state.fresh;
    byId("ai").checked = state.ai;
    byId("inpost").checked = state.inpost;
    const active = state.regions.size + state.tiers.size +
      [state.level, state.fresh, state.ai, state.inpost].filter(Boolean).length;
    byId("filters-count").textContent = active ? String(active) : "";
  }

  // -- the board ----------------------------------------------------------------------------

  function pickTitles(roles) {
    return [...roles].sort((a, b) => Number(b.new) - Number(a.new) || b.posted.localeCompare(a.posted)).slice(0, 3);
  }

  function hostLine(company, roles) {
    const inField = state.field ? ` <span class="bh-field">${roles.length} in ${esc(state.field)}</span>` : "";
    const total = company.roles.length;
    const titles = pickTitles(roles)
      .map((r) => `<a href="${jobUrl(r.id)}" target="_blank" rel="noopener">${esc(r.title)}</a>${r.new ? '<span class="tag new">New</span>' : ""}`)
      .join("");
    return `<li class="bh"><div class="bh-h"><a class="bh-name" href="#co-${esc(company.slug)}" data-jump="${esc(company.slug)}">${esc(company.name)}</a>` +
      `<span class="bh-count">${plural(total, "role")}${inField}</span></div>` +
      `<div class="bh-titles">${titles}<a class="bh-all" href="#co-${esc(company.slug)}" data-jump="${esc(company.slug)}">All roles</a></div></li>`;
  }

  function renderBoard(rows) {
    const matching = new Map(rows.map(([company, roles]) => [company.name, roles]));
    const groups = PERIODS.map(([label]) => [label, []]);
    let shownEvents = 0;
    for (const event of data.events) {
      const hosts = event.hosts.filter((name) => matching.has(name));
      if (!hosts.length) continue;
      shownEvents += 1;
      const period = PERIODS.find(([, from, to]) => event.start >= from && event.start <= to) || PERIODS[0];
      const meta = [event.neighborhood, event.formats[0]].filter(Boolean).map(esc).join(" · ");
      const reg = REGISTRATION[event.registration] || "Details";
      groups.find(([label]) => label === period[0])[1].push(
        `<article class="bev"><div class="bev-h"><a class="bev-time" href="${esc(event.url)}" target="_blank" rel="noopener">${esc(clock(event.start))}</a>` +
        `<div class="bev-main"><a class="bev-name" href="${esc(event.url)}" target="_blank" rel="noopener">${esc(event.name)}</a>` +
        `<p class="bev-meta">${meta}${meta ? " · " : ""}<span class="reg reg-${esc(event.registration)}">${esc(reg)}</span></p></div></div>` +
        `<ul class="bev-hosts">${hosts.map((name) => hostLine(companies.get(name), matching.get(name))).join("")}</ul></article>`);
    }
    byId("board").innerHTML = groups
      .filter(([, items]) => items.length)
      .map(([label, items]) => `<section class="period"><h3>${label}</h3>${items.join("")}</section>`)
      .join("") || '<p class="board-note">No events today have hosts hiring for these filters. Try another field.</p>';
    const what = state.field ? `hosts hiring in ${state.field}` : "hiring hosts";
    byId("board-note").textContent = `${plural(shownEvents, "event")} with ${rows.length} ${what}. Times are Pacific.`;
  }

  // -- host cards --------------------------------------------------------------------------

  function roleItem(role) {
    const where = onlyRemote(role) ? '<span class="tag">US remote</span>' : `<span>${esc(role.location)}</span>`;
    const tags = (role.ai ? '<span class="tag">AI</span>' : "") + (role.new ? '<span class="tag new">New</span>' : "");
    return `<li><a href="${jobUrl(role.id)}" target="_blank" rel="noopener">${esc(role.title)}</a>` +
      `<span class="meta">${where}<span>${esc(role.level)}</span><span>${shortDate(role.posted)}</span>${tags}</span></li>`;
  }

  function card(company, roles) {
    const groups = new Map();
    for (const role of roles) {
      if (!groups.has(role.family)) groups.set(role.family, []);
      groups.get(role.family).push(role);
    }
    const open = expanded.has(company.slug) || roles.length <= PREVIEW + 2;
    let budget = open ? Infinity : PREVIEW;
    const blocks = [...groups.keys()]
      .sort((a, b) => FAMILIES.indexOf(a) - FAMILIES.indexOf(b))
      .map((family) => {
        const list = groups.get(family);
        const shown = list.slice(0, Math.max(0, budget));
        budget -= shown.length;
        if (!shown.length) return "";
        return `<div class="fam"><h4>${esc(family)} · ${list.length}</h4><ul>${shown.map(roleItem).join("")}</ul></div>`;
      })
      .join("");
    const todays = company.events.map((id) => events.get(id)).filter(Boolean)
      .map((e) =>
        `<li><a href="${esc(e.url)}" target="_blank" rel="noopener"><span class="t">${esc(clock(e.start))}</span>` +
        `<span class="n">${esc(e.name)}</span><span class="r">${esc(REGISTRATION[e.registration] || "Details")}</span></a></li>`)
      .join("");
    const stage = company.stage ? `<span class="stage">${esc(company.stage)}</span>` : "";
    const more = open ? "" :
      `<button type="button" class="more" data-expand="${esc(company.slug)}">Show all ${roles.length} roles</button>`;
    return `<article class="co" id="co-${esc(company.slug)}" tabindex="-1">` +
      `<header class="co-h"><h3>${esc(company.name)}</h3>${stage}<span class="ind">${esc(company.label || company.industry)}</span></header>` +
      `<p class="desc">${esc(company.summary)}</p>` +
      `<ul class="ev" aria-label="Events today">${todays}</ul>${blocks}${more}</article>`;
  }

  function render() {
    renderFields();
    syncControls();
    const rows = visibleRows();
    const roles = rows.reduce((sum, [, list]) => sum + list.length, 0);
    byId("count-text").textContent = `${plural(rows.length, "host")} · ${plural(roles, "role")}`;
    byId("sheet-show").textContent = `Show ${plural(roles, "role")}`;
    renderBoard(rows);
    byId("list").innerHTML = rows.length
      ? rows.map(([company, list]) => card(company, list)).join("")
      : '<p class="empty">No roles match these filters. <button type="button" class="link-btn" data-reset>Clear filters</button></p>';
    writeQuery();
  }

  function reset() {
    state = defaults();
    byId("q").value = "";
    render();
  }

  function reveal(slug) {
    if (!byId(`co-${slug}`)) {
      state = defaults();
      byId("q").value = "";
      render();
    }
    const target = byId(`co-${slug}`);
    if (!target) return;
    const far = Math.abs(target.getBoundingClientRect().top) > window.innerHeight * 1.5;
    target.scrollIntoView({ block: "start", behavior: reducedMotion || far ? "auto" : "smooth" });
    target.focus({ preventScroll: true });
  }

  // -- filter sheet on small screens --------------------------------------------------------

  const sheet = byId("filters");
  const scrim = byId("scrim");
  const opener = byId("filters-btn");

  function setSheet(open) {
    if (open) {
      sheet.setAttribute("data-open", "");
      scrim.setAttribute("data-open", "");
      document.body.classList.add("sheet-open");
      opener.setAttribute("aria-expanded", "true");
      sheet.querySelector(".chip, select, input")?.focus();
    } else {
      sheet.removeAttribute("data-open");
      scrim.removeAttribute("data-open");
      document.body.classList.remove("sheet-open");
      opener.setAttribute("aria-expanded", "false");
      opener.focus();
    }
  }

  // -- events -------------------------------------------------------------------------------

  document.addEventListener("click", (event) => {
    const chip = event.target.closest(".chip[data-key]");
    if (chip) {
      const { key, value } = chip.dataset;
      if (key === "field") state.field = value;
      else if (state[key].has(value)) state[key].delete(value);
      else state[key].add(value);
      render();
      return;
    }
    if (event.target.closest("[data-more-fields]")) {
      moreFields = !moreFields;
      renderFields();
      return;
    }
    const more = event.target.closest("[data-expand]");
    if (more) {
      expanded.add(more.dataset.expand);
      render();
      return;
    }
    if (event.target.closest("[data-reset]")) {
      reset();
      return;
    }
    const jump = event.target.closest("a[data-jump]");
    if (jump) {
      event.preventDefault();
      reveal(jump.dataset.jump);
    }
  });

  let typing;
  byId("q").addEventListener("input", (event) => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      state.q = event.target.value.trim().toLowerCase();
      render();
    }, 120);
  });
  byId("level").addEventListener("change", (event) => {
    state.level = event.target.value;
    render();
  });
  for (const key of ["fresh", "ai", "inpost"]) {
    byId(key).addEventListener("change", (event) => {
      state[key] = event.target.checked;
      render();
    });
  }
  opener.addEventListener("click", () => setSheet(!sheet.hasAttribute("data-open")));
  scrim.addEventListener("click", () => setSheet(false));
  byId("sheet-close").addEventListener("click", () => setSheet(false));
  byId("sheet-show").addEventListener("click", () => setSheet(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sheet.hasAttribute("data-open")) setSheet(false);
  });

  chips(byId("regions"), REGIONS, "regions");
  chips(byId("tiers"), TIERS.filter(([key]) => data.companies.some((c) => c.tier === key)), "tiers");
  byId("level").innerHTML = '<option value="">All levels</option>' + usedLevels.map((l) => `<option>${esc(l)}</option>`).join("");

  readQuery();
  byId("q").value = state.q;
  render();
  if (location.hash.startsWith("#co-")) reveal(location.hash.slice(4));
})();
