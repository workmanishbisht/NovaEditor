"use strict";

/* ==========================================
   NOVA EDITOR — PROJECTS.JS
   ------------------------------------------
   Connects the existing Projects UI
   (pages/projects.html) to real Firestore
   data using the existing firebase/auth.js
   and firebase/firestore.js modules.

   - No new Firebase initialization.
   - No new auth system (reuses NovaLayout's
     resolved auth state — no second
     onAuthStateChanged listener).
   - No new Firestore schema — only fields
     already written by createProject() in
     firebase/firestore.js are read.
   - No dummy/static project data at any point.
   - No alert() / confirm() / prompt().
   - Editor module is not touched.
========================================== */

import { showToast } from "../components/toast.js";

/* ==========================================
   CONFIG
========================================== */
const ROUTES = {
    EDITOR: "editor.html",
};

const SELECTORS = {
    GRID: "#projectsGrid",
    EMPTY_STATE: "#projectsEmptyState",
    PAGINATION: "#projectsPagination",
    SEARCH_INPUT: "#projectsSearchInput",
    TABS_CONTAINER: "#projectsTabs",
    SORT_BTN: "#projectsSortBtn",
    GRID_VIEW_BTN: "#projectsGridViewBtn",
    LIST_VIEW_BTN: "#projectsListViewBtn",
};

// Order matches the tab buttons already present in projects.html
const TAB_KEYS = ["all", "recent", "starred", "shared", "trash"];

const SORT_OPTIONS = [
    { value: "updatedAt-desc", label: "Recently Updated" },
    { value: "createdAt-desc", label: "Recently Created" },
    { value: "name-asc", label: "Name A-Z" },
    { value: "name-desc", label: "Name Z-A" },
];

// Maps the existing project.language / project.framework values
// (written by createProject()) to the existing .proj-card-tech
// badge classes already defined in projects.css.
const TECH_MAP = {
    html: { className: "html", icon: "ri-html5-line" },
    css: { className: "css", icon: "ri-css3-line" },
    javascript: { className: "js", icon: "ri-javascript-line" },
    js: { className: "js", icon: "ri-javascript-line" },
    node: { className: "js", icon: "ri-javascript-line" },
    react: { className: "react", icon: "ri-reactjs-line" },
    vue: { className: "vue", icon: "ri-vuejs-line" },
};

/* ==========================================
   STATE
========================================== */
const STATE = {
    currentUser: null,
    allProjects: [],
    filteredProjects: [],
    activeTab: "all",
    sort: SORT_OPTIONS[0].value,
    view: "grid",
    searchQuery: "",
    status: "idle", // idle | loading | loaded | error
    errorMessage: "",
    openMenuProjectId: null,
};

/* ==========================================
   DEPENDENCIES
   ------------------------------------------
   Loaded lazily and reused — never a second
   Firebase init, never a second auth listener.
========================================== */
const deps = { auth: {}, firestore: {} };

async function loadDependencies() {
    try {
        deps.auth = await import("../firebase/auth.js");
    } catch (error) {
        console.error("[Projects] Failed to load firebase/auth.js:", error);
    }
    try {
        deps.firestore = await import("../firebase/firestore.js");
    } catch (error) {
        console.error("[Projects] Failed to load firebase/firestore.js:", error);
    }
}

