"use strict";

// Filters, search and cards for one day page. The data is a JSON block written into the page
// at build time, so the page works from a static host with no requests after load.
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
  const REGISTRATION = { open: "RSVP", waitlist: "Waitlist", full: "Full", closed: "Closed" };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const PREVIEW = 6;

  const byId = (id) => document.getElementById(id);
  const esc = (value) =>
    String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
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
  const jobUrl = (id) => `https://www.linkedin.com/jobs/view/${encodeURIComponent(id)}/`;
  const onlyRemote = (role) => role.regions.length === 1 && role.regions[0] === "remote";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const inPost = new Set(data.post);
  const industries = [...new Set(data.companies.map((c) => c.industry))].sort();
  const usedFamilies = FAMILIES.filter((f) => data.companies.some((c) => c.roles.some((r) => r.family === f)));
  const usedLevels = LEVELS.filter((l) => data.companies.some((c) => c.roles.some((r) => r.level === l)));

  const defaults = () => ({
    scope: "post", tiers: new Set(), regions: new Set(), q: "",
    industry: "", family: "", level: "", ai: false, fresh: false,
  });
  let state = defaults();
  const expanded = new Set();

  function readQuery() {
    const params = new URLSearchParams(location.search);
    const pick = (key, allowed, into) => {
      for (const value of (params.get(key) || "").split(",")) if (allowed.includes(value)) into.add(value);
    };
    if (params.get("scope") === "all") state.scope = "all";
    pick("stage", TIERS.map(([k]) => k), state.tiers);
    pick("loc", REGIONS.map(([k]) => k), state.regions);
    state.q = (params.get("q") || "").trim().toLowerCase();
    if (industries.includes(params.get("industry"))) state.industry = params.get("industry");
    if (usedFamilies.includes(params.get("type"))) state.family = params.get("type");
    if (usedLevels.includes(params.get("level"))) state.level = params.get("level");
    state.ai = params.get("ai") === "1";
    state.fresh = params.get("new") === "1";
  }

  function writeQuery() {
    const params = new URLSearchParams();
    if (state.scope === "all") params.set("scope", "all");
    if (state.tiers.size) params.set("stage", [...state.tiers].join(","));
    if (state.regions.size) params.set("loc", [...state.regions].join(","));
    if (state.q) params.set("q", state.q);
    if (state.industry) params.set("industry", state.industry);
    if (state.family) params.set("type", state.family);
    if (state.level) params.set("level", state.level);
    if (state.ai) params.set("ai", "1");
    if (state.fresh) params.set("new", "1");
    const query = params.toString();
    try {
      history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
    } catch {
      // Some browsers refuse history changes on file:// pages; the filters still work.
    }
  }

  function chips(container, items, key) {
    container.innerHTML = items
      .map(([value, label]) =>
        `<button type="button" class="chip" data-key="${key}" data-value="${esc(value)}" aria-pressed="false">${esc(label)}</button>`)
      .join("");
  }

  function options(select, label, values) {
    select.innerHTML = `<option value="">${esc(label)}</option>` +
      values.map((value) => `<option>${esc(value)}</option>`).join("");
  }

  function syncControls() {
    for (const chip of document.querySelectorAll(".chip[data-key]")) {
      const { key, value } = chip.dataset;
      const on = key === "scope" ? state.scope === value : state[key].has(value);
      chip.setAttribute("aria-pressed", String(on));
    }
    byId("industry").value = state.industry;
    byId("family").value = state.family;
    byId("level").value = state.level;
    byId("ai").checked = state.ai;
    byId("fresh").checked = state.fresh;
    const active = state.tiers.size + state.regions.size +
      [state.industry, state.family, state.level, state.ai, state.fresh].filter(Boolean).length;
    byId("filters-count").textContent = active ? String(active) : "";
  }

  function roleMatches(role, companyHit) {
    if (state.regions.size && !role.regions.some((r) => state.regions.has(r))) return false;
    if (state.family && role.family !== state.family) return false;
    if (state.level && role.level !== state.level) return false;
    if (state.ai && !role.ai) return false;
    if (state.fresh && !role.new) return false;
    if (state.q && !companyHit && !role.title.toLowerCase().includes(state.q)) return false;
    return true;
  }

  function visibleRows() {
    const rows = [];
    for (const company of data.companies) {
      if (state.scope === "post" && !inPost.has(company.name)) continue;
      if (state.tiers.size && !state.tiers.has(company.tier)) continue;
      if (state.industry && company.industry !== state.industry) continue;
      const hit = Boolean(state.q) && company.name.toLowerCase().includes(state.q);
      const roles = company.roles.filter((role) => roleMatches(role, hit));
      if (roles.length) rows.push([company, roles]);
    }
    return rows;
  }

  function roleItem(role) {
    const where = onlyRemote(role) ? '<span class="tag">US remote</span>' : `<span>${esc(role.location)}</span>`;
    const tags = (role.ai ? '<span class="tag">AI</span>' : "") +
      (role.new ? '<span class="tag new">New</span>' : "");
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
    const events = company.events
      .map((e) =>
        `<li><a href="${esc(e.url)}" target="_blank" rel="noopener"><span class="t">${esc(clock(e.time))}</span>` +
        `<span class="n">${esc(e.name)}</span><span class="r">${esc(REGISTRATION[e.registration] || "Details")}</span></a></li>`)
      .join("");
    const more = open ? "" :
      `<button type="button" class="more" data-expand="${esc(company.slug)}">Show all ${roles.length} roles</button>`;
    return `<article class="co" id="co-${esc(company.slug)}" tabindex="-1">` +
      `<header class="co-h"><h3>${esc(company.name)}</h3><span class="stage">${esc(company.stage)}</span>` +
      `<span class="ind">${esc(company.industry)}</span></header>` +
      `<p class="desc">${esc(company.summary)}</p>` +
      `<ul class="ev" aria-label="Events today">${events}</ul>${blocks}${more}</article>`;
  }

  function render() {
    syncControls();
    const rows = visibleRows();
    const roles = rows.reduce((sum, [, list]) => sum + list.length, 0);
    const companies = `${rows.length} ${rows.length === 1 ? "company" : "companies"}`;
    byId("count-text").textContent = `${companies} · ${roles.toLocaleString("en-US")} ${roles === 1 ? "role" : "roles"}`;
    byId("sheet-show").textContent = `Show ${roles.toLocaleString("en-US")} ${roles === 1 ? "role" : "roles"}`;
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
      const company = data.companies.find((c) => c.slug === slug);
      state = defaults();
      if (company && !inPost.has(company.name)) state.scope = "all";
      byId("q").value = "";
      render();
    }
    const target = byId(`co-${slug}`);
    if (!target) return;
    const far = Math.abs(target.getBoundingClientRect().top) > window.innerHeight * 1.5;
    target.scrollIntoView({ block: "start", behavior: reducedMotion || far ? "auto" : "smooth" });
    target.focus({ preventScroll: true });
  }

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

  document.addEventListener("click", (event) => {
    const chip = event.target.closest(".chip[data-key]");
    if (chip) {
      const { key, value } = chip.dataset;
      if (key === "scope") state.scope = value;
      else if (state[key].has(value)) state[key].delete(value);
      else state[key].add(value);
      render();
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
  for (const key of ["industry", "family", "level"]) {
    byId(key).addEventListener("change", (event) => {
      state[key] = event.target.value;
      render();
    });
  }
  for (const key of ["ai", "fresh"]) {
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

  chips(byId("scope"), [
    ["post", `In today's post (${data.post.length})`],
    ["all", `All hosts (${data.companies.length})`],
  ], "scope");
  chips(byId("tiers"), TIERS.filter(([key]) => data.companies.some((c) => c.tier === key)), "tiers");
  chips(byId("regions"), REGIONS, "regions");
  options(byId("industry"), "All industries", industries);
  options(byId("family"), "All job types", usedFamilies);
  options(byId("level"), "All levels", usedLevels);

  readQuery();
  byId("q").value = state.q;
  render();
  if (location.hash.startsWith("#co-")) reveal(location.hash.slice(4));
})();
