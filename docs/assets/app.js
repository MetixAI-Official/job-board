"use strict";

// One day page with two views of the same data. "By time" lists the day's events; each opens to
// show the hosts hiring for the chosen field and their roles. "By company" lists the hosts; each
// opens to show the company, its events today and its roles. Wide screens show the open item in a
// side pane; phones expand it in place. Everything reads one JSON block written at build time.
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
  const REGISTRATION_LONG = { open: "Registration open", waitlist: "Waitlist", full: "Full", closed: "Registration closed" };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const VIEWS = {
    time: "Today's events with hiring hosts",
    companies: "Companies hiring today, with their events",
  };
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
  const plural = (n, word, many = `${word}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? word : many}`;
  const jobUrl = (id) => `https://www.linkedin.com/jobs/view/${encodeURIComponent(id)}/`;
  const onlyRemote = (role) => role.regions.length === 1 && role.regions[0] === "remote";
  const eventIsPast = (event, now) => Boolean(now) && (event.end || event.start) < now;
  const wide = window.matchMedia("(min-width: 960px)");
  const narrow = window.matchMedia("(max-width: 719px)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const motion = () => (reducedMotion ? "auto" : "smooth");
  // Phones show fewer roles before "Show all"; the open item is read in place there.
  const rolePreview = () => (wide.matches ? 8 : 6);
  const focusOn = (selector) => document.querySelector(selector)?.focus({ preventScroll: true });

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
  const events = new Map(data.events.map((e) => [e.id, e]));
  const familyCounts = new Map();
  for (const c of data.companies) for (const r of c.roles) familyCounts.set(r.family, (familyCounts.get(r.family) || 0) + 1);
  const fields = FAMILIES.filter((f) => familyCounts.has(f)).sort((a, b) => familyCounts.get(b) - familyCounts.get(a));
  const fieldBySlug = new Map(fields.map((f) => [slugify(f), f]));
  const usedLevels = LEVELS.filter((l) => data.companies.some((c) => c.roles.some((r) => r.level === l)));
  const familyRank = new Map(FAMILIES.map((f, i) => [f, i]));

  const defaults = () => ({ view: "time", field: "", loc: "", level: "", fresh: false, ai: false, q: "", open: null, showPast: false });
  let state = defaults();
  let moreFields = false;
  let booted = false;
  // True when the open item was chosen by the page, not the reader; such a choice stays out of the URL.
  let autoOpened = false;
  const expanded = new Set();
  const filtering = () => Boolean(state.field || state.loc || state.level || state.fresh || state.ai || state.q);

  // -- URL state ---------------------------------------------------------------------------

  function readQuery() {
    const params = new URLSearchParams(location.search);
    if (params.get("view") === "companies") state.view = "companies";
    if (fieldBySlug.has(params.get("field"))) state.field = fieldBySlug.get(params.get("field"));
    if (LOCATIONS.some(([k]) => k && k === params.get("loc"))) state.loc = params.get("loc");
    if (usedLevels.includes(params.get("level"))) state.level = params.get("level");
    state.fresh = params.get("new") === "1";
    state.ai = params.get("ai") === "1";
    state.q = (params.get("q") || "").trim().toLowerCase();
    const open = params.get(state.view === "companies" ? "c" : "e");
    if (open) {
      state.open = open;
      autoOpened = false;
    }
  }

  // Filters replace the current history entry; moving between views or jumping to an item adds one,
  // so Back returns to where the reader was instead of leaving the page.
  function writeQuery(push) {
    const params = new URLSearchParams();
    if (state.view === "companies") params.set("view", "companies");
    if (state.field) params.set("field", slugify(state.field));
    if (state.loc) params.set("loc", state.loc);
    if (state.level) params.set("level", state.level);
    if (state.fresh) params.set("new", "1");
    if (state.ai) params.set("ai", "1");
    if (state.q) params.set("q", state.q);
    if (state.open && !autoOpened) params.set(state.view === "companies" ? "c" : "e", state.open);
    const query = params.toString();
    const url = `${location.pathname}${query ? `?${query}` : ""}`;
    if (url === `${location.pathname}${location.search}`) return;
    try {
      history[push ? "pushState" : "replaceState"](null, "", url);
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

  // Companies with at least one matching role, most roles first, each with its events today.
  function companyList() {
    const items = [];
    for (const company of data.companies) {
      const roles = matchingRoles(company);
      if (!roles.length) continue;
      const today = company.events.map((id) => events.get(id)).filter(Boolean)
        .sort((a, b) => a.start.localeCompare(b.start));
      items.push({ company, roles, events: today });
    }
    return items.sort((a, b) => b.roles.length - a.roles.length || a.company.name.localeCompare(b.company.name));
  }

  // -- rendering: hero chips and controls -----------------------------------------------------

  // Wide screens wrap the chips and fold the tail behind "N more"; narrow ones show every chip
  // in one scrolling rail and keep the chosen chip in view.
  function renderFields() {
    const shown = moreFields || narrow.matches ? fields : fields.slice(0, FIELD_CHIPS);
    const total = data.companies.reduce((n, c) => n + c.roles.length, 0);
    const chip = (value, label, count) =>
      `<button type="button" class="chip field" data-field="${esc(value)}" aria-pressed="${String(state.field === value)}">${esc(label)} <b>${count.toLocaleString("en-US")}</b></button>`;
    let html = chip("", "All fields", total) + shown.map((f) => chip(f, f, familyCounts.get(f))).join("");
    if (!narrow.matches && fields.length > FIELD_CHIPS) {
      html += `<button type="button" class="chip field more-fields" data-more-fields aria-expanded="${String(moreFields)}">${moreFields ? "Fewer fields" : `${fields.length - FIELD_CHIPS} more`}</button>`;
    }
    const rail = byId("fields");
    rail.innerHTML = html;
    const chosen = rail.querySelector('[aria-pressed="true"]');
    if (narrow.matches && chosen) {
      rail.scrollTo({ left: chosen.offsetLeft - (rail.clientWidth - chosen.offsetWidth) / 2, behavior: booted ? motion() : "auto" });
    }
  }

  function syncControls() {
    byId("loc").value = state.loc;
    byId("level").value = state.level;
    byId("fresh").checked = state.fresh;
    byId("ai").checked = state.ai;
    for (const button of document.querySelectorAll("[data-view]")) {
      button.setAttribute("aria-pressed", String(button.dataset.view === state.view));
    }
    byId("list").setAttribute("aria-label", VIEWS[state.view]);
  }

  // -- rendering: shared pieces --------------------------------------------------------------

  function roleItem(role) {
    const where = onlyRemote(role) ? '<span class="tag">US remote</span>' : `<span>${esc(role.location)}</span>`;
    const tags = (role.ai ? '<span class="tag">AI</span>' : "") + (role.new ? '<span class="tag new">New</span>' : "");
    return `<li><a href="${jobUrl(role.id)}" target="_blank" rel="noopener">${esc(role.title)}</a>` +
      `<span class="meta">${where}<span>${esc(role.level)}</span><span>${shortDate(role.posted)}</span>${tags}</span></li>`;
  }

  // A role list. Flat lists show a preview until expanded. Grouped lists (a company's roles with no
  // field chosen) show one heading per field; each opens on its own, or all at once.
  function roleList(key, roles, grouped) {
    const allOpen = expanded.has(key) || roles.length <= rolePreview() + 2;
    const more = allOpen ? "" : `<button type="button" class="more" data-expand="${esc(key)}">Show all ${roles.length} roles</button>`;
    if (!grouped) {
      const shown = allOpen ? roles : roles.slice(0, rolePreview());
      return `<ul class="roles">${shown.map(roleItem).join("")}</ul>${more}`;
    }
    let html = "";
    for (const family of [...new Set(roles.map((r) => r.family))]) {
      const group = roles.filter((r) => r.family === family);
      const groupKey = `${key}:${slugify(family)}`;
      const open = allOpen || expanded.has(groupKey);
      const label = `${esc(family)} <b>${group.length}</b>`;
      html += allOpen
        ? `<li class="grp">${label}</li>`
        : `<li class="grp"><button type="button" class="grp-btn" data-group="${esc(groupKey)}" aria-expanded="${String(open)}">${label}<span class="grp-chev" aria-hidden="true"></span></button></li>`;
      if (open) html += group.map(roleItem).join("");
    }
    return `<ul class="roles">${html}</ul>${more}`;
  }

  function roleCount(company, roles) {
    const n = roles.length;
    const total = company.roles.length;
    const base = n < total ? `${n.toLocaleString("en-US")} of ${plural(total, "role")} this week` : `${plural(n, "role")} this week`;
    return state.field ? `${base} · ${esc(state.field)}` : base;
  }

  function companyMeta(company) {
    return [company.stage, company.label, company.industry].filter(Boolean).map(esc).join(" · ");
  }

  function listRow(id, isOpen, extraClass, lead, body) {
    return `<li class="ev${extraClass}${isOpen ? " is-open" : ""}" data-id="${esc(id)}">` +
      `<button type="button" class="ev-btn" data-open="${esc(id)}" aria-expanded="${String(isOpen)}" aria-controls="d-${esc(id)}">` +
      `<span class="ev-time">${lead}</span><span class="ev-body">${body}</span><span class="ev-chev" aria-hidden="true"></span></button>` +
      `<div class="ev-detail" id="d-${esc(id)}" hidden></div></li>`;
  }

  // -- rendering: by time ------------------------------------------------------------------

  function hostSummary(hosts) {
    const names = hosts.map(([c]) => c.name);
    const shown = names.slice(0, 3).join(", ");
    return names.length > 3 ? `${shown} + ${names.length - 3}` : shown;
  }

  function eventRow(item, isOpen, past) {
    const { event, hosts, roles } = item;
    const meta = [event.neighborhood, event.formats[0]].filter(Boolean).map(esc).join(" · ");
    const reg = REGISTRATION[event.registration] || "";
    const body = `<span class="ev-name">${esc(event.name)}</span>` +
      `<span class="ev-meta">${meta}${meta && reg ? " · " : ""}${reg ? `<span class="reg reg-${esc(event.registration)}">${esc(reg)}</span>` : ""}</span>` +
      `<span class="ev-hosts">${esc(hostSummary(hosts))} · <b>${plural(roles, "role")}</b></span>`;
    return listRow(event.id, isOpen, past ? " is-past" : "", esc(clock(event.start)), body);
  }

  function hostBlock(company, roles, eventId) {
    const other = company.events.filter((id) => id !== eventId).length;
    const stage = company.stage ? `<span class="stage">${esc(company.stage)}</span>` : "";
    const also = other ? `<span class="also">also at ${plural(other, "other event")} today</span>` : "";
    return `<section class="host"><header class="host-h">` +
      `<h3><button type="button" class="co-link" data-go-company="${esc(company.slug)}" aria-label="${esc(company.name)}: company, events and all roles">${esc(company.name)}</button></h3>` +
      `${stage}<span class="ind">${esc(company.label || "")}</span>${also}</header>` +
      `<p class="desc">${esc(company.summary)}</p>` +
      `<p class="host-n">${roleCount(company, roles)}</p>` +
      roleList(`${eventId}:${company.slug}`, roles, false) + "</section>";
  }

  function eventDetail(item) {
    const { event, hosts } = item;
    const when = event.end ? `${clock(event.start)} to ${clock(event.end)}` : clock(event.start);
    const meta = [when, event.neighborhood, ...event.formats.slice(0, 2)].filter(Boolean).map(esc);
    const reg = REGISTRATION_LONG[event.registration];
    if (reg) meta.push(`<span class="reg reg-${esc(event.registration)}">${esc(reg)}</span>`);
    return `<header class="detail-h"><p class="eyebrow-dark">${meta.join(" · ")}</p><h2 tabindex="-1" id="detail-title">${esc(event.name)}</h2>` +
      `<p class="detail-actions"><a class="btn small" href="${esc(event.url)}" target="_blank" rel="noopener">Event page</a>` +
      `<span class="detail-note">${plural(hosts.length, "host")} hiring here</span></p></header>` +
      hosts.map(([company, roles]) => hostBlock(company, roles, event.id)).join("");
  }

  function renderSchedule() {
    const items = schedule();
    const now = nowInPacific();
    const past = items.filter((i) => eventIsPast(i.event, now));
    const upcoming = items.filter((i) => !eventIsPast(i.event, now));
    if (!items.some((i) => i.event.id === state.open)) {
      state.open = wide.matches ? (upcoming[0] || items[0] || {}).event?.id || null : null;
      autoOpened = true;
    }
    // Earlier events stay visible when the reader is looking at one, or when the day is over.
    if (past.some((i) => i.event.id === state.open) || (past.length && !upcoming.length)) state.showPast = true;

    const hostsSeen = new Set(items.flatMap((i) => i.hosts.map(([c]) => c.name)));
    const rolesSeen = new Set(items.flatMap((i) => i.hosts.flatMap(([, rs]) => rs.map((r) => r.id))));
    const count = `${plural(items.length, "event")} · ${plural(hostsSeen.size, "host")} · ${plural(rolesSeen.size, "role")}`;

    let html = "";
    if (past.length) {
      html += upcoming.length
        ? `<li class="past-fold"><button type="button" class="link-btn" data-toggle-past aria-expanded="${String(state.showPast)}">${state.showPast ? "Hide" : "Show"} ${plural(past.length, "earlier event")}</button></li>`
        : '<li class="past-fold">Today\'s events have ended. The roles stay open.</li>';
      if (state.showPast) html += past.map((i) => eventRow(i, i.event.id === state.open, true)).join("");
    }
    html += upcoming.map((i) => eventRow(i, i.event.id === state.open, false)).join("");
    const openItem = items.find((i) => i.event.id === state.open);
    return { count, html: items.length ? html : "", detail: openItem ? eventDetail(openItem) : "", empty: "No event today has a host hiring for these filters." };
  }

  // -- rendering: by company ---------------------------------------------------------------

  function companyRow(item, isOpen) {
    const { company, roles } = item;
    const today = item.events.map((e) => `${clock(e.start)} ${e.name}`).join(" · ");
    const lead = `${roles.length.toLocaleString("en-US")}<small>${roles.length === 1 ? "role" : "roles"}</small>`;
    const body = `<span class="ev-name">${esc(company.name)}</span>` +
      `<span class="ev-meta">${companyMeta(company)}</span>` +
      `<span class="ev-hosts">${item.events.length > 1 ? `<b>${plural(item.events.length, "event")}</b> · ` : ""}${esc(today)}</span>`;
    return listRow(company.slug, isOpen, " co", lead, body);
  }

  function companyEvent(event, now) {
    const when = event.end ? `${clock(event.start)} to ${clock(event.end)}` : clock(event.start);
    const reg = REGISTRATION[event.registration];
    const meta = [when, event.neighborhood, event.formats[0]].filter(Boolean).map(esc);
    if (reg) meta.push(`<span class="reg reg-${esc(event.registration)}">${esc(reg)}</span>`);
    meta.push(`<a href="${esc(event.url)}" target="_blank" rel="noopener">Event page</a>`);
    return `<li class="co-ev${eventIsPast(event, now) ? " is-past" : ""}"><span class="ev-time">${esc(clock(event.start))}</span>` +
      `<span class="ev-body"><button type="button" class="co-ev-name" data-go-event="${esc(event.id)}" aria-label="${esc(event.name)}: open in the schedule">${esc(event.name)}</button>` +
      `<span class="ev-meta">${meta.join(" · ")}</span></span></li>`;
  }

  function companyDetail(item, now) {
    const { company, roles } = item;
    const sorted = [...roles].sort((a, b) => familyRank.get(a.family) - familyRank.get(b.family) || a.title.localeCompare(b.title));
    const grouped = !state.field && new Set(roles.map((r) => r.family)).size > 1;
    return `<header class="detail-h"><p class="eyebrow-dark">${companyMeta(company)}</p><h2 tabindex="-1" id="detail-title">${esc(company.name)}</h2>` +
      `<p class="desc">${esc(company.summary)}</p>` +
      `<p class="detail-actions"><a class="btn small ghost" href="${esc(company.linkedin)}" target="_blank" rel="noopener">Company page</a>` +
      `<span class="detail-note">${plural(item.events.length, "event")} today · ${plural(company.roles.length, "role")} this week</span></p></header>` +
      `<section class="host"><p class="host-n ev-k">Today</p><ol class="co-events">${item.events.map((e) => companyEvent(e, now)).join("")}</ol></section>` +
      `<section class="host"><p class="host-n">${roleCount(company, roles)}</p>${roleList(`co:${company.slug}`, sorted, grouped)}</section>`;
  }

  function renderCompanies() {
    const items = companyList();
    const now = nowInPacific();
    if (!items.some((i) => i.company.slug === state.open)) {
      state.open = wide.matches ? items[0]?.company.slug || null : null;
      autoOpened = true;
    }
    const eventsSeen = new Set(items.flatMap((i) => i.events.map((e) => e.id)));
    const roles = items.reduce((n, i) => n + i.roles.length, 0);
    const count = `${plural(items.length, "company", "companies")} · ${plural(eventsSeen.size, "event")} · ${plural(roles, "role")}`;
    const html = items.map((i) => companyRow(i, i.company.slug === state.open)).join("");
    const openItem = items.find((i) => i.company.slug === state.open);
    return { count, html, detail: openItem ? companyDetail(openItem, now) : "", empty: "No host today is hiring for these filters." };
  }

  // -- rendering: put it on the page ---------------------------------------------------------

  function render(push = false) {
    renderFields();
    syncControls();
    const view = state.view === "companies" ? renderCompanies() : renderSchedule();
    // On landing the hero already carries the totals; the count earns its line once a filter is on.
    byId("count-text").textContent = view.html && filtering() ? `${view.count}${state.field ? ` in ${state.field}` : ""}` : "";
    byId("list").innerHTML = view.html ||
      `<li class="empty">${view.empty} <button type="button" class="link-btn" data-reset>Clear filters</button></li>`;

    const pane = byId("detail");
    const key = `${state.view}:${state.open}`;
    if (pane.dataset.key !== key) {
      pane.scrollTop = 0;
      pane.dataset.key = key;
    }
    if (wide.matches && view.detail) {
      pane.hidden = false;
      pane.innerHTML = view.detail;
    } else {
      pane.hidden = true;
      pane.innerHTML = "";
      if (view.detail) {
        const inline = document.getElementById(`d-${state.open}`);
        if (inline) {
          inline.hidden = false;
          inline.innerHTML = view.detail;
        }
      }
    }
    writeQuery(push);
  }

  const rowFor = (id) => document.querySelector(`.ev[data-id="${CSS.escape(id)}"]`);

  // Bring the open item into view and move focus to its title.
  function reveal() {
    if (!state.open) return;
    if (!wide.matches) {
      const row = rowFor(state.open);
      if (!row) return;
      const top = row.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight * 0.6) row.scrollIntoView({ block: "start", behavior: booted ? motion() : "auto" });
    }
    byId("detail-title")?.focus({ preventScroll: true });
  }

  function toggleOpen(id) {
    const closing = state.open === id && !wide.matches;
    state.open = closing ? null : id;
    autoOpened = false;
    render();
    if (!closing) {
      reveal();
      return;
    }
    // The row was pinned to the top while its detail was read; keep it in view as it collapses.
    const row = rowFor(id);
    if (row && row.getBoundingClientRect().top < 0) row.scrollIntoView({ block: "start", behavior: "auto" });
  }

  // Jump from one view to a specific item in the other.
  function goTo(view, id) {
    state.view = view;
    state.open = id;
    autoOpened = false;
    render(true);
    reveal();
  }

  function switchView(view) {
    if (view === state.view) return;
    state.view = view;
    state.open = null;
    render(true);
    focusOn(`[data-view="${view}"]`);
  }

  function reset() {
    state = { ...defaults(), view: state.view };
    byId("q").value = "";
    render();
    focusOn("#q");
  }

  function restoreFromUrl() {
    state = defaults();
    readQuery();
    byId("q").value = state.q;
    render();
    if (!wide.matches) reveal();
  }

  // -- events -------------------------------------------------------------------------------

  document.addEventListener("click", (event) => {
    const field = event.target.closest("[data-field]");
    if (field) {
      state.field = field.dataset.field;
      state.open = null;
      render();
      focusOn(`[data-field="${CSS.escape(state.field)}"]`);
      return;
    }
    if (event.target.closest("[data-more-fields]")) {
      moreFields = !moreFields;
      renderFields();
      focusOn("[data-more-fields]");
      return;
    }
    const view = event.target.closest("[data-view]");
    if (view) {
      switchView(view.dataset.view);
      return;
    }
    const open = event.target.closest("[data-open]");
    if (open) {
      toggleOpen(open.dataset.open);
      return;
    }
    const company = event.target.closest("[data-go-company]");
    if (company) {
      goTo("companies", company.dataset.goCompany);
      return;
    }
    const scheduled = event.target.closest("[data-go-event]");
    if (scheduled) {
      goTo("time", scheduled.dataset.goEvent);
      return;
    }
    const more = event.target.closest("[data-expand]");
    if (more) {
      // The button goes away; focus moves to the first role it revealed.
      const sections = [...document.querySelectorAll(".host")];
      const index = sections.indexOf(more.closest(".host"));
      const before = more.closest(".host").querySelectorAll(".roles li a").length;
      expanded.add(more.dataset.expand);
      render();
      const links = document.querySelectorAll(".host")[index]?.querySelectorAll(".roles li a") || [];
      (links[before] || links[0])?.focus({ preventScroll: true });
      return;
    }
    const group = event.target.closest("[data-group]");
    if (group) {
      const key = group.dataset.group;
      if (expanded.has(key)) expanded.delete(key);
      else expanded.add(key);
      render();
      focusOn(`[data-group="${CSS.escape(key)}"]`);
      return;
    }
    if (event.target.closest("[data-toggle-past]")) {
      state.showPast = !state.showPast;
      // Hiding earlier events also lets go of an earlier event that was open, or it would unfold again.
      if (!state.showPast && state.open && eventIsPast(events.get(state.open) || {}, nowInPacific())) state.open = null;
      render();
      focusOn("[data-toggle-past]");
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
  wide.addEventListener("change", () => render());
  narrow.addEventListener("change", () => renderFields());
  window.addEventListener("popstate", restoreFromUrl);
  // iOS only shows :active styles on elements once the page listens for touches.
  document.addEventListener("touchstart", () => {}, { passive: true });

  byId("loc").innerHTML = LOCATIONS.map(([value, label]) => `<option value="${value}">${esc(label)}</option>`).join("");
  byId("level").innerHTML = '<option value="">All levels</option>' + usedLevels.map((l) => `<option>${esc(l)}</option>`).join("");

  readQuery();
  byId("q").value = state.q;
  const linked = Boolean(state.open);
  render();
  // A shared link to one event or company lands on it, not on the top of the page.
  if (linked && !wide.matches) reveal();
  booted = true;
})();