/* ==========================================
   DOM HELPERS
========================================== */
function qs(selector, scope = document) {
    return scope.querySelector(selector);
}
function qsa(selector, scope = document) {
    return Array.from(scope.querySelectorAll(selector));
}
function notify(message, type = "info") {
    if (typeof showToast === "function") {
        showToast(message, type);
    }
}
function debounce(fn, delay = 250) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}
function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/* ==========================================
   TIME HELPERS
========================================== */
function toDate(value) {
    if (!value) return null;
    if (typeof value.toDate === "function") return value.toDate(); // Firestore Timestamp
    if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
    if (value instanceof Date) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatRelativeTime(value) {
    const date = toDate(value);
    if (!date) return "";

    const diffSec = Math.round((Date.now() - date.getTime()) / 1000);

    if (diffSec < 5) return "Just now";
    if (diffSec < 60) return `${diffSec} sec ago`;

    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return `${diffMin} min ago`;

    const diffHours = Math.round(diffMin / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;

    const diffDays = Math.round(diffHours / 24);
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;

    const diffWeeks = Math.round(diffDays / 7);
    if (diffWeeks < 5) return `${diffWeeks} week${diffWeeks === 1 ? "" : "s"} ago`;

    const diffMonths = Math.round(diffDays / 30);
    if (diffMonths < 12) return `${diffMonths} month${diffMonths === 1 ? "" : "s"} ago`;

    const diffYears = Math.round(diffDays / 365);
    return `${diffYears} year${diffYears === 1 ? "" : "s"} ago`;
}

/* ==========================================
   PROJECT DISPLAY HELPERS
========================================== */
function getTechInfo(project) {
    const key = String(project.language || project.framework || "").toLowerCase();
    return TECH_MAP[key] || { className: "html", icon: "ri-code-s-slash-line" };
}

function getProjectPath(project) {
    const slug = String(project.name || "untitled")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
    return `/${slug || "untitled"}`;
}

function getUserInitial() {
    const source =
        STATE.currentUser?.displayName ||
        STATE.currentUser?.email ||
        "U";
    return source.trim().charAt(0).toUpperCase() || "U";
}

/* ==========================================
   LOAD PROJECTS
========================================== */
async function loadProjects() {
    if (!STATE.currentUser) return;

    if (typeof deps.firestore.getUserProjects !== "function") {
        STATE.status = "error";
        STATE.errorMessage = "Projects service is currently unavailable.";
        render();
        return;
    }

    STATE.status = "loading";
    render();

    try {
        const response = await deps.firestore.getUserProjects(STATE.currentUser.uid);

        if (!response || !response.success) {
            STATE.status = "error";
            STATE.errorMessage = response?.error || "Unable to load projects.";
            render();
            return;
        }

        STATE.allProjects = Array.isArray(response.data) ? response.data : [];
        STATE.status = "loaded";
        applyFiltersAndRender();
    } catch (error) {
        console.error("[Projects] loadProjects failed:", error);
        STATE.status = "error";
        STATE.errorMessage = "Unable to load projects.";
        render();
    }
}

/* ==========================================
   FILTER
========================================== */
function filterProjects() {
    const query = STATE.searchQuery.trim().toLowerCase();
    let list = STATE.allProjects.slice();

    switch (STATE.activeTab) {
        case "starred":
            list = list.filter((p) => p.archived !== true && p.starred === true);
            break;
        case "trash":
            // "archived" is the only deletion-style field the existing
            // schema supports — reused here rather than inventing a
            // new "deleted" field.
            list = list.filter((p) => p.archived === true);
            break;
        case "shared":
            // The existing Firestore project schema has no sharing
            // fields (no sharedWith / collaborators). Rather than
            // inventing fake shared data, this tab intentionally
            // renders empty — see renderEmptyState().
            list = [];
            break;
        case "recent":
            list = list.filter((p) => p.archived !== true);
            break;
        case "all":
        default:
            list = list.filter((p) => p.archived !== true);
            break;
    }

    if (query) {
        list = list.filter((p) => {
            const haystack = [p.name, p.description, p.language, p.framework]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
            return haystack.includes(query);
        });
    }

    return list;
}

/* ==========================================
   SORT
========================================== */
function sortProjects(list) {
    const sorted = list.slice();

    // "Recent" tab always sorts by real updatedAt regardless of the
    // Sort control, per spec. Every other tab honors STATE.sort.
    const [field, direction] =
        STATE.activeTab === "recent" ? ["updatedAt", "desc"] : STATE.sort.split("-");

    sorted.sort((a, b) => {
        if (field === "name") {
            const nameA = (a.name || "").toLowerCase();
            const nameB = (b.name || "").toLowerCase();
            const cmp = nameA.localeCompare(nameB);
            return direction === "asc" ? cmp : -cmp;
        }

        const dateA = toDate(a[field])?.getTime() || 0;
        const dateB = toDate(b[field])?.getTime() || 0;
        return direction === "asc" ? dateA - dateB : dateB - dateA;
    });

    return sorted;
}

function applyFiltersAndRender() {
    STATE.filteredProjects = sortProjects(filterProjects());
    render();
}

/* ==========================================
   RENDER — ROOT
========================================== */
function render() {
    const grid = qs(SELECTORS.GRID);
    const emptyState = qs(SELECTORS.EMPTY_STATE);
    const pagination = qs(SELECTORS.PAGINATION);
    if (!grid) return;

    if (STATE.status === "loading") {
        renderLoading(grid);
        setHidden(emptyState, true);
        setHidden(pagination, true);
        return;
    }

    if (STATE.status === "error") {
        renderError(grid);
        setHidden(emptyState, true);
        setHidden(pagination, true);
        return;
    }

    if (STATE.status !== "loaded") {
        grid.innerHTML = "";
        setHidden(emptyState, true);
        setHidden(pagination, true);
        return;
    }

    if (STATE.filteredProjects.length === 0) {
        grid.innerHTML = "";
        setHidden(pagination, true);
        renderEmptyState(emptyState);
        return;
    }

    setHidden(emptyState, true);
    grid.classList.toggle("proj-grid--list", STATE.view === "list");
    grid.innerHTML = "";

    const fragment = document.createDocumentFragment();
    STATE.filteredProjects.forEach((project) => {
        fragment.appendChild(renderProjectCard(project));
    });
    grid.appendChild(fragment);

    renderPagination(pagination);
}

function setHidden(el, hidden) {
    if (el) el.hidden = hidden;
}

/* ==========================================
   RENDER — LOADING STATE
========================================== */
function renderLoading(grid) {
    grid.classList.remove("proj-grid--list");
    grid.innerHTML = "";

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 6; i += 1) {
        const skeleton = document.createElement("article");
        skeleton.className = "proj-card proj-card-skeleton";
        skeleton.setAttribute("aria-hidden", "true");
        skeleton.innerHTML = `
            <div class="proj-card-thumb" style="background:var(--surface-secondary);"></div>
            <div class="proj-card-body">
                <div class="proj-card-title-row">
                    <div class="proj-card-title-group" style="width:100%;">
                        <strong style="display:block;height:14px;width:65%;background:var(--surface-secondary);border-radius:4px;"></strong>
                        <span style="display:block;height:10px;width:40%;margin-top:6px;background:var(--surface-secondary);border-radius:4px;"></span>
                    </div>
                </div>
                <p style="height:10px;width:90%;background:var(--surface-secondary);border-radius:4px;margin:8px 0 0;"></p>
            </div>
        `;
        fragment.appendChild(skeleton);
    }
    grid.appendChild(fragment);
}

/* ==========================================
   RENDER — ERROR STATE
========================================== */
function renderError(grid) {
    grid.classList.remove("proj-grid--list");
    grid.innerHTML = "";

    const wrapper = document.createElement("section");
    wrapper.className = "proj-empty-state";
    wrapper.innerHTML = `
        <div class="proj-empty-icon">
            <i class="ri-error-warning-line"></i>
        </div>
        <h3>Unable to load projects</h3>
        <p>${escapeHtml(STATE.errorMessage || "Something went wrong while loading your projects.")}</p>
        <div class="proj-empty-actions">
            <button type="button" class="btn btn-primary" data-retry-load>
                <i class="ri-refresh-line"></i>
                Try Again
            </button>
        </div>
    `;
    grid.appendChild(wrapper);

    qs("[data-retry-load]", wrapper)?.addEventListener("click", () => {
        loadProjects();
    });
}

/* ==========================================
   RENDER — EMPTY STATE
========================================== */
function renderEmptyState(emptyState) {
    if (!emptyState) return;
    setHidden(emptyState, false);

    const heading = qs("h3", emptyState);
    const paragraph = qs("p", emptyState);
    const actions = qs(".proj-empty-actions", emptyState);

    const isSearching = STATE.searchQuery.trim().length > 0;

    if (isSearching) {
        if (heading) heading.textContent = "No projects found";
        if (paragraph) paragraph.textContent = "Try a different search term.";
        setHidden(actions, true);
        return;
    }

    switch (STATE.activeTab) {
        case "starred":
            if (heading) heading.textContent = "No starred projects";
            if (paragraph) paragraph.textContent = "Star a project to find it here quickly.";
            setHidden(actions, true);
            break;
        case "trash":
            if (heading) heading.textContent = "Trash is empty";
            if (paragraph) paragraph.textContent = "Projects you move to trash will show up here.";
            setHidden(actions, true);
            break;
        case "shared":
            if (heading) heading.textContent = "Nothing shared with you yet";
            if (paragraph) paragraph.textContent = "Shared projects will appear here once project sharing is available.";
            setHidden(actions, true);
            break;
        case "recent":
            if (heading) heading.textContent = "No recent projects";
            if (paragraph) paragraph.textContent = "Projects you update will show up here.";
            setHidden(actions, true);
            break;
        case "all":
        default:
            if (heading) heading.textContent = "No projects yet?";
            if (paragraph) paragraph.textContent = "Create your first project and start building something amazing.";
            setHidden(actions, false);
            break;
    }
}

/* ==========================================
   RENDER — PAGINATION (real counts only)
========================================== */
function renderPagination(pagination) {
    if (!pagination) return;
    setHidden(pagination, false);

    const info = qs(".proj-pagination-info", pagination);
    const total = STATE.filteredProjects.length;

    if (info) {
        info.textContent = `Showing 1 to ${total} of ${total} project${total === 1 ? "" : "s"}`;
    }

    // Real pagination (page 2+) is out of scope for this step since all
    // loaded projects are rendered on a single page — reflect that
    // honestly rather than showing fake page numbers.
    const controls = qs(".proj-pagination-controls", pagination);
    if (controls) {
        qsa(".proj-page-btn", controls).forEach((btn) => {
            btn.disabled = true;
        });
        qsa(".proj-page-num, .proj-page-ellipsis", controls).forEach((el, index) => {
            el.style.display = index === 0 ? "" : "none";
            if (index === 0) {
                el.textContent = "1";
                el.classList.add("is-active");
            }
        });
    }
}

/* ==========================================
   RENDER — PROJECT CARD
========================================== */
function renderProjectCard(project) {
    const tech = getTechInfo(project);
    const isStarred = project.starred === true;
    const isArchived = project.archived === true;
    const updatedLabel = formatRelativeTime(project.updatedAt) || "—";

    const card = document.createElement("article");
    card.className = "proj-card";
    card.dataset.projectId = project.id;

    card.innerHTML = `
        <div class="proj-card-thumb">
            <span class="proj-card-tech ${tech.className}" title="${escapeHtml(tech.className)}">
                <i class="${tech.icon}"></i>
            </span>
            <button type="button" class="proj-card-menu-btn" aria-label="Project actions" title="Project actions" data-menu-trigger>
                <i class="ri-more-2-fill"></i>
            </button>
            <div class="proj-card-preview" aria-hidden="true">
                ${
                    project.previewUrl
                        ? `<img src="${escapeHtml(project.previewUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;" />`
                        : `<i class="ri-layout-4-line"></i>`
                }
            </div>
        </div>
        <div class="proj-card-body">
            <div class="proj-card-title-row">
                <div class="proj-card-title-group">
                    <strong>${escapeHtml(project.name || "Untitled Project")}</strong>
                    <span class="proj-card-path">${escapeHtml(getProjectPath(project))}</span>
                </div>
                <button type="button" class="proj-card-star${isStarred ? " is-starred" : ""}"
                    aria-label="${isStarred ? "Remove from starred" : "Add to starred"}"
                    aria-pressed="${isStarred}" data-star-toggle>
                    <i class="${isStarred ? "ri-star-fill" : "ri-star-line"}"></i>
                </button>
            </div>
            <p class="proj-card-desc">${escapeHtml(project.description || "No description yet.")}</p>
            <div class="proj-card-footer">
                <span class="proj-card-avatar">${escapeHtml(getUserInitial())}</span>
                <span class="proj-card-updated">Updated ${escapeHtml(updatedLabel)}</span>
            </div>
        </div>
    `;

    // Open in editor on card click (but not when clicking star/menu)
    card.addEventListener("click", (event) => {
        if (event.target.closest("[data-star-toggle]") || event.target.closest("[data-menu-trigger]") || event.target.closest(".proj-card-menu")) {
            return;
        }
        window.location.href = `${ROUTES.EDITOR}?project=${encodeURIComponent(project.id)}`;
    });

    qs("[data-star-toggle]", card)?.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleStar(project);
    });

    qs("[data-menu-trigger]", card)?.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleProjectMenu(project, card, isArchived);
    });

    return card;
}

