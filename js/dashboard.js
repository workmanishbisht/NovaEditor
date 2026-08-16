"use strict";

/* ==========================================
   IMPORTS
========================================== */
import { getUserProjects, updateProject, getFiles } from "../firebase/firestore.js";
import { requireAuth } from "../firebase/auth.js";
// Single source of truth for turning project files into a renderable
// preview document. The Editor's live preview iframe uses this exact
// function (see components/preview.js -> renderPreview()); the
// Dashboard must reuse it rather than re-implement HTML/CSS/JS
// inlining a second time.
import { buildPreviewDocument } from "../components/preview.js";

/* ==========================================
   CONFIG
========================================== */
const CONFIG = Object.freeze({
    RECENT_PROJECTS_LIMIT: 8,
    FAVORITES_LIMIT: 6,
    ACTIVITY_LIMIT: 5,
    STORAGE_LIMIT_GB: 10,
    PREVIEW_CACHE_PREFIX: "novaeditor:thumb:",
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
    openMenuProjectId: null,
    importSelection: null,
    /** @type {Map<string, { key: string, html: string|null, failed?: boolean }>} */
    previewCache: new Map(),
};

/* ==========================================
   DOM CACHE
========================================== */
const DOM = {
    greeting: document.getElementById("dashGreeting"),

    // Continue Coding
    continueSection: document.getElementById("dashContinueSection"),
    continueEmptyState: document.getElementById("dashContinueEmpty"),
    continueMeta: document.getElementById("continueMeta"),
    continueName: document.getElementById("continueProjectName"),
    continueDescription: document.getElementById("continueProjectDescription"),
    continueFile: document.getElementById("continueProjectFile"),
    continueTags: document.getElementById("continueProjectTags"),
    continueOpenBtn: document.getElementById("continueOpenBtn"),
    continuePreviewWrap: document.getElementById("continuePreviewWrap"),

    recentProjectsGrid: document.getElementById("recentProjectsGrid"),
    favoritesList: document.getElementById("favoritesList"),
    recentFilesList: document.getElementById("recentFilesList"),
    pinnedSnippetsList: document.getElementById("pinnedSnippetsList"),
    recentTemplatesList: document.getElementById("recentTemplatesList"),
    recentActivityList: document.getElementById("recentActivityList"),
    storageRing: document.getElementById("storageRing"),
    storagePercent: document.getElementById("storagePercent"),
    storageUsedText: document.getElementById("storageUsedText"),
    storageBarFill: document.getElementById("storageBarFill"),
    overviewProjectsCount: document.getElementById("overviewProjectsCount"),
    overviewFavoritesCount: document.getElementById("overviewFavoritesCount"),
    overviewSnippetsCount: document.getElementById("overviewSnippetsCount"),
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
   CUSTOM CONFIRMATION MODAL
   ------------------------------------------
   Reuses the SAME `.nova-modal` markup pattern
   already used a few lines below by
   ensureImportModal() — this is not a new
   modal system, just a second instance of the
   one already present in this file. Never
   falls back to window.confirm().
========================================== */
function showConfirmDialog(title, message, options = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "nova-modal";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-labelledby", "dashConfirmModalTitle");

        overlay.innerHTML = `
            <div class="nova-modal-backdrop" data-confirm-cancel></div>
            <div class="nova-modal-dialog" role="document">
                <div class="nova-modal-header">
                    <h2 id="dashConfirmModalTitle" class="nova-modal-title">${escapeHtml(title)}</h2>
                    <button type="button" class="nova-modal-close" data-confirm-cancel aria-label="Close">
                        <i class="ri-close-line"></i>
                    </button>
                </div>
                <div class="nova-modal-body">
                    <p class="nova-modal-description">${escapeHtml(message)}</p>
                </div>
                <div class="nova-modal-footer">
                    <button type="button" class="btn btn-outline" data-confirm-cancel>Cancel</button>
                    <button type="button" class="btn btn-primary" data-confirm-ok style="${options.danger ? "background:#dc2626;" : ""}">
                        ${escapeHtml(options.confirmLabel || "Confirm")}
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        document.body.classList.add("nova-modal-open");

        const dialog = overlay.querySelector(".nova-modal-dialog");
        dialog?.addEventListener("click", (event) => event.stopPropagation());

        function onKeydown(event) {
            if (event.key === "Escape") cleanup(false);
        }

        function cleanup(result) {
            overlay.remove();
            document.body.classList.remove("nova-modal-open");
            document.removeEventListener("keydown", onKeydown);
            resolve(result);
        }

        document.addEventListener("keydown", onKeydown);

        overlay.querySelectorAll("[data-confirm-cancel]").forEach((el) => {
            el.addEventListener("click", (event) => {
                event.preventDefault();
                cleanup(false);
            });
        });

        overlay.querySelector("[data-confirm-ok]")?.addEventListener("click", (event) => {
            event.preventDefault();
            cleanup(true);
        });

        overlay.querySelector("[data-confirm-ok]")?.focus();
    });
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
        // NOTE: updateProject(projectId, projectData) — firestore.js does not
        // take a uid argument. The previous 3-arg call here was a bug that
        // silently wrote to the wrong document; fixed as part of this change.
        const response = await updateProject(id, {
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
   PROJECT ACTIONS MENU
========================================== */
function closeProjectMenus() {
    document.querySelectorAll(".project-card-menu").forEach((menu) => menu.remove());
    document.querySelectorAll(".project-card-menu-btn.is-open").forEach((btn) => {
        btn.classList.remove("is-open");
    });
    STATE.openMenuProjectId = null;
}

function createProjectMenu(projectId, anchorBtn) {
    closeProjectMenus();

    const project = STATE.projects.find((p) => p.id === projectId);
    if (!project) return;

    const menu = document.createElement("div");
    menu.className = "project-card-menu";
    menu.setAttribute("role", "menu");
    menu.dataset.projectId = projectId;

    const favoriteLabel = project.starred ? "Remove from Favorites" : "Add to Favorites";

    menu.innerHTML = `
        <button type="button" class="project-card-menu-item" data-action="open" role="menuitem">
            Open Project
        </button>
        <button type="button" class="project-card-menu-item" data-action="favorite" role="menuitem">
            ${escapeHtml(favoriteLabel)}
        </button>
        <button type="button" class="project-card-menu-item" data-action="rename" role="menuitem">
            Rename
        </button>
        <button type="button" class="project-card-menu-item" data-action="duplicate" role="menuitem">
            Duplicate
        </button>
        <div class="project-card-menu-divider" role="separator"></div>
        <button type="button" class="project-card-menu-item project-card-menu-item-danger" data-action="trash" role="menuitem">
            Move to Trash
        </button>
    `;

    const card = anchorBtn.closest(".project-card");
    if (card) {
        card.style.position = card.style.position || "relative";
        card.appendChild(menu);
    } else {
        document.body.appendChild(menu);
    }

    const btnRect = anchorBtn.getBoundingClientRect();
    const cardRect = card ? card.getBoundingClientRect() : { top: 0, left: 0 };
    menu.style.position = "absolute";
    menu.style.top = `${btnRect.bottom - cardRect.top + 4}px`;
    menu.style.right = `${cardRect.right - btnRect.right}px`;
    menu.style.zIndex = "100";

    anchorBtn.classList.add("is-open");
    STATE.openMenuProjectId = projectId;

    menu.querySelectorAll("[data-action]").forEach((item) => {
        item.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const action = item.dataset.action;
            closeProjectMenus();
            handleProjectAction(action, projectId);
        });
    });
}

function handleProjectAction(action, projectId) {
    const project = STATE.projects.find((p) => p.id === projectId);
    if (!project) {
        showToast("Project not found.", "error");
        return;
    }

    switch (action) {
        case "open":
            openProject(projectId);
            break;
        case "favorite":
            toggleFavorite(project);
            break;
        case "rename":
            renameProject(project);
            break;
        case "duplicate":
            duplicateProject(project);
            break;
        case "trash":
            moveProjectToTrash(project);
            break;
        default:
            break;
    }
}

/* ==========================================
   FAVORITES
   ------------------------------------------
   Reuses the `starred` boolean that already
   exists on every project document (see
   createProject() in firestore.js, which sets
   starred: false on creation). No second
   favorites collection or local flag is
   introduced — toggling here is the exact same
   updateProject() write path used by rename/
   trash, and it is immediately visible to any
   other part of the app that reads
   project.starred.
========================================== */
async function toggleFavorite(project) {
    if (!STATE.uid) {
        showToast("You must be signed in to update favorites.", "error");
        return;
    }

    const nextStarred = !project.starred;

    try {
        const response = await updateProject(project.id, { starred: nextStarred });
        if (!response || !response.success) {
            showToast(response?.error || response?.message || "Unable to update favorites.", "error");
            return;
        }
        project.starred = nextStarred;
        renderFavorites();
        renderWorkspaceOverview();
        showToast(nextStarred ? "Added to Favorites." : "Removed from Favorites.", "success");
    } catch (err) {
        console.error("[dashboard] toggleFavorite failed:", err);
        showToast("Unable to update favorites.", "error");
    }
}

function renderFavorites() {
    if (!DOM.favoritesList) return;

    const favorites = STATE.projects
        .filter((p) => p.starred === true)
        .slice(0, CONFIG.FAVORITES_LIMIT);

    if (favorites.length === 0) {
        DOM.favoritesList.innerHTML = `
            <p class="panel-empty">
                No favorites yet.<br />
                Add projects to Favorites to access them quickly.
            </p>
        `;
        return;
    }

    DOM.favoritesList.innerHTML = favorites
        .map((project) => {
            const meta = languageMeta(project.language);
            return `
              <a class="simple-list-item" href="#" data-project-id="${escapeHtml(project.id)}">
                <span class="simple-list-icon ${meta.className}"><i class="ri-star-fill"></i></span>
                <span class="simple-list-item-name">${escapeHtml(project.name)}</span>
                <span class="simple-list-item-meta">${timeAgo(project.lastOpenedAt || project.updatedAt)}</span>
              </a>
            `;
        })
        .join("");

    DOM.favoritesList.querySelectorAll("[data-project-id]").forEach((item) => {
        item.addEventListener("click", (event) => {
            event.preventDefault();
            openProject(item.dataset.projectId);
        });
    });
}

async function renameProject(project) {
    const currentName = project.name || "";
    let newName = null;

    if (typeof window.showPrompt === "function") {
        newName = await window.showPrompt("Rename project", currentName);
    } else {
        newName = window.prompt("Rename project", currentName);
    }

    if (newName === null) return;
    newName = String(newName).trim();
    if (!newName || newName === currentName) return;

    if (!STATE.uid) {
        showToast("You must be signed in to rename a project.", "error");
        return;
    }

    try {
        // Fixed: updateProject(projectId, projectData) — no uid argument.
        const response = await updateProject(project.id, {
            name: newName,
            updatedAt: new Date(),
        });
        if (!response || !response.success) {
            showToast(response?.error || response?.message || "Failed to rename project.", "error");
            return;
        }

        project.name = newName;
        renderContinueCoding();
        renderRecentProjects();
        renderFavorites();
        renderActivityFromProjects();
        showToast("Project renamed.", "success");
    } catch (err) {
        console.error("[dashboard] renameProject failed:", err);
        showToast("Failed to rename project.", "error");
    }
}

async function duplicateProject(project) {
    if (!STATE.uid) {
        showToast("You must be signed in to duplicate a project.", "error");
        return;
    }

    const baseName = project.name || "Untitled";
    const copyName = `${baseName} Copy`;

    if (typeof window.createProject === "function") {
        try {
            const result = await window.createProject({
                name: copyName,
                language: project.language,
                description: project.description,
            });
            if (result && result.success !== false) {
                showToast("Project duplicated.", "success");
                await loadProjects();
                return;
            }
            showToast(result?.error || result?.message || "Failed to duplicate project.", "error");
            return;
        } catch (err) {
            console.error("[dashboard] duplicate via window.createProject failed:", err);
        }
    }

    document.dispatchEvent(
        new CustomEvent("novaeditor:duplicate-project", {
            detail: {
                sourceProjectId: project.id,
                name: copyName,
                language: project.language,
                description: project.description,
            },
        })
    );

    showToast("Duplicating project…", "info");
}

/* ==========================================
   MOVE TO TRASH
   ------------------------------------------
   Uses the SAME `archived` / `deletedAt` fields
   as projects.js (Trash tab), so a project
   trashed from the Dashboard shows up correctly
   in the Projects → Trash tab and vice versa.
   Always shows the custom confirmation modal —
   never window.confirm().
========================================== */
async function moveProjectToTrash(project) {
    if (!STATE.uid) {
        showToast("You must be signed in.", "error");
        return;
    }

    const confirmed = await showConfirmDialog(
        "Move to Trash?",
        `"${project.name || "This project"}" will be moved to Trash. You can restore it later from the Trash tab in Projects.`,
        { confirmLabel: "Move to Trash", danger: true }
    );
    if (!confirmed) return;

    try {
        const response = await updateProject(project.id, {
            archived: true,
            deletedAt: new Date(),
        });

        if (!response || !response.success) {
            showToast("Unable to move project to Trash.", "error");
            return;
        }

        STATE.projects = STATE.projects.filter((p) => p.id !== project.id);
        if (getCurrentProject() === project.id) {
            clearCurrentProject();
        }
        invalidatePreviewCache(project.id);
        renderContinueCoding();
        renderRecentProjects();
        renderFavorites();
        renderActivityFromProjects();
        renderWorkspaceOverview();
        showToast("Project moved to Trash.", "success");
        document.dispatchEvent(
            new CustomEvent("novaeditor:project-trashed", { detail: { projectId: project.id } })
        );
    } catch (err) {
        console.error("[dashboard] moveProjectToTrash failed:", err);
        showToast("Unable to move project to Trash.", "error");
    }
}

function attachProjectMenuGlobalListeners() {
    document.addEventListener("click", (event) => {
        if (
            event.target.closest(".project-card-menu") ||
            event.target.closest(".project-card-menu-btn")
        ) {
            return;
        }
        closeProjectMenus();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeProjectMenus();
            closeImportModal();
        }
    });
}

/* ==========================================
   CROSS-PAGE / SAME-PAGE TRASH SYNC
   ------------------------------------------
   If Trash actions happen elsewhere on the same
   page load (e.g. a future Trash panel on the
   dashboard, or another script), just refresh
   from Firestore instead of hand-rolling a
   second projects list.
========================================== */
function attachTrashSyncListeners() {
    document.addEventListener("novaeditor:project-trashed", () => loadProjects());
    document.addEventListener("novaeditor:project-restored", () => loadProjects());
    document.addEventListener("novaeditor:project-permanently-deleted", () => loadProjects());
}

/* ==========================================
   IMPORT PROJECT MODAL
========================================== */
function ensureImportModal() {
    let modal = document.getElementById("importProjectModal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "importProjectModal";
    modal.className = "nova-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "importProjectModalTitle");
    modal.hidden = true;

    modal.innerHTML = `
        <div class="nova-modal-backdrop" data-import-close></div>
        <div class="nova-modal-dialog" role="document">
            <div class="nova-modal-header">
                <h2 id="importProjectModalTitle" class="nova-modal-title">Import Project</h2>
                <button type="button" class="nova-modal-close" data-import-close aria-label="Close">
                    <i class="ri-close-line"></i>
                </button>
            </div>
            <div class="nova-modal-body">
                <p class="nova-modal-description">
                    Import an existing project into Nova Editor.
                </p>
                <div class="import-dropzone" id="importDropzone" tabindex="0" role="button" aria-label="Choose project file">
                    <input
                        type="file"
                        id="importProjectFileInput"
                        class="import-file-input"
                        accept=".zip,.json,.html,.htm,application/zip,application/json,text/html"
                        hidden
                    />
                    <div class="import-dropzone-inner" id="importDropzoneInner">
                        <span class="import-dropzone-icon" aria-hidden="true">
                            <i class="ri-folder-upload-line"></i>
                        </span>
                        <strong class="import-dropzone-label">Choose Project</strong>
                        <span class="import-dropzone-hint">ZIP, JSON export, or HTML entry file</span>
                    </div>
                    <div class="import-selected" id="importSelected" hidden>
                        <span class="import-selected-icon" aria-hidden="true">
                            <i class="ri-file-code-line"></i>
                        </span>
                        <div class="import-selected-meta">
                            <strong id="importSelectedName"></strong>
                            <small id="importSelectedMeta"></small>
                        </div>
                        <button type="button" class="import-selected-clear" id="importClearSelection" aria-label="Clear selection">
                            <i class="ri-close-line"></i>
                        </button>
                    </div>
                </div>
                <p class="import-error" id="importError" hidden role="alert"></p>
            </div>
            <div class="nova-modal-footer">
                <button type="button" class="btn btn-outline" data-import-close>Cancel</button>
                <button type="button" class="btn btn-primary" id="importConfirmBtn" disabled>
                    Import Project
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    modal.querySelectorAll("[data-import-close]").forEach((el) => {
        el.addEventListener("click", (e) => {
            e.preventDefault();
            closeImportModal();
        });
    });

    const dialog = modal.querySelector(".nova-modal-dialog");
    if (dialog) {
        dialog.addEventListener("click", (e) => e.stopPropagation());
    }

    const dropzone = modal.querySelector("#importDropzone");
    const fileInput = modal.querySelector("#importProjectFileInput");
    const confirmBtn = modal.querySelector("#importConfirmBtn");
    const clearBtn = modal.querySelector("#importClearSelection");

    dropzone.addEventListener("click", (e) => {
        if (e.target.closest("#importClearSelection")) return;
        fileInput.click();
    });

    dropzone.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInput.click();
        }
    });

    ["dragenter", "dragover"].forEach((evt) => {
        dropzone.addEventListener(evt, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add("is-dragover");
        });
    });
    ["dragleave", "drop"].forEach((evt) => {
        dropzone.addEventListener(evt, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove("is-dragover");
        });
    });
    dropzone.addEventListener("drop", (e) => {
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            handleImportFileSelection(files[0]);
        }
    });

    fileInput.addEventListener("change", () => {
        const file = fileInput.files && fileInput.files[0];
        if (file) {
            handleImportFileSelection(file);
        }
    });

    clearBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearImportSelection();
    });

    confirmBtn.addEventListener("click", (e) => {
        e.preventDefault();
        submitImportProject();
    });

    return modal;
}

