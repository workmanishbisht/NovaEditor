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
    PREVIEW_CACHE_PREFIX: "novaeditor:thumb:",
    PREVIEW_SCALE: 0.35,
    PREVIEW_WIDTH: 800,
    PREVIEW_HEIGHT: 500,
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

    menu.innerHTML = `
        <button type="button" class="project-card-menu-item" data-action="open" role="menuitem">
            Open Project
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
        const response = await updateProject(STATE.uid, project.id, {
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

async function moveProjectToTrash(project) {
    if (!STATE.uid) {
        showToast("You must be signed in.", "error");
        return;
    }

    let confirmed = false;
    if (typeof window.showConfirm === "function") {
        confirmed = await window.showConfirm(
            `Move "${project.name}" to Trash?`,
            "This will remove the project from your workspace."
        );
    } else {
        confirmed = window.confirm(`Move "${project.name}" to Trash?`);
    }

    if (!confirmed) return;

    if (typeof window.moveProjectToTrash === "function") {
        try {
            const result = await window.moveProjectToTrash(project.id);
            if (result && result.success !== false) {
                STATE.projects = STATE.projects.filter((p) => p.id !== project.id);
                if (getCurrentProject() === project.id) {
                    clearCurrentProject();
                }
                invalidatePreviewCache(project.id);
                renderContinueCoding();
                renderRecentProjects();
                renderActivityFromProjects();
                renderWorkspaceOverview();
                showToast("Project moved to Trash.", "success");
                return;
            }
            showToast(result?.error || result?.message || "Failed to move project to Trash.", "error");
            return;
        } catch (err) {
            console.error("[dashboard] moveProjectToTrash helper failed:", err);
        }
    }

    try {
        const response = await updateProject(STATE.uid, project.id, {
            trashed: true,
            trashedAt: new Date(),
            updatedAt: new Date(),
        });
        if (response && response.success) {
            STATE.projects = STATE.projects.filter((p) => p.id !== project.id);
            if (getCurrentProject() === project.id) {
                clearCurrentProject();
            }
            invalidatePreviewCache(project.id);
            renderContinueCoding();
            renderRecentProjects();
            renderActivityFromProjects();
            renderWorkspaceOverview();
            showToast("Project moved to Trash.", "success");
            return;
        }
    } catch (err) {
        console.error("[dashboard] soft-delete via updateProject failed:", err);
    }

    document.dispatchEvent(
        new CustomEvent("novaeditor:trash-project", {
            detail: { projectId: project.id },
        })
    );
    showToast("Request to move project to Trash sent.", "info");
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
   PROJECT PREVIEW THUMBNAILS
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

function normalizeFilesMap(files) {
    if (!files) return [];
    if (Array.isArray(files)) {
        return files
            .map((f) => {
                if (!f) return null;
                if (typeof f === "string") return { name: f, content: f, path: f };
                return {
                    name: f.name || f.path || f.filename || "",
                    path: f.path || f.name || f.filename || "",
                    content: f.content ?? f.code ?? f.value ?? f.text ?? "",
                };
            })
            .filter(Boolean);
    }
    if (typeof files === "object") {
        return Object.keys(files).map((key) => {
            const val = files[key];
            if (typeof val === "string") {
                return { name: key, path: key, content: val };
            }
            return {
                name: val?.name || key,
                path: val?.path || key,
                content: val?.content ?? val?.code ?? val?.value ?? "",
            };
        });
    }
    return [];
}

function findFileByNames(fileList, names) {
    const lowerNames = names.map((n) => n.toLowerCase());
    return (
        fileList.find((f) => {
            const n = String(f.name || f.path || "").toLowerCase();
            const base = n.split("/").pop();
            return lowerNames.includes(n) || lowerNames.includes(base);
        }) || null
    );
}

function collectByExt(fileList, exts) {
    return fileList.filter((f) => {
        const n = String(f.name || f.path || "").toLowerCase();
        return exts.some((ext) => n.endsWith(ext));
    });
}

/**
 * Prefer existing preview helpers from the Editor if present.
 * Returns a full HTML document string or null.
 */
async function loadProjectPreviewDocument(project) {
    if (!project?.id) return null;

    // 1) Stored thumbnail / preview HTML on project record
    if (typeof project.previewHtml === "string" && project.previewHtml.trim()) {
        return project.previewHtml;
    }
    if (typeof project.thumbnailHtml === "string" && project.thumbnailHtml.trim()) {
        return project.thumbnailHtml;
    }

    // 2) Existing global APIs used by Editor Preview
    if (typeof window.buildProjectPreviewHtml === "function") {
        try {
            const html = await window.buildProjectPreviewHtml(project.id, project);
            if (html && typeof html === "string") return html;
        } catch (err) {
            console.warn("[dashboard] buildProjectPreviewHtml failed:", err);
        }
    }
    if (typeof window.getProjectPreviewSrcDoc === "function") {
        try {
            const html = await window.getProjectPreviewSrcDoc(project.id, project);
            if (html && typeof html === "string") return html;
        } catch (err) {
            console.warn("[dashboard] getProjectPreviewSrcDoc failed:", err);
        }
    }
    if (typeof window.getProjectFiles === "function") {
        try {
            const filesResult = await window.getProjectFiles(STATE.uid, project.id);
            const files = filesResult?.data || filesResult?.files || filesResult;
            const doc = composePreviewFromFiles(files, project);
            if (doc) return doc;
        } catch (err) {
            console.warn("[dashboard] getProjectFiles failed:", err);
        }
    }

    // 3) Files already embedded on the project object
    const embedded =
        project.files ||
        project.fileMap ||
        project.sources ||
        (project.html || project.css || project.js
            ? {
                "index.html": project.html || "",
                "style.css": project.css || project.style || "",
                "script.js": project.js || project.javascript || "",
            }
            : null);

    if (embedded) {
        const doc = composePreviewFromFiles(embedded, project);
        if (doc) return doc;
    }

    return null;
}

function composePreviewFromFiles(filesInput, project) {
    const files = normalizeFilesMap(filesInput);
    if (!files.length) {
        // Flat html/css/js on project
        const html = project?.html || project?.content || "";
        if (!html || !String(html).trim()) return null;
        const css = project?.css || project?.style || "";
        const js = project?.js || project?.javascript || "";
        return wrapPreviewDocument(String(html), String(css), String(js));
    }

    const htmlFile =
        findFileByNames(files, ["index.html", "index.htm", "main.html", "app.html"]) ||
        collectByExt(files, [".html", ".htm"])[0];

    if (!htmlFile || !String(htmlFile.content || "").trim()) {
        return null;
    }

    let html = String(htmlFile.content);
    const cssFiles = collectByExt(files, [".css"]);
    const jsFiles = collectByExt(files, [".js", ".mjs"]);

    // Inline linked stylesheets that match project files
    html = html.replace(
        /<link[^>]+href=["']([^"']+)["'][^>]*>/gi,
        (match, href) => {
            const base = String(href).split("?")[0].split("/").pop().toLowerCase();
            const found = cssFiles.find((f) => {
                const n = String(f.name || f.path || "").toLowerCase();
                return n === base || n.endsWith("/" + base) || n === String(href).toLowerCase();
            });
            if (found) {
                return `<style>\n${found.content}\n</style>`;
            }
            return match;
        }
    );

    // Inline local scripts
    html = html.replace(
        /<script([^>]*)src=["']([^"']+)["']([^>]*)><\/script>/gi,
        (match, pre, src, post) => {
            const base = String(src).split("?")[0].split("/").pop().toLowerCase();
            const found = jsFiles.find((f) => {
                const n = String(f.name || f.path || "").toLowerCase();
                return n === base || n.endsWith("/" + base) || n === String(src).toLowerCase();
            });
            if (found) {
                return `<script${pre}${post}>\n${found.content}\n</script>`;
            }
            return match;
        }
    );

    // Append any CSS/JS not already referenced
    const extraCss = cssFiles.map((f) => f.content).filter(Boolean).join("\n");
    const extraJs = jsFiles.map((f) => f.content).filter(Boolean).join("\n");

    return wrapPreviewDocument(html, extraCss, extraJs, true);
}

function wrapPreviewDocument(html, css = "", js = "", alreadyInlined = false) {
    const trimmed = String(html || "").trim();
    if (!trimmed) return null;

    const hasDoc = /<html[\s>]/i.test(trimmed) || /<!doctype/i.test(trimmed);
    let doc = trimmed;

    if (!hasDoc) {
        doc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  html,body{margin:0;padding:0;background:#fff;color:#111;font-family:system-ui,sans-serif;}
  img,video,canvas,iframe{max-width:100%;}
</style>
${css ? `<style>${css}</style>` : ""}
</head>
<body>
${trimmed}
${js ? `<script>${js}<\/script>` : ""}
</body>
</html>`;
        return doc;
    }

    // Inject base reset + optional extras into existing document
    let injected = doc;
    if (css && !alreadyInlined) {
        if (/<\/head>/i.test(injected)) {
            injected = injected.replace(/<\/head>/i, `<style>${css}</style></head>`);
        } else {
            injected = `<style>${css}</style>` + injected;
        }
    }
    if (js && !alreadyInlined) {
        if (/<\/body>/i.test(injected)) {
            injected = injected.replace(/<\/body>/i, `<script>${js}<\/script></body>`);
        } else {
            injected = injected + `<script>${js}<\/script>`;
        }
    }
    return injected;
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
    iframe.title = "Project preview";
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
    attachProjectMenuGlobalListeners();
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