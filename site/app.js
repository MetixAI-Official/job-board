"use strict";

// One day page. The schedule is the only list: each event opens to show the hosts hiring for
// the chosen field and their roles. Wide screens show the open event in a side pane; phones
// expand it in place. Everything reads one JSON block written at build time.
(() => {
  document.documentElement.classList.remove("no-js");

  const data = JSON.parse(document.getElementById("day-data").textContent);
  const PAGE_DATE = document.body.dataset.date;

  const FAMILIES = [
    "AI / ML", "Software engineering", "Data", "Product", "Design", "Solutions / FDE",
    "Sales / BD", "Marketing / growth", "Customer success", "Operations", "Finance / accounting",
    "Legal / compliance", "People / recruiting", "Hardware / supply chain", "Consulting",
    "Contract", "Other",
  ];
  const LEVELS = [
    "Internship", "Entry level", "Associate", "Mid-senior", "Director", "Executive", "Not specified",
  ];
  const LOCATIONS = [
    ["", "All locations"], ["sf", "San Francisco"], ["pen", "Peninsula and South Bay"],
    ["east", "East Bay"], ["north", "North Bay"], ["remote", "US remote"],
  ];
  const REGISTRATION = { open: "Open", waitlist: "Waitlist", full: "Full", closed: "Closed" };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const FIELD_CHIPS = 8;
  const ROLE_PREVIEW = 8;

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
  const wide = window.matchMedia("(min-width: 960px)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // The time now in San Francisco, as "HH:MM", when the page's date is today there.
  function nowInPacific() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type).value;
    const date = `${get("year")}-${get("month")}-${get("day")}`;
    const hour = get("hour") === "24" ? "00" : get("hour");
    return date === PAGE_DATE ? `${hour}:${get("minute")}` : null;
  }

  const companies = new Map(data.companies.map((c) => [c.name, c]));
  const familyCounts = new Map();
  for (const c of data.companies) for (const r of c.roles) familyCounts.set(r.family, (familyCounts.get(r.family) || 0) + 1);
  const fields = FAMILIES.filter((f) => familyCounts.has(f)).sort((a, b) => familyCounts.get(b) - familyCounts.get(a));
  const fieldBySlug = new Map(fields.map((f) => [slugify(f), f]));
  const usedLevels = LEVELS.filter((l) => data.companies.some((c) => c.roles.some((r) => r.level === l)));

  const defaults = () => ({ field: "", loc: "", level: "", fresh: false, ai: false, q: "", open: null, showPast: false });
  let state = defaults();
  let moreFields = false;
  const expandedHosts = new Set();

  // -- URL state ---------------------------------------------------------------------------

  function readQuery() {
    const params = new URLSearchParams(location.search);
    if (fieldBySlug.has(params.get("field"))) state.field = fieldBySlug.get(params.get("field"));
    if (LOCATIONS.some(([k]) => k && k === params.get("loc"))) state.loc = params.get("loc");
    if (usedLevels.includes(params.get("level"))) state.level = params.get("level");
    state.fresh = params.get("new") === "1";
    state.ai = params.get("ai") === "1";
    state.q = (params.get("q") || "").trim().toLowerCase();
    if (params.get("e")) state.open = params.get("e");
  }

  function writeQuery() {
    const params = new URLSearchParams();
    if (state.field) params.set("field", slugify(state.field));
    if (state.loc) params.set("loc", state.loc);
    if (state.level) params.set("level", state.level);
    if (state.fresh) params.set("new", "1");
    if (state.ai) params.set("ai", "1");
    if (state.q) params.set("q", state.q);
    if (state.open) params.set("e", state.open);
    const query = params.toString();
    try {
      history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}`);
    } catch {
      // Some browsers refuse history changes on file:// pages; the page still works.
    }
  }

  // -- matching ---------------------------------------------------------------------------

  function roleMatches(role, companyHit) {
    if (state.field && role.family !== state.field) return false;
    if (state.loc && !role.regions.includes(state.loc)) return false;
    if (state.level && role.level !== state.level) return false;
    if (state.fresh && !role.new) return false;
    if (state.ai && !role.ai) return false;
    if (state.q && !companyHit && !role.title.toLowerCase().includes(state.q)) return false;
    return true;
  }

  function matchingRoles(company) {
    const hit = Boolean(state.q) && company.name.toLowerCase().includes(state.q);
    return company.roles.filter((role) => roleMatches(role, hit));
  }

  // Events in time order, each with its hosts that have at least one matching role.
  function schedule() {
    const perCompany = new Map(data.companies.map((c) => [c.name, matchingRoles(c)]));
    const items = [];
    for (const event of data.events) {
      const hosts = event.hosts
        .map((name) => [companies.get(name), perCompany.get(name)])
        .filter(([, roles]) => roles.length)
        .sort((a, b) => b[1].length - a[1].length || a[0].name.localeCompare(b[0].name));
      if (hosts.length) items.push({ event, hosts, roles: hosts.reduce((n, [, r]) => n + r.length, 0) });
    }
    return items;
  }

  // -- rendering: hero chips and controls -----------------------------------------------------

  function renderFields() {
    const shown = moreFields ? fields : fields.slice(0, FIELD_CHIPS);
    const total = data.companies.reduce((n, c) => n + c.roles.length, 0);
    const chip = (value, label, count) =>
      `<button type="button" class="chip field" data-field="${esc(value)}" aria-pressed="${String(state.field === value)}">${esc(label)} <b>${count.toLocaleString("en-US")}</b></button>`;
    let html = chip("", "All fields", total) + shown.map((f) => chip(f, f, familyCounts.get(f))).join("");
    if (fields.length > FIELD_CHIPS) {
      html += `<button type="button" class="chip field more-fields" data-more-fields aria-expanded="${String(moreFields)}">${moreFields ? "Fewer fields" : `${fields.length - FIELD_CHIPS} more`}</button>`;
    }
    byId("fields").innerHTML = html;
  }

  function syncControls() {
    byId("loc").value = state.loc;
    byId("level").value = state.level;
    byId("fresh").checked = state.fresh;
    byId("ai").checked = state.ai;
  }

  // -- rendering: the schedule -------------------------------------------------------------

  function hostSummary(hosts) {
    const names = hosts.map(([c]) => c.name);
    const shown = names.slice(0, 3).join(", ");
    return names.length > 3 ? `${shown} + ${names.length - 3}` : shown;
  }

  function row(item, isOpen, past) {
    const { event, hosts, roles } = item;
    const meta = [event.neighborhood, event.formats[0]].filter(Boolean).map(esc).join(" · ");
    const reg = REGISTRATION[event.registration] || "";
    const what = state.field ? `${plural(roles, "role")} in ${esc(state.field)}` : plural(roles, "role");
    return `<li class="ev${isOpen ? " is-open" : ""}${past ? " is-past" : ""}" data-id="${esc(event.id)}">` +
      `<button type="button" class="ev-btn" data-open="${esc(event.id)}" aria-expanded="${String(isOpen)}" aria-controls="d-${esc(event.id)}">` +
      `<span class="ev-time">${esc(clock(event.start))}</span>` +
      `<span class="ev-body"><span class="ev-name">${esc(event.name)}</span>` +
      `<span class="ev-meta">${meta}${meta && reg ? " · " : ""}${reg ? `<span class="reg reg-${esc(event.registration)}">${esc(reg)}</span>` : ""}</span>` +
      `<span class="ev-hosts">${esc(hostSummary(hosts))} · <b>${what}</b></span></span>` +
      `<span class="ev-chev" aria-hidden="true"></span></button>` +
      `<div class="ev-detail" id="d-${esc(event.id)}"${isOpen && !wide.matches ? "" : " hidden"}>${isOpen && !wide.matches ? detail(item) : ""}</div></li>`;
  }

  function roleItem(role) {
    const where = onlyRemote(role) ? '<span class="tag">US remote</span>' : `<span>${esc(role.location)}</span>`;
    const tags = (role.ai ? '<span class="tag">AI</span>' : "") + (role.new ? '<span class="tag new">New</span>' : "");
    return `<li><a href="${jobUrl(role.id)}" target="_blank" rel="noopener">${esc(role.title)}</a>` +
      `<span class="meta">${where}<span>${esc(role.level)}</span><span>${shortDate(role.posted)}</span>${tags}</span></li>`;
  }

  function hostBlock(company, roles, eventId) {
    const key = `${eventId}:${company.slug}`;
    const open = expandedHosts.has(key) || roles.length <= ROLE_PREVIEW + 2;
    const shown = open ? roles : roles.slice(0, ROLE_PREVIEW);
    const more = open ? "" :
      `<button type="button" class="more" data-expand="${esc(key)}">Show all ${roles.length} roles</button>`;
    const other = company.events.filter((id) => id !== eventId).length;
    const stage = company.stage ? `<span class="stage">${esc(company.stage)}</span>` : "";
    const also = other ? `<span class="also">also at ${plural(other, "other event")} today</span>` : "";
    return `<section class="host"><header class="host-h"><h3>${esc(company.name)}</h3>${stage}<span class="ind">${esc(company.label || "")}</span>${also}</header>` +
      `<p class="desc">${esc(company.summary)}</p>` +
      `<p class="host-n">${plural(roles.length, "role")}${state.field ? ` in ${esc(state.field)}` : ""}${roles.length < company.roles.length ? ` of ${company.roles.length} this week` : ""}</p>` +
      `<ul class="roles">${shown.map(roleItem).join("")}</ul>${more}</section>`;
  }

  function detail(item) {
    const { event, hosts } = item;
    const when = event.end ? `${clock(event.start)} to ${clock(event.end)}` : clock(event.start);
    const meta = [when, event.neighborhood, ...event.formats.slice(0, 2)].filter(Boolean).map(esc).join(" · ");
    const reg = REGISTRATION[event.registration];
    return `<header class="detail-h"><p class="eyebrow-dark">${meta}</p><h2 tabindex="-1" id="detail-title">${esc(event.name)}</h2>` +
      `<p class="detail-actions"><a class="btn small" href="${esc(event.url)}" target="_blank" rel="noopener">${reg ? `${esc(reg)} · ` : ""}Event page</a>` +
      `<span class="detail-note">${plural(hosts.length, "host")} hiring here</span></p></header>` +
      hosts.map(([company, roles]) => hostBlock(company, roles, event.id)).join("");
  }

  function render() {
    renderFields();
    syncControls();
    const items = schedule();
    const now = nowInPacific();
    const isPast = (item) => Boolean(now) && (item.event.end || item.event.start) < now;
    const upcoming = items.filter((i) => !isPast(i));
    const past = items.filter(isPast);
    if (!items.some((i) => i.event.id === state.open)) state.open = wide.matches ? (upcoming[0] || items[0] || {}).event?.id || null : null;

    const hostsSeen = new Set(items.flatMap((i) => i.hosts.map(([c]) => c.name)));
    const rolesSeen = new Set(items.flatMap((i) => i.hosts.flatMap(([, rs]) => rs.map((r) => r.id))));
    byId("count-text").textContent = items.length
      ? `${plural(items.length, "event")} · ${plural(hostsSeen.size, "host")} · ${plural(rolesSeen.size, "role")}${state.field ? ` in ${state.field}` : ""}`
      : "";

    let html = upcoming.map((i) => row(i, i.event.id === state.open, false)).join("");
    if (past.length) {
      html += `<li class="past-fold"><button type="button" class="link-btn" data-toggle-past aria-expanded="${String(state.showPast)}">${state.showPast ? "Hide" : "Show"} ${plural(past.length, "earlier event")}</button></li>`;
      if (state.showPast) html += past.map((i) => row(i, i.event.id === state.open, true)).join("");
    }
    byId("list").innerHTML = html || '<li class="empty">No event today has a host hiring for these filters. <button type="button" class="link-btn" data-reset>Clear filters</button></li>';

    const pane = byId("detail");
    const openItem = items.find((i) => i.event.id === state.open);
    if (wide.matches && openItem) {
      pane.hidden = false;
      pane.innerHTML = detail(openItem);
    } else {
      pane.hidden = true;
      pane.innerHTML = "";
    }
    writeQuery();
  }

  function openEvent(id) {
    state.open = state.open === id && !wide.matches ? null : id;
    render();
    if (!state.open) return;
    const target = wide.matches ? byId("detail") : document.querySelector(`.ev[data-id="${CSS.escape(id)}"]`);
    if (!target) return;
    if (!wide.matches) {
      const top = target.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight * 0.6) target.scrollIntoView({ block: "start", behavior: reducedMotion ? "auto" : "smooth" });
    }
    byId("detail-title")?.focus({ preventScroll: true });
  }

  function reset() {
    state = defaults();
    byId("q").value = "";
    render();
  }

  // -- events -------------------------------------------------------------------------------

  document.addEventListener("click", (event) => {
    const field = event.target.closest("[data-field]");
    if (field) {
      state.field = field.dataset.field;
      state.open = null;
      render();
      return;
    }
    if (event.target.closest("[data-more-fields]")) {
      moreFields = !moreFields;
      renderFields();
      return;
    }
    const open = event.target.closest("[data-open]");
    if (open) {
      openEvent(open.dataset.open);
      return;
    }
    const more = event.target.closest("[data-expand]");
    if (more) {
      expandedHosts.add(more.dataset.expand);
      render();
      return;
    }
    if (event.target.closest("[data-toggle-past]")) {
      state.showPast = !state.showPast;
      render();
      return;
    }
    if (event.target.closest("[data-reset]")) reset();
  });

  let typing;
  byId("q").addEventListener("input", (event) => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      state.q = event.target.value.trim().toLowerCase();
      state.open = null;
      render();
    }, 120);
  });
  for (const key of ["loc", "level"]) {
    byId(key).addEventListener("change", (event) => {
      state[key] = event.target.value;
      state.open = null;
      render();
    });
  }
  for (const key of ["fresh", "ai"]) {
    byId(key).addEventListener("change", (event) => {
      state[key] = event.target.checked;
      state.open = null;
      render();
    });
  }
  wide.addEventListener("change", render);

  byId("loc").innerHTML = LOCATIONS.map(([value, label]) => `<option value="${value}">${esc(label)}</option>`).join("");
  byId("level").innerHTML = '<option value="">All levels</option>' + usedLevels.map((l) => `<option>${esc(l)}</option>`).join("");

  readQuery();
  byId("q").value = state.q;
  render();
})();
