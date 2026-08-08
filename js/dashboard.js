"use strict";

/* ==========================================
   IMPORTS
========================================== */
import { getUserProjects, updateProject } from "../firebase/firestore.js";
import { requireAuth } from "../firebase/auth.js";

/* ==========================================
   CONFIG
========================================== */
const CONFIG = Object.freeze({
    RECENT_PROJECTS_LIMIT: 8,
    ACTIVITY_LIMIT: 5,
    STORAGE_LIMIT_GB: 10,
});

const LANGUAGE_META = Object.freeze({
    javascript: { label: "JS", className: "js" },
    typescript: { label: "TS", className: "js" },
    html: { label: "HTML", className: "html" },
    css: { label: "CSS", className: "css" },
    python: { label: "PY", className: "default" },
    java: { label: "JAVA", className: "default" },
    cpp: { label: "C++", className: "default" },
});

/* ==========================================
   STATE
========================================== */
const STATE = {
    uid: null,
    displayName: "",
    projects: [],
};

/* ==========================================
   DOM CACHE
========================================== */
const DOM = {
    greeting: document.getElementById("dashGreeting"),
    continueSection: document.getElementById("dashContinueSection"),
    continueMeta: document.getElementById("continueMeta"),
    continueName: document.getElementById("continueProjectName"),
    continueFile: document.getElementById("continueProjectFile"),
    continueTags: document.getElementById("continueProjectTags"),
    continueOpenBtn: document.getElementById("continueOpenBtn"),
    recentProjectsGrid: document.getElementById("recentProjectsGrid"),
    recentFilesList: document.getElementById("recentFilesList"),
    pinnedSnippetsList: document.getElementById("pinnedSnippetsList"),
    recentTemplatesList: document.getElementById("recentTemplatesList"),
    recentActivityList: document.getElementById("recentActivityList"),
    storageRing: document.getElementById("storageRing"),
    storagePercent: document.getElementById("storagePercent"),
    storageUsedText: document.getElementById("storageUsedText"),
    storageBarFill: document.getElementById("storageBarFill"),
    overviewProjectsCount: document.getElementById("overviewProjectsCount"),
    overviewAssetsCount: document.getElementById("overviewAssetsCount"),
    searchInput: document.getElementById("globalSearchInput"),
};

/* ==========================================
   HELPERS
========================================== */
function showToast(message, type = "info") {
    if (typeof window.showToast === "function") {
        window.showToast(message, type);
    }
}

function toMillis(timestamp) {
    if (!timestamp) return 0;
    if (typeof timestamp.toMillis === "function") return timestamp.toMillis();
    if (timestamp.seconds) return timestamp.seconds * 1000;
    return new Date(timestamp).getTime() || 0;
}

function timeAgo(timestamp) {
    const millis = toMillis(timestamp);
    if (!millis) return "just now";
    const diff = Date.now() - millis;
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < minute) return "just now";
    if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
    if (diff < day) return `${Math.floor(diff / hour)}h ago`;
    return `${Math.floor(diff / day)}d ago`;
}

function languageMeta(language) {
    return LANGUAGE_META[language] || { label: (language || "?").slice(0, 4).toUpperCase(), className: "default" };
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    }[char]));
}

function getOpenProjectErrorMessage(errOrResponse) {
    if (!errOrResponse) return "Unable to open project. Please try again.";
    const msg = String(
        (errOrResponse && (errOrResponse.error || errOrResponse.message || errOrResponse.code)) ||
        errOrResponse
    ).toLowerCase();
    if (msg.includes("permission") || msg.includes("denied")) {
        return "Permission denied.";
    }
    if (msg.includes("not-found") || msg.includes("not found") || msg.includes("deleted")) {
        return "Project was deleted or no longer exists.";
    }
    if (msg.includes("network") || msg.includes("unavailable") || msg.includes("timeout")) {
        return "Network error. Could not open project.";
    }
    return "Unable to open project. Please try again.";
}

/* ==========================================
   CURRENT PROJECT (localStorage)
========================================== */
function getCurrentProject() {
    return localStorage.getItem("novaeditor:currentProjectId") || null;
}

function clearCurrentProject() {
    localStorage.removeItem("novaeditor:currentProjectId");
}

function setCurrentProject(projectId) {
    if (!projectId || typeof projectId !== "string" || !projectId.trim()) {
        return;
    }
    localStorage.setItem("novaeditor:currentProjectId", projectId.trim());
}

function navigateToEditor(projectId) {
    if (!projectId || typeof projectId !== "string" || !projectId.trim()) {
        showToast("Missing or invalid project ID.", "error");
        return;
    }
    window.location.href = `editor.html?project=${encodeURIComponent(projectId.trim())}`;
}