function openImportModal() {
    const modal = ensureImportModal();
    clearImportSelection();
    modal.hidden = false;
    document.body.classList.add("nova-modal-open");
    const closeBtn = modal.querySelector(".nova-modal-close");
    if (closeBtn) closeBtn.focus();
}

function closeImportModal() {
    const modal = document.getElementById("importProjectModal");
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove("nova-modal-open");
    clearImportSelection();
}

function setImportError(message) {
    const el = document.getElementById("importError");
    if (!el) return;
    if (!message) {
        el.hidden = true;
        el.textContent = "";
        return;
    }
    el.hidden = false;
    el.textContent = message;
}

function clearImportSelection() {
    STATE.importSelection = null;
    const fileInput = document.getElementById("importProjectFileInput");
    if (fileInput) fileInput.value = "";

    const dropInner = document.getElementById("importDropzoneInner");
    const selected = document.getElementById("importSelected");
    const confirmBtn = document.getElementById("importConfirmBtn");

    if (dropInner) dropInner.hidden = false;
    if (selected) selected.hidden = true;
    if (confirmBtn) confirmBtn.disabled = true;
    setImportError("");
}

function formatFileSize(bytes) {
    if (!bytes || bytes < 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function detectLanguageFromName(name) {
    const lower = String(name || "").toLowerCase();
    if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
    if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs")) return "javascript";
    if (lower.endsWith(".py")) return "python";
    if (lower.endsWith(".java")) return "java";
    if (lower.endsWith(".cpp") || lower.endsWith(".cc") || lower.endsWith(".cxx") || lower.endsWith(".h")) return "cpp";
    if (lower.endsWith(".css")) return "css";
    if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
    if (lower.endsWith(".json")) return "javascript";
    if (lower.endsWith(".zip")) return "html";
    return "html";
}

function projectNameFromFile(file) {
    const raw = String(file?.name || "Imported Project");
    return raw.replace(/\.(zip|json|html?|htm)$/i, "").trim() || "Imported Project";
}

async function handleImportFileSelection(file) {
    setImportError("");
    if (!file) {
        clearImportSelection();
        return;
    }

    const name = String(file.name || "").toLowerCase();
    const validExt =
        name.endsWith(".zip") ||
        name.endsWith(".json") ||
        name.endsWith(".html") ||
        name.endsWith(".htm");

    if (!validExt) {
        setImportError("Unsupported format. Use a .zip, .json export, or .html file.");
        clearImportSelection();
        return;
    }

    if (file.size > 50 * 1024 * 1024) {
        setImportError("File is too large. Maximum size is 50 MB.");
        clearImportSelection();
        return;
    }

    let parsedPayload = null;
    if (name.endsWith(".json")) {
        try {
            const text = await file.text();
            parsedPayload = JSON.parse(text);
            if (!parsedPayload || typeof parsedPayload !== "object") {
                throw new Error("Invalid project JSON");
            }
        } catch (err) {
            console.error("[dashboard] invalid import JSON:", err);
            setImportError("Invalid project JSON. Please export a valid Nova project.");
            clearImportSelection();
            return;
        }
    }

    STATE.importSelection = {
        file,
        name: projectNameFromFile(file),
        language: detectLanguageFromName(file.name),
        size: file.size,
        payload: parsedPayload,
    };

    const dropInner = document.getElementById("importDropzoneInner");
    const selected = document.getElementById("importSelected");
    const selectedName = document.getElementById("importSelectedName");
    const selectedMeta = document.getElementById("importSelectedMeta");
    const confirmBtn = document.getElementById("importConfirmBtn");

    if (dropInner) dropInner.hidden = true;
    if (selected) selected.hidden = false;
    if (selectedName) selectedName.textContent = STATE.importSelection.name;
    if (selectedMeta) {
        selectedMeta.textContent = `${file.name} · ${formatFileSize(file.size)}`;
    }
    if (confirmBtn) confirmBtn.disabled = false;
}

function uniqueImportedName(baseName) {
    const existing = new Set(
        (STATE.projects || []).map((p) => String(p.name || "").toLowerCase())
    );
    let name = baseName;
    let n = 2;
    while (existing.has(name.toLowerCase())) {
        name = `${baseName} (${n})`;
        n += 1;
    }
    return name;
}

async function submitImportProject() {
    const selection = STATE.importSelection;
    if (!selection || !selection.file) {
        setImportError("Please choose a project file first.");
        return;
    }
    if (!STATE.uid) {
        setImportError("You must be signed in to import a project.");
        return;
    }

    const confirmBtn = document.getElementById("importConfirmBtn");
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = "Importing…";
    }
    setImportError("");

    const projectName = uniqueImportedName(selection.name);
    const language = selection.language || "html";

    try {
        if (typeof window.importProject === "function") {
            const result = await window.importProject({
                file: selection.file,
                name: projectName,
                language,
                payload: selection.payload,
            });
            if (result && result.success !== false) {
                showToast("Project imported successfully.", "success");
                closeImportModal();
                await loadProjects();
                document.dispatchEvent(new CustomEvent("novaeditor:project-created"));
                return;
            }
            throw new Error(result?.error || result?.message || "Import failed");
        }

        if (typeof window.createProject === "function") {
            const result = await window.createProject({
                name: projectName,
                language,
                description: selection.file.name,
                source: "import",
                file: selection.file,
                payload: selection.payload,
            });
            if (result && result.success !== false) {
                showToast("Project imported successfully.", "success");
                closeImportModal();
                await loadProjects();
                document.dispatchEvent(new CustomEvent("novaeditor:project-created"));
                return;
            }
            throw new Error(result?.error || result?.message || "Import failed");
        }

        const detail = {
            file: selection.file,
            name: projectName,
            language,
            payload: selection.payload,
            uid: STATE.uid,
        };

        const handled = await new Promise((resolve) => {
            let settled = false;
            const onResult = (event) => {
                if (settled) return;
                settled = true;
                document.removeEventListener("novaeditor:import-project-result", onResult);
                resolve(event.detail || { success: true });
            };
            document.addEventListener("novaeditor:import-project-result", onResult, { once: true });
            document.dispatchEvent(new CustomEvent("novaeditor:import-project", { detail }));

            setTimeout(() => {
                if (settled) return;
                settled = true;
                document.removeEventListener("novaeditor:import-project-result", onResult);
                resolve({ success: false, error: "No import handler available." });
            }, 8000);
        });

        if (handled && handled.success !== false) {
            showToast("Project imported successfully.", "success");
            closeImportModal();
            await loadProjects();
            document.dispatchEvent(new CustomEvent("novaeditor:project-created"));
            return;
        }

        throw new Error(handled?.error || "Import failed. Project import is not configured.");
    } catch (err) {
        console.error("[dashboard] import failed:", err);
        const msg =
            (err && (err.message || err.error)) ||
            "Unable to import project. Please try again.";
        setImportError(String(msg));
        showToast(String(msg), "error");
    } finally {
        if (confirmBtn) {
            confirmBtn.disabled = !STATE.importSelection;
            confirmBtn.textContent = "Import Project";
        }
    }
}

function attachImportProjectButton() {
    let btn =
        document.getElementById("importProjectBtn") ||
        document.getElementById("dashImportProjectBtn") ||
        document.querySelector("[data-action='import-project']");

    if (!btn) {
        const candidates = document.querySelectorAll(
            ".dash-hero-actions a, .dash-hero-actions button, .dash-hero-actions .btn"
        );
        candidates.forEach((el) => {
            const text = (el.textContent || "").trim().toLowerCase();
            if (text.includes("import project")) {
                btn = el;
            }
        });
    }

    if (!btn) {
        console.warn("[dashboard] Import Project button not found in DOM.");
        return;
    }

    btn.addEventListener("click", (event) => {
        event.preventDefault();
        openImportModal();
    });
}

/* ==========================================
   PROJECT PREVIEW
   ------------------------------------------
   IMPORTANT: This section deliberately contains
   NO html/css/js inlining logic of its own.
   All document-building goes through
   buildPreviewDocument() from
   components/preview.js — the exact same
   function the Editor's live preview iframe
   uses. This file only fetches project files
   from Firestore, hands them to that shared
   builder, and caches/mounts the resulting
   HTML. That keeps there being exactly ONE
   preview engine in the app.
========================================== */
function getPreviewCacheKey(project) {
    const id = project?.id || "";
    const updated = toMillis(project?.updatedAt) || toMillis(project?.lastOpenedAt) || 0;
    return `${id}:${updated}`;
}

function readPersistedThumb(cacheKey) {
    try {
        const raw = localStorage.getItem(CONFIG.PREVIEW_CACHE_PREFIX + cacheKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.html === "string" && parsed.html.length > 0) {
            return parsed.html;
        }
    } catch (_) {
        /* ignore quota / parse errors */
    }
    return null;
}

function writePersistedThumb(cacheKey, html) {
    try {
        // Avoid blowing storage with huge docs
        if (!html || html.length > 400000) return;
        localStorage.setItem(
            CONFIG.PREVIEW_CACHE_PREFIX + cacheKey,
            JSON.stringify({ html, savedAt: Date.now() })
        );
    } catch (_) {
        /* quota exceeded — ignore */
    }
}

function invalidatePreviewCache(projectId) {
    if (!projectId) return;
    for (const key of [...STATE.previewCache.keys()]) {
        if (key.startsWith(`${projectId}:`) || key === projectId) {
            STATE.previewCache.delete(key);
        }
    }
    try {
        const prefix = CONFIG.PREVIEW_CACHE_PREFIX;
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(prefix) && k.includes(projectId)) {
                toRemove.push(k);
            }
        }
        toRemove.forEach((k) => localStorage.removeItem(k));
    } catch (_) {
        /* ignore */
    }
}