/* ==========================================
   ACTIONS — STAR
========================================== */
async function toggleStar(project) {
    if (typeof deps.firestore.updateProject !== "function") {
        notify("Starring is currently unavailable.", "error");
        return;
    }

    const nextStarred = !(project.starred === true);

    // Optimistic UI update
    project.starred = nextStarred;
    applyFiltersAndRender();

    const response = await deps.firestore.updateProject(project.id, { starred: nextStarred });

    if (!response || !response.success) {
        // Revert on failure
        project.starred = !nextStarred;
        applyFiltersAndRender();
        notify(response?.error || "Unable to update project.", "error");
    }
}

/* ==========================================
   ACTIONS — ARCHIVE / RESTORE / DELETE
========================================== */
async function setProjectArchived(project, archived) {
    if (typeof deps.firestore.updateProject !== "function") {
        notify("This action is currently unavailable.", "error");
        return;
    }

    const response = await deps.firestore.updateProject(project.id, { archived });

    if (!response || !response.success) {
        notify(response?.error || "Unable to update project.", "error");
        return;
    }

    project.archived = archived;
    notify(archived ? "Project moved to trash." : "Project restored.", "success");
    applyFiltersAndRender();
}

async function deleteProjectPermanently(project) {
    if (typeof deps.firestore.deleteProject !== "function") {
        notify("Delete is currently unavailable.", "error");
        return;
    }

    const response = await deps.firestore.deleteProject(project.id);

    if (!response || !response.success) {
        notify(response?.error || "Unable to delete project.", "error");
        return;
    }

    STATE.allProjects = STATE.allProjects.filter((p) => p.id !== project.id);
    notify("Project permanently deleted.", "success");
    applyFiltersAndRender();
}