/* ==========================================
   OPEN PROJECT
========================================== */
async function openProject(projectId) {
    if (!projectId || typeof projectId !== "string" || !projectId.trim()) {
        showToast("Missing or invalid project ID.", "error");
        return;
    }
    const id = projectId.trim();
    if (!STATE.uid) {
        showToast("You must be signed in to open a project.", "error");
        return;
    }
    const project = STATE.projects.find((p) => p.id === id);
    if (!project) {
        showToast("Project not found or you don't have access.", "error");
        return;
    }
    try {
        const response = await updateProject(STATE.uid, id, {
            lastOpenedAt: new Date(),
        });
        if (!response || !response.success) {
            showToast(getOpenProjectErrorMessage(response), "error");
            return;
        }
        setCurrentProject(id);
        navigateToEditor(id);
    } catch (err) {
        console.error("[dashboard] openProject failed:", err);
        showToast(getOpenProjectErrorMessage(err), "error");
    }
}

async function restoreLastProject() {
    const id = getCurrentProject();
    if (id) {
        await openProject(id);
    }
}

/* ==========================================
   GREETING
========================================== */
function renderGreeting() {
    if (!DOM.greeting) return;
    const hour = new Date().getHours();
    let salutation = "Good evening";
    if (hour < 12) salutation = "Good morning";
    else if (hour < 18) salutation = "Good afternoon";
    const firstName = (STATE.displayName || "there").split(" ")[0];
    DOM.greeting.innerHTML = `${salutation}, <span class="greeting-name">${escapeHtml(firstName)}!</span>`;
}

/* ==========================================
   PROJECTS
========================================== */
async function loadProjects() {
    if (!STATE.uid) return;
    const response = await getUserProjects(STATE.uid);
    if (!response.success) {
        if (DOM.recentProjectsGrid) {
            DOM.recentProjectsGrid.innerHTML = `<p class="panel-empty error">Unable to load projects.</p>`;
        }
        return;
    }
    STATE.projects = (response.data || [])
        .slice()
        .sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));
    renderContinueCoding();
    renderRecentProjects();
    renderActivityFromProjects();
    renderWorkspaceOverview();
}

function renderContinueCoding() {
    if (!DOM.continueSection) return;
    const latest = STATE.projects[0];
    if (!latest) {
        DOM.continueSection.hidden = true;
        return;
    }
    DOM.continueSection.hidden = false;
    if (DOM.continueMeta) {
        DOM.continueMeta.textContent = `You left off ${timeAgo(latest.updatedAt)}`;
    }
    if (DOM.continueName) {
        DOM.continueName.textContent = latest.name;
    }
    if (DOM.continueFile) {
        DOM.continueFile.textContent = latest.description || "index.html";
    }
    if (DOM.continueTags) {
        const meta = languageMeta(latest.language);
        DOM.continueTags.innerHTML = `<span class="tag tag-${meta.className}">${meta.label}</span>`;
    }
    if (DOM.continueOpenBtn) {
        DOM.continueOpenBtn.href = "#";
        DOM.continueOpenBtn.onclick = (event) => {
            event.preventDefault();
            openProject(latest.id);
        };
    }
}

function renderRecentProjects() {
    if (!DOM.recentProjectsGrid) return;
    const projects = STATE.projects.slice(0, CONFIG.RECENT_PROJECTS_LIMIT);
    if (projects.length === 0) {
        DOM.recentProjectsGrid.innerHTML = `
      <p class="panel-empty">
        No projects yet. Create your first project to see it here.
      </p>
    `;
        return;
    }
    DOM.recentProjectsGrid.innerHTML = projects
        .map((project) => {
            const meta = languageMeta(project.language);
            return `
        <a class="project-card" href="#" data-project-id="${escapeHtml(project.id)}" data-project-name="${escapeHtml(project.name).toLowerCase()}">
          <div class="project-card-thumb">
            <i class="ri-code-s-slash-line"></i>
          </div>
          <div class="project-card-body">
            <div class="project-card-title-row">
              <strong>${escapeHtml(project.name)}</strong>
            </div>
            <small>Updated ${timeAgo(project.updatedAt)}</small>
            <div class="tag-row">
              <span class="tag tag-${meta.className}">${meta.label}</span>
            </div>
          </div>
        </a>
      `;
        })
        .join("");
    DOM.recentProjectsGrid.querySelectorAll("[data-project-id]").forEach((card) => {
        card.addEventListener("click", (event) => {
            event.preventDefault();
            openProject(card.dataset.projectId);
        });
    });
}

/* ==========================================
   RECENT ACTIVITY
========================================== */
function renderActivityFromProjects() {
    if (!DOM.recentActivityList) return;
    const events = STATE.projects.slice(0, CONFIG.ACTIVITY_LIMIT).map((project) => {
        const created = toMillis(project.createdAt);
        const updated = toMillis(project.updatedAt);
        const isNew = Math.abs(updated - created) < 5000;
        return {
            title: project.name,
            description: isNew ? "Created project" : "Updated project",
            icon: isNew ? "ri-add-line" : "ri-edit-2-line",
            timestamp: project.updatedAt,
        };
    });
    if (events.length === 0) {
        DOM.recentActivityList.innerHTML = `<p class="panel-empty">No activity yet.</p>`;
        return;
    }
    DOM.recentActivityList.innerHTML = events
        .map((event) => {
            return `
        <div class="activity-item">
          <span class="activity-icon simple-list-icon default"><i class="${event.icon}"></i></span>
          <div class="activity-text">
            <strong>${escapeHtml(event.title)}</strong>
            <small>${escapeHtml(event.description)}</small>
          </div>
          <span class="activity-time">${timeAgo(event.timestamp)}</span>
        </div>
      `;
        })
        .join("");
}

/* ==========================================
   WORKSPACE OVERVIEW
========================================== */
function renderWorkspaceOverview() {
    if (DOM.overviewProjectsCount) {
        DOM.overviewProjectsCount.textContent = String(STATE.projects.length);
    }
    if (DOM.overviewAssetsCount) {
        DOM.overviewAssetsCount.textContent = "—";
    }
    if (DOM.storagePercent) DOM.storagePercent.textContent = "—";
    if (DOM.storageUsedText) DOM.storageUsedText.textContent = `Storage tracking coming soon`;
    if (DOM.storageRing) DOM.storageRing.style.setProperty("--ring-value", "0");
    if (DOM.storageBarFill) DOM.storageBarFill.style.width = "0%";
}

/* ==========================================
   PLACEHOLDER SECTIONS
========================================== */
async function fetchRecentFiles() {
    return [];
}

async function fetchPinnedSnippets() {
    return [];
}

async function fetchRecentTemplates() {
    return [];
}

function renderSimpleList(container, items, emptyMessage, mapItem) {
    if (!container) return;
    if (!items || items.length === 0) {
        container.innerHTML = `<p class="panel-empty">${emptyMessage}</p>`;
        return;
    }
    container.innerHTML = items.map(mapItem).join("");
}

async function loadPlaceholderSections() {
    const [files, snippets, templates] = await Promise.all([
        fetchRecentFiles(),
        fetchPinnedSnippets(),
        fetchRecentTemplates(),
    ]);
    renderSimpleList(
        DOM.recentFilesList,
        files,
        "No recent files yet.",
        (file) => `
      <div class="simple-list-item">
        <span class="simple-list-icon ${languageMeta(file.language).className}">${languageMeta(file.language).label[0]}</span>
        <span class="simple-list-item-name">${escapeHtml(file.name)}</span>
        <span class="simple-list-item-meta">${timeAgo(file.updatedAt)}</span>
      </div>
    `
    );
    renderSimpleList(
        DOM.pinnedSnippetsList,
        snippets,
        "No pinned snippets yet.",
        (snippet) => `
      <div class="simple-list-item">
        <span class="simple-list-icon default"><i class="ri-code-s-slash-line"></i></span>
        <span class="simple-list-item-name">${escapeHtml(snippet.name)}</span>
        <span class="simple-list-item-meta">${snippet.lines || 0} lines</span>
      </div>
    `
    );
    renderSimpleList(
        DOM.recentTemplatesList,
        templates,
        "No templates used yet.",
        (template) => `
      <div class="simple-list-item">
        <span class="simple-list-icon default"><i class="ri-layout-grid-line"></i></span>
        <span class="simple-list-item-name">${escapeHtml(template.name)}</span>
        <span class="simple-list-item-meta">${escapeHtml(template.stack || "")}</span>
      </div>
    `
    );
}

/* ==========================================
   SEARCH
========================================== */
function attachSearch() {
    if (!DOM.searchInput) return;
    DOM.searchInput.addEventListener("input", (event) => {
        const query = event.target.value.trim().toLowerCase();
        const cards = DOM.recentProjectsGrid
            ? Array.from(DOM.recentProjectsGrid.querySelectorAll("[data-project-name]"))
            : [];
        cards.forEach((card) => {
            const matches = !query || card.dataset.projectName.includes(query);
            card.style.display = matches ? "" : "none";
        });
    });
}

/* ==========================================
   NEW PROJECT REFRESH
========================================== */
function attachProjectCreatedListener() {
    document.addEventListener("novaeditor:project-created", () => {
        loadProjects();
    });
}

/* ==========================================
   INITIALIZATION
========================================== */
function init(detail) {
    STATE.uid = detail.currentUser?.uid || null;
    STATE.displayName = detail.userData?.displayName || detail.currentUser?.displayName || "";
    renderGreeting();
    attachSearch();
    attachProjectCreatedListener();
    loadProjects();
    loadPlaceholderSections();
}

/* ==========================================
   SECURITY: Route Guard
========================================== */
async function bootstrapDashboard() {
    const user = await requireAuth();
    if (!user) {
        return;
    }
    if (window.NovaLayout?.isReady()) {
        init(window.NovaLayout.getState());
    } else {
        document.addEventListener("novaeditor:layout-ready", (event) => {
            init(event.detail);
        });
    }
}

bootstrapDashboard();