/**
 * Fetch a project's files from Firestore and build its preview HTML
 * using the shared engine in components/preview.js. Returns a full
 * HTML document string, or null if no renderable preview exists.
 */
async function loadProjectPreviewDocument(project) {
    if (!project?.id) return null;

    // Cheap shortcut: a stored preview snapshot on the project record
    // itself (if the app ever starts persisting one) is honored first,
    // but this is a cache lookup, not a second rendering pipeline.
    if (typeof project.previewHtml === "string" && project.previewHtml.trim()) {
        return project.previewHtml;
    }
    if (typeof project.thumbnailHtml === "string" && project.thumbnailHtml.trim()) {
        return project.thumbnailHtml;
    }

    try {
        const filesResponse = await getFiles(project.id);
        if (!filesResponse.success || !Array.isArray(filesResponse.data) || !filesResponse.data.length) {
            return null;
        }

        const files = filesResponse.data.map((f) => ({
            path: f.path || f.name,
            content: f.content || "",
        }));

        const built = buildPreviewDocument({ files, fileContents: {}, activeFile: null });
        return built.success ? built.html : null;
    } catch (err) {
        console.warn("[dashboard] loadProjectPreviewDocument failed for", project.id, err);
        return null;
    }
}

function setThumbFallback(thumbEl) {
    if (!thumbEl) return;
    const existingPreview = thumbEl.querySelector(".project-card-preview-frame, .project-card-preview-img, .project-card-thumb-loading");
    if (existingPreview) existingPreview.remove();
    if (!thumbEl.querySelector(".ri-code-s-slash-line")) {
        const icon = document.createElement("i");
        icon.className = "ri-code-s-slash-line";
        thumbEl.insertBefore(icon, thumbEl.firstChild);
    }
    thumbEl.classList.remove("has-preview");
}

function setThumbLoading(thumbEl) {
    if (!thumbEl) return;
    if (thumbEl.querySelector(".project-card-thumb-loading")) return;
    const loader = document.createElement("div");
    loader.className = "project-card-thumb-loading";
    loader.innerHTML = `<span class="project-card-thumb-skeleton"></span>`;
    // Keep icon underneath until preview ready
    thumbEl.appendChild(loader);
}

// Fixed "virtual" viewport the project is rendered at, then scaled down
// to fit whatever thumbnail box it's mounted in. Rendering small forces
// the page's own layout to reflow oddly and shows native iframe
// scrollbars where content overflows the tiny box; rendering it at a
// normal desktop size and scaling the whole iframe down (like a
// website-thumbnail snapshot) avoids both problems.
const PREVIEW_VIRTUAL_WIDTH = 1280;
const PREVIEW_VIRTUAL_HEIGHT = 800;

function mountPreviewIframe(thumbEl, html) {
    if (!thumbEl || !html) {
        setThumbFallback(thumbEl);
        return;
    }

    thumbEl.querySelector(".project-card-thumb-loading")?.remove();
    thumbEl.querySelector(".ri-code-s-slash-line")?.remove();
    thumbEl.querySelector(".project-card-preview-frame")?.remove();
    thumbEl.querySelector(".project-card-preview-img")?.remove();

    const frameWrap = document.createElement("div");
    frameWrap.className = "project-card-preview-frame";
    frameWrap.setAttribute("aria-hidden", "true");

    const iframe = document.createElement("iframe");
    iframe.className = "project-card-preview-iframe";
    iframe.setAttribute(
        "sandbox",
        "allow-scripts allow-forms allow-modals allow-popups-to-escape-sandbox"
    );
    iframe.setAttribute("tabindex", "-1");
    iframe.setAttribute("loading", "lazy");
    // Suppress the iframe's own native scrollbars — the project's page
    // is rendered full-size (see below) and scaled down, so scrollbars
    // would otherwise render at full un-scaled thickness and poke out
    // past the rounded thumbnail corners.
    iframe.setAttribute("scrolling", "no");
    iframe.title = "Project preview";

    // Render at a fixed desktop-like size, top-left anchored, then
    // scale the whole thing down to the thumbnail's actual box.
    iframe.style.position = "absolute";
    iframe.style.top = "0";
    iframe.style.left = "0";
    iframe.style.width = `${PREVIEW_VIRTUAL_WIDTH}px`;
    iframe.style.height = `${PREVIEW_VIRTUAL_HEIGHT}px`;
    iframe.style.border = "0";
    iframe.style.background = "#ffffff";
    iframe.style.transformOrigin = "top left";
    // Pointer events off so card click / 3-dot still work
    iframe.style.pointerEvents = "none";
    iframe.srcdoc = html;

    frameWrap.appendChild(iframe);
    // Insert before the menu button so button stays on top
    const menuBtn = thumbEl.querySelector(".project-card-menu-btn");
    if (menuBtn) {
        thumbEl.insertBefore(frameWrap, menuBtn);
    } else {
        thumbEl.appendChild(frameWrap);
    }
    thumbEl.classList.add("has-preview");

    scalePreviewIframeToFit(frameWrap, iframe);
}