/* ==========================================
   PROJECT ACTIONS MENU (3-dot)
   ------------------------------------------
   No dropdown markup exists yet in the current
   HTML/CSS, so a minimal, unstyled-by-default
   menu is built here with only the inline
   positioning needed to be usable. No
   alert/confirm/prompt is used anywhere.
========================================== */
function closeProjectMenu() {
    const existing = qs(".proj-card-menu");
    if (existing) existing.remove();
    STATE.openMenuProjectId = null;
}

function toggleProjectMenu(project, card, isArchived) {
    if (STATE.openMenuProjectId === project.id) {
        closeProjectMenu();
        return;
    }
    closeProjectMenu();
    STATE.openMenuProjectId = project.id;

    const menu = document.createElement("div");
    menu.className = "proj-card-menu";
    menu.setAttribute("role", "menu");
    menu.style.cssText = [
        "position:absolute",
        "top:46px",
        "right:12px",
        "z-index:5",
        "min-width:170px",
        "background:var(--surface)",
        "border:1px solid var(--border)",
        "border-radius:var(--radius-sm, 8px)",
        "box-shadow:var(--shadow-md, 0 8px 24px rgba(0,0,0,.18))",
        "padding:6px",
        "display:flex",
        "flex-direction:column",
        "gap:2px",
    ].join(";");

    const items = [
        {
            label: "Open",
            icon: "ri-external-link-line",
            action: () => {
                window.location.href = `${ROUTES.EDITOR}?project=${encodeURIComponent(project.id)}`;
            },
        },
        {
            label: project.starred ? "Unstar" : "Star",
            icon: project.starred ? "ri-star-fill" : "ri-star-line",
            action: () => toggleStar(project),
        },
    ];

    if (isArchived) {
        items.push(
            { label: "Restore", icon: "ri-inbox-unarchive-line", action: () => setProjectArchived(project, false) },
            { label: "Delete permanently", icon: "ri-delete-bin-line", danger: true, action: () => deleteProjectPermanently(project) }
        );
    } else {
        items.push({ label: "Move to trash", icon: "ri-delete-bin-line", danger: true, action: () => setProjectArchived(project, true) });
    }

    items.forEach((item) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("role", "menuitem");
        btn.style.cssText = [
            "display:flex",
            "align-items:center",
            "gap:8px",
            "width:100%",
            "padding:8px 10px",
            "border-radius:6px",
            "font-size:13px",
            "font-weight:600",
            "text-align:left",
            "background:transparent",
            `color:${item.danger ? "var(--danger, #dc2626)" : "var(--text-primary)"}`,
        ].join(";");
        btn.innerHTML = `<i class="${item.icon}"></i> ${escapeHtml(item.label)}`;
        btn.addEventListener("mouseenter", () => {
            btn.style.background = "var(--surface-secondary)";
        });
        btn.addEventListener("mouseleave", () => {
            btn.style.background = "transparent";
        });
        btn.addEventListener("click", (event) => {
            event.stopPropagation();
            closeProjectMenu();
            item.action();
        });
        menu.appendChild(btn);
    });

    const thumb = qs(".proj-card-thumb", card);
    thumb.style.position = thumb.style.position || "relative";
    thumb.appendChild(menu);

    document.addEventListener("click", closeProjectMenu, { once: true });
}

/* ==========================================
   SORT CONTROL
   ------------------------------------------
   No dropdown list exists in the current HTML
   for #projectsSortBtn, so one is built here
   the same way as the project actions menu.
========================================== */
function closeSortMenu() {
    const existing = qs(".proj-sort-menu");
    if (existing) existing.remove();
}

function setupSort() {
    const sortBtn = qs(SELECTORS.SORT_BTN);
    if (!sortBtn) return;

    sortBtn.addEventListener("click", (event) => {
        event.stopPropagation();

        const existing = qs(".proj-sort-menu");
        if (existing) {
            closeSortMenu();
            return;
        }

        const menu = document.createElement("div");
        menu.className = "proj-sort-menu";
        menu.setAttribute("role", "menu");
        menu.style.cssText = [
            "position:absolute",
            "z-index:5",
            "min-width:190px",
            "margin-top:6px",
            "background:var(--surface)",
            "border:1px solid var(--border)",
            "border-radius:var(--radius-sm, 8px)",
            "box-shadow:var(--shadow-md, 0 8px 24px rgba(0,0,0,.18))",
            "padding:6px",
            "display:flex",
            "flex-direction:column",
            "gap:2px",
        ].join(";");

        SORT_OPTIONS.forEach((option) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.setAttribute("role", "menuitem");
            const isActive = option.value === STATE.sort;
            btn.style.cssText = [
                "display:flex",
                "align-items:center",
                "justify-content:space-between",
                "width:100%",
                "padding:8px 10px",
                "border-radius:6px",
                "font-size:13px",
                "font-weight:600",
                "text-align:left",
                `background:${isActive ? "var(--surface-secondary)" : "transparent"}`,
                `color:${isActive ? "var(--primary)" : "var(--text-primary)"}`,
            ].join(";");
            btn.innerHTML = `${escapeHtml(option.label)}${isActive ? '<i class="ri-check-line"></i>' : ""}`;
            btn.addEventListener("click", (evt) => {
                evt.stopPropagation();
                STATE.sort = option.value;
                const valueLabel = qs(".proj-sort-value", sortBtn);
                if (valueLabel) valueLabel.textContent = option.label;
                closeSortMenu();
                applyFiltersAndRender();
            });
            menu.appendChild(btn);
        });

        sortBtn.style.position = sortBtn.style.position || "relative";
        sortBtn.appendChild(menu);
        document.addEventListener("click", closeSortMenu, { once: true });
    });
}

/* ==========================================
   TABS
========================================== */
function setupTabs() {
    const container = qs(SELECTORS.TABS_CONTAINER);
    if (!container) return;

    const tabButtons = qsa(".proj-tab", container);

    tabButtons.forEach((btn, index) => {
        btn.addEventListener("click", () => {
            const key = TAB_KEYS[index];
            if (!key || key === STATE.activeTab) return;

            STATE.activeTab = key;

            tabButtons.forEach((b, i) => {
                const isActive = i === index;
                b.classList.toggle("is-active", isActive);
                b.setAttribute("aria-selected", String(isActive));
            });

            applyFiltersAndRender();
        });
    });
}

/* ==========================================
   SEARCH
========================================== */
function setupSearch() {
    const input = qs(SELECTORS.SEARCH_INPUT);
    if (!input) return;

    const runSearch = debounce((value) => {
        STATE.searchQuery = value;
        applyFiltersAndRender();
    }, 200);

    input.addEventListener("input", (event) => {
        runSearch(event.target.value);
    });

    // The visible "Ctrl K" hint in the search box already implies this
    document.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
            event.preventDefault();
            input.focus();
        }
    });
}

/* ==========================================
   VIEW TOGGLE (Grid / List)
========================================== */
function setupViewToggle() {
    const gridBtn = qs(SELECTORS.GRID_VIEW_BTN);
    const listBtn = qs(SELECTORS.LIST_VIEW_BTN);
    if (!gridBtn || !listBtn) return;

    function setView(view) {
        STATE.view = view;
        gridBtn.classList.toggle("is-active", view === "grid");
        gridBtn.setAttribute("aria-pressed", String(view === "grid"));
        listBtn.classList.toggle("is-active", view === "list");
        listBtn.setAttribute("aria-pressed", String(view === "list"));
        render();
    }

    gridBtn.addEventListener("click", () => setView("grid"));
    listBtn.addEventListener("click", () => setView("list"));
}

/* ==========================================
   AUTH — reuse NovaLayout's resolved state
   ------------------------------------------
   layout.js already owns the single
   onAuthStateChanged listener for this page
   (see js/layout.js). projects.js listens for
   its lifecycle events instead of creating a
   second, conflicting listener.
========================================== */
function handleAuthResolved(user) {
    STATE.currentUser = user || null;

    if (!STATE.currentUser) {
        // No custom session flags are used — this simply reflects
        // the real Firebase Auth state already resolved by layout.js.
        STATE.status = "idle";
        render();
        return;
    }

    loadProjects();
}

function bootstrapAuth() {
    if (window.NovaLayout && typeof window.NovaLayout.isReady === "function" && window.NovaLayout.isReady()) {
        const state = window.NovaLayout.getState();
        handleAuthResolved(state?.currentUser || null);
    }

    document.addEventListener("novaeditor:layout-ready", (event) => {
        handleAuthResolved(event.detail?.currentUser || null);
    });

    document.addEventListener("novaeditor:unauthenticated", () => {
        handleAuthResolved(null);
        if (typeof deps.auth.redirectToLanding === "function") {
            deps.auth.redirectToLanding();
        }
    });
}

/* ==========================================
   PROJECT CREATED (from the New Project modal
   already wired in layout.js) — refresh the
   list instead of reloading the page.
========================================== */
function setupProjectCreatedListener() {
    document.addEventListener("novaeditor:project-created", () => {
        loadProjects();
    });
}

/* ==========================================
   INIT
========================================== */
async function init() {
    await loadDependencies();

    setupTabs();
    setupSort();
    setupSearch();
    setupViewToggle();
    setupProjectCreatedListener();
    bootstrapAuth();
}

document.addEventListener("DOMContentLoaded", () => {
    init().catch((error) => {
        console.error("[Projects] Unhandled error during init():", error);
    });
});