/**
 * Scales a virtual-size preview iframe down (or up) so it exactly
 * covers its wrapper, cropping overflow — the same "cover" behavior
 * as a CSS background-image thumbnail. Re-applies on resize so it
 * stays correct across responsive breakpoints (e.g. the projects grid
 * going from 4 to 1 column).
 */
function scalePreviewIframeToFit(frameWrap, iframe) {
    const apply = () => {
        if (!frameWrap.isConnected) return;
        const containerWidth = frameWrap.clientWidth;
        const containerHeight = frameWrap.clientHeight;
        if (!containerWidth || !containerHeight) return;
        const scale = Math.max(
            containerWidth / PREVIEW_VIRTUAL_WIDTH,
            containerHeight / PREVIEW_VIRTUAL_HEIGHT
        );
        iframe.style.transform = `scale(${scale})`;
    };

    apply();

    if (typeof ResizeObserver === "function") {
        const observer = new ResizeObserver(() => apply());
        observer.observe(frameWrap);
    } else {
        // Fallback for older browsers without ResizeObserver support
        window.addEventListener("resize", apply);
    }
}

async function resolvePreviewHtml(project) {
    const cacheKey = getPreviewCacheKey(project);

    const mem = STATE.previewCache.get(project.id);
    if (mem && mem.key === cacheKey) {
        if (mem.failed) return null;
        if (mem.html) return mem.html;
    }

    const persisted = readPersistedThumb(cacheKey);
    if (persisted) {
        STATE.previewCache.set(project.id, { key: cacheKey, html: persisted });
        return persisted;
    }

    try {
        const html = await loadProjectPreviewDocument(project);
        if (html && html.trim()) {
            STATE.previewCache.set(project.id, { key: cacheKey, html });
            writePersistedThumb(cacheKey, html);
            return html;
        }
        STATE.previewCache.set(project.id, { key: cacheKey, html: null, failed: true });
        return null;
    } catch (err) {
        console.warn("[dashboard] preview resolve failed for", project.id, err);
        STATE.previewCache.set(project.id, { key: cacheKey, html: null, failed: true });
        return null;
    }
}

async function hydrateProjectThumbnails(projects) {
    if (!DOM.recentProjectsGrid) return;

    // Stagger slightly so first paint stays responsive
    const queue = projects.slice();

    const runOne = async (project) => {
        const card = DOM.recentProjectsGrid.querySelector(
            `.project-card[data-project-id="${CSS.escape(project.id)}"]`
        );
        if (!card) return;
        const thumb = card.querySelector(".project-card-thumb");
        if (!thumb) return;

        const cacheKey = getPreviewCacheKey(project);
        const mem = STATE.previewCache.get(project.id);
        if (mem && mem.key === cacheKey && mem.html) {
            mountPreviewIframe(thumb, mem.html);
            return;
        }
        if (mem && mem.key === cacheKey && mem.failed) {
            setThumbFallback(thumb);
            return;
        }

        setThumbLoading(thumb);
        const html = await resolvePreviewHtml(project);
        // Card may have been re-rendered meanwhile
        const still = DOM.recentProjectsGrid.querySelector(
            `.project-card[data-project-id="${CSS.escape(project.id)}"] .project-card-thumb`
        );
        if (!still) return;
        if (html) {
            mountPreviewIframe(still, html);
        } else {
            setThumbFallback(still);
        }
    };

    // Limit concurrency
    const concurrency = 3;
    let idx = 0;
    const workers = Array.from({ length: concurrency }, async () => {
        while (idx < queue.length) {
            const current = queue[idx++];
            await runOne(current);
        }
    });
    await Promise.all(workers);
}

/**
 * Renders the large Continue Coding preview. Reuses the exact same
 * mount/fallback/loading helpers as the Recent Projects grid thumbs —
 * this is the same preview surface, just presented larger, not a
 * second implementation.
 */
async function renderContinuePreview(project) {
    if (!DOM.continuePreviewWrap) return;

    const cacheKey = getPreviewCacheKey(project);
    const mem = STATE.previewCache.get(project.id);
    if (mem && mem.key === cacheKey && mem.html) {
        mountPreviewIframe(DOM.continuePreviewWrap, mem.html);
        return;
    }
    if (mem && mem.key === cacheKey && mem.failed) {
        setThumbFallback(DOM.continuePreviewWrap);
        return;
    }

    setThumbLoading(DOM.continuePreviewWrap);
    const html = await resolvePreviewHtml(project);

    // Bail out if the "latest" project changed while we were awaiting
    if (STATE.projects[0]?.id !== project.id) return;

    if (html) {
        mountPreviewIframe(DOM.continuePreviewWrap, html);
    } else {
        setThumbFallback(DOM.continuePreviewWrap);
    }
}

/* ==========================================
   PROJECTS
   ------------------------------------------
   Trashed projects (archived === true) are
   excluded from every Dashboard surface —
   Continue Coding, Recent Projects, Favorites,
   Recent Activity, and the overview counts —
   so a project moved to Trash (from here or
   from the Projects page) disappears
   immediately, and a restored project
   reappears next load.
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
        .filter((p) => p.archived !== true)
        .slice()
        .sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));
    renderContinueCoding();
    renderRecentProjects();
    renderFavorites();
    renderActivityFromProjects();
    renderWorkspaceOverview();
}

function renderContinueCoding() {
    if (!DOM.continueSection) return;
    const latest = STATE.projects[0];

    if (!latest) {
        DOM.continueSection.hidden = true;
        if (DOM.continueEmptyState) DOM.continueEmptyState.hidden = false;
        return;
    }

    if (DOM.continueEmptyState) DOM.continueEmptyState.hidden = true;
    DOM.continueSection.hidden = false;

    if (DOM.continueMeta) {
        DOM.continueMeta.textContent = `You left off ${timeAgo(latest.updatedAt)}`;
    }
    if (DOM.continueName) {
        DOM.continueName.textContent = latest.name;
    }
    if (DOM.continueDescription) {
        DOM.continueDescription.textContent = latest.description || "";
        DOM.continueDescription.hidden = !latest.description;
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

    renderContinuePreview(latest).catch((err) => {
        console.warn("[dashboard] renderContinuePreview error:", err);
    });
}

function renderRecentProjects() {
    if (!DOM.recentProjectsGrid) return;
    const projects = STATE.projects.slice(0, CONFIG.RECENT_PROJECTS_LIMIT);
    if (projects.length === 0) {
        DOM.recentProjectsGrid.innerHTML = `
      <div class="dash-empty-state">
        <span class="dash-empty-state-icon"><i class="ri-folder-add-line"></i></span>
        <h4>Your projects will appear here.</h4>
        <p>Create a project and start coding with Nova Editor.</p>
        <button type="button" class="btn btn-primary" data-new-project>
          <i class="ri-add-line"></i>
          Create New Project
        </button>
      </div>
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
            <button
                type="button"
                class="project-card-menu-btn"
                aria-label="Project actions"
                title="Project actions"
                data-project-id="${escapeHtml(project.id)}"
            >
                <i class="ri-more-2-fill"></i>
            </button>
          </div>
          <div class="project-card-body">
            <div class="project-card-title-row">
              <strong>${escapeHtml(project.name)}</strong>
              ${project.starred ? '<i class="ri-star-fill project-card-star" title="Favorite"></i>' : ""}
            </div>
            ${project.description ? `<small>${escapeHtml(project.description)}</small>` : ""}
            <small>Updated ${timeAgo(project.updatedAt)}</small>
            <div class="tag-row">
              <span class="tag tag-${meta.className}">${meta.label}</span>
            </div>
          </div>
        </a>
      `;
        })
        .join("");

    DOM.recentProjectsGrid.querySelectorAll("[data-project-id].project-card").forEach((card) => {
        card.addEventListener("click", (event) => {
            if (
                event.target.closest(".project-card-menu-btn") ||
                event.target.closest(".project-card-menu")
            ) {
                return;
            }
            event.preventDefault();
            openProject(card.dataset.projectId);
        });
    });

    DOM.recentProjectsGrid.querySelectorAll(".project-card-menu-btn").forEach((btn) => {
        btn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();

            const projectId = btn.dataset.projectId;
            if (!projectId) return;

            if (STATE.openMenuProjectId === projectId) {
                closeProjectMenus();
                return;
            }

            createProjectMenu(projectId, btn);
        });
    });

    // Async live previews — do not block initial render
    hydrateProjectThumbnails(projects).catch((err) => {
        console.warn("[dashboard] hydrateProjectThumbnails error:", err);
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
   ------------------------------------------
   Projects and Favorites counts are derived
   from the same STATE.projects list used
   everywhere else on the Dashboard. There is
   currently no snippets data source available
   to this page, so that count is left as "—"
   rather than invented.
========================================== */
function renderWorkspaceOverview() {
    if (DOM.overviewProjectsCount) {
        DOM.overviewProjectsCount.textContent = String(STATE.projects.length);
    }
    if (DOM.overviewFavoritesCount) {
        const favoriteCount = STATE.projects.filter((p) => p.starred === true).length;
        DOM.overviewFavoritesCount.textContent = String(favoriteCount);
    }
    if (DOM.overviewSnippetsCount) {
        DOM.overviewSnippetsCount.textContent = "—";
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
    attachProjectMenuGlobalListeners();
    attachTrashSyncListeners();
    attachImportProjectButton();
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