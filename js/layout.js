/* ==========================================
   NOVA EDITOR — LAYOUT.JS
========================================== */

import { showToast } from "../components/toast.js";

/* ==========================================
   CONFIG
========================================== */

const MODULE_URL = new URL(".", import.meta.url);
const PROJECT_ROOT = new URL("../", MODULE_URL);

const CONFIG = {
    ROUTES: {
        EDITOR: "editor.html",
        LOGIN: "login.html",
    },

    PARTIALS: {
        SIDEBAR: new URL("components/sidebar.html", PROJECT_ROOT).href,
        HEADER: new URL("components/header.html", PROJECT_ROOT).href,
        PROJECT_MODAL: new URL("components/project-modal.html", PROJECT_ROOT).href,
    },

    DEFAULT_AVATAR: new URL("assets/images/avatar/default.png", PROJECT_ROOT).href,

    MOUNTS: {
        SIDEBAR: "#sidebarMount",
        HEADER: "#headerMount",
        PROJECT_MODAL: "#projectModalMount",
    },

    THEME_STORAGE_KEY: "novaeditor:theme",
    AUTH_STATE_TIMEOUT_MS: 4000,
};

/* ==========================================
   STATE
========================================== */

const STATE = {
    currentUser: null,
    userData: null,
    workspaces: [],
    currentWorkspace: null,
    theme: "light",
    initialized: false,
    ready: false,
};

const registeredListeners = new Set();

/* ==========================================
   DEPENDENCIES
========================================== */

const deps = {
    auth: {},
    firestore: {},
};

async function loadDependencies() {
    try {
        deps.auth = await import("../firebase/auth.js");
    } catch (error) {
        console.error("[NovaLayout] Failed to load firebase/auth.js:", error);
        deps.auth = {};
    }

    try {
        deps.firestore = await import("../firebase/firestore.js");
    } catch (error) {
        console.error("[NovaLayout] Failed to load firebase/firestore.js:", error);
        deps.firestore = {};
    }
}

/* ==========================================
   SAFE HELPERS
========================================== */

function notify(message, type = "info") {
    if (typeof showToast === "function") {
        showToast(message, type);
    } else {
        console.warn(`[NovaLayout] showToast unavailable — ${type}: ${message}`);
    }
}

async function safeCall(fn, fnName, ...args) {
    if (typeof fn !== "function") {
        console.error(`[NovaLayout] "${fnName}" is not exported by the expected module.`);
        return undefined;
    }
    try {
        return await fn(...args);
    } catch (error) {
        console.error(`[NovaLayout] "${fnName}" threw an error:`, error);
        return undefined;
    }
}

function addDocumentListenerOnce(key, type, handler, options) {
    if (registeredListeners.has(key)) return;
    document.addEventListener(type, handler, options);
    registeredListeners.add(key);
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

function debounce(fn, delay = 300) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

/* ==========================================
   COMPONENT LOADER
========================================== */

async function loadPartial(url, mountSelector) {
    const mount = qs(mountSelector);
    if (!mount) {
        console.error(`[NovaLayout] Mount point "${mountSelector}" not found in the DOM.`);
        return null;
    }

    try {
        const response = await fetch(url, { cache: "no-cache" });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} loading ${url}`);
        }
        const html = await response.text();
        mount.innerHTML = html;
        return mount;
    } catch (error) {
        console.error(`[NovaLayout] loadPartial failed for ${url}:`, error);
        notify(`Unable to load a page component (${mountSelector}). Some features may be unavailable.`, "error");
        return null;
    }
}

/* ==========================================
   SIDEBAR
========================================== */

async function initSidebar() {
    try {
        const mount = await loadPartial(CONFIG.PARTIALS.SIDEBAR, CONFIG.MOUNTS.SIDEBAR);
        if (!mount) return;

        highlightActiveSidebarItem();
        attachSidebarInteractions(mount);
        populateSidebarUser();
    } catch (error) {
        console.error("[NovaLayout] initSidebar error:", error);
    }
}

function highlightActiveSidebarItem() {
    const page = document.body.dataset.page;
    if (!page) return;

    const sidebar = qs(CONFIG.MOUNTS.SIDEBAR);
    if (!sidebar) return;

    qsa("[data-nav-item]", sidebar).forEach((item) => {
        const isActive = item.dataset.navItem === page;
        item.classList.toggle("active", isActive);
        item.setAttribute("aria-current", isActive ? "page" : "false");
    });
}

function attachSidebarInteractions(sidebar) {
    qsa("[data-nav-item]", sidebar).forEach((item) => {
        item.classList.add("nav-item-interactive");
    });

    const logoutBtn = qs("[data-logout]", sidebar);
    if (logoutBtn && logoutBtn.dataset.bound !== "true") {
        logoutBtn.addEventListener("click", handleLogout);
        logoutBtn.dataset.bound = "true";
    }
}

function populateSidebarUser() {
    const sidebar = qs(CONFIG.MOUNTS.SIDEBAR);
    if (!sidebar) return;

    const nameEl = qs("[data-user-name]", sidebar);
    const emailEl = qs("[data-user-email]", sidebar);
    const avatarEl = qs("[data-user-avatar]", sidebar);

    if (!STATE.currentUser) return;

    if (nameEl) nameEl.textContent = STATE.userData?.displayName || STATE.currentUser.displayName || "User";
    if (emailEl) emailEl.textContent = STATE.currentUser.email || "";

    if (avatarEl) {
        avatarEl.src = STATE.userData?.photoURL || STATE.currentUser.photoURL || CONFIG.DEFAULT_AVATAR;
    }
}

/* ==========================================
   HEADER
========================================== */

async function initHeader() {
    try {
        const mount = await loadPartial(CONFIG.PARTIALS.HEADER, CONFIG.MOUNTS.HEADER);
        if (!mount) return;

        attachHeaderSearch(mount);
        attachThemeToggle(mount);
        attachNotifications(mount);
        attachWorkspaceSwitcher(mount);
        await refreshNotificationBadge();
    } catch (error) {
        console.error("[NovaLayout] initHeader error:", error);
    }
}

function attachHeaderSearch(header) {
    const searchInput = qs("#globalSearchInput", header);
    if (!searchInput || searchInput.dataset.novaBound === "true") return;

    const runSearch = debounce((value) => {
        document.dispatchEvent(
            new CustomEvent("novaeditor:search", { detail: { query: value.trim() } })
        );
    }, 250);

    searchInput.addEventListener("input", (event) => {
        runSearch(event.target.value);
    });

    searchInput.dataset.novaBound = "true";
}

/* ==========================================
   THEME TOGGLE
========================================== */

function attachThemeToggle(header) {
    const toggleBtn = qs("[data-theme-toggle]", header);
    if (!toggleBtn) return;

    const savedTheme = localStorage.getItem(CONFIG.THEME_STORAGE_KEY) || "light";
    applyTheme(savedTheme);

    if (toggleBtn.dataset.bound !== "true") {
        toggleBtn.addEventListener("click", () => {
            const nextTheme = STATE.theme === "light" ? "dark" : "light";
            applyTheme(nextTheme);
            localStorage.setItem(CONFIG.THEME_STORAGE_KEY, nextTheme);
        });
        toggleBtn.dataset.bound = "true";
    }
}

function applyTheme(theme) {
    STATE.theme = theme;
    document.documentElement.setAttribute("data-theme", theme);

    const toggleBtn = qs("[data-theme-toggle]");
    if (!toggleBtn) return;
    toggleBtn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
    toggleBtn.classList.toggle("is-dark", theme === "dark");
}

/* ==========================================
   NOTIFICATIONS
========================================== */

function attachNotifications(header) {
    const badge = qs("[data-notification-badge]", header);
    const bell = qs("[data-notification-trigger]", header);
    const panel = qs("[data-notification-panel]", header);

    if (bell && panel && bell.dataset.bound !== "true") {
        bell.addEventListener("click", (event) => {
            event.stopPropagation();
            const isOpen = panel.classList.toggle("open");
            bell.setAttribute("aria-expanded", isOpen ? "true" : "false");
        });
        bell.dataset.bound = "true";

        addDocumentListenerOnce("notification-outside-click", "click", (event) => {
            const currentPanel = qs("[data-notification-panel]");
            const currentBell = qs("[data-notification-trigger]");
            if (currentPanel && !currentPanel.contains(event.target) && !currentBell?.contains(event.target)) {
                currentPanel.classList.remove("open");
                currentBell?.setAttribute("aria-expanded", "false");
            }
        });
    }

    if (!badge) return;
}

async function refreshNotificationBadge() {
    const badge = qs("[data-notification-badge]");
    if (!badge || !STATE.currentUser) return;

    const count = await safeCall(
        deps.firestore.getUnreadNotificationCount,
        "getUnreadNotificationCount",
        STATE.currentUser.uid
    );

    if (typeof count !== "number") {
        badge.hidden = true;
        return;
    }

    if (count > 0) {
        badge.textContent = count > 99 ? "99+" : String(count);
        badge.hidden = false;
    } else {
        badge.hidden = true;
    }
}

/* ==========================================
   USER DROPDOWN
========================================== */

function attachUserDropdown(scope = document) {
    const trigger = qs("[data-user-dropdown-trigger]", scope);
    const dropdown = qs("[data-user-dropdown]", scope);
    if (!trigger || !dropdown) return;

    if (trigger.dataset.bound !== "true") {
        trigger.addEventListener("click", (event) => {
            event.stopPropagation();
            const isOpen = dropdown.classList.toggle("open");
            trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
        });
        trigger.dataset.bound = "true";
    }

    addDocumentListenerOnce("user-dropdown-outside-click", "click", (event) => {
        const currentDropdown = qs("[data-user-dropdown]");
        const currentTrigger = qs("[data-user-dropdown-trigger]");
        if (currentDropdown && !currentDropdown.contains(event.target) && !currentTrigger?.contains(event.target)) {
            currentDropdown.classList.remove("open");
            currentTrigger?.setAttribute("aria-expanded", "false");
        }
    });

    addDocumentListenerOnce("user-dropdown-escape", "keydown", (event) => {
        if (event.key === "Escape") {
            const currentDropdown = qs("[data-user-dropdown]");
            const currentTrigger = qs("[data-user-dropdown-trigger]");
            if (currentDropdown) {
                currentDropdown.classList.remove("open");
                currentTrigger?.setAttribute("aria-expanded", "false");
            }
        }
    });

    const logoutButton = qs("[data-logout]", dropdown);
    if (logoutButton && logoutButton.dataset.bound !== "true") {
        logoutButton.addEventListener("click", handleLogout);
        logoutButton.dataset.bound = "true";
    }
}

/* ==========================================
   LOGOUT
========================================== */

async function handleLogout() {
    if (typeof deps.auth.logout !== "function") {
        notify("Logout is currently unavailable.", "error");
        return;
    }

    await safeCall(deps.auth.logout, "logout");
    window.location.href = CONFIG.ROUTES.LOGIN;
}

/* ==========================================
   SESSION / USER
========================================== */

let authUnsubscribe = null;

function resolveInitialAuthState() {
    return new Promise((resolve) => {
        if (typeof deps.auth.onAuthStateChange !== "function") {
            STATE.currentUser =
                typeof deps.auth.getCurrentUser === "function" ? deps.auth.getCurrentUser() : null;
            resolve();
            return;
        }

        let settled = false;
        const settleOnce = (user) => {
            if (settled) return;
            settled = true;
            STATE.currentUser = user;
            resolve();
        };

        try {
            const unsubscribe = deps.auth.onAuthStateChange((user) => {
                if (!settled) {
                    settleOnce(user);
                    return;
                }
                STATE.currentUser = user;
                refresh();
            });
            authUnsubscribe = typeof unsubscribe === "function" ? unsubscribe : authUnsubscribe;
        } catch (error) {
            console.error("[NovaLayout] onAuthStateChange failed to attach:", error);
            settleOnce(typeof deps.auth.getCurrentUser === "function" ? deps.auth.getCurrentUser() : null);
        }

        setTimeout(() => {
            if (!settled) {
                console.warn(
                    "[NovaLayout] onAuthStateChange did not respond within " +
                    `${CONFIG.AUTH_STATE_TIMEOUT_MS}ms; falling back to getCurrentUser().`
                );
                settleOnce(typeof deps.auth.getCurrentUser === "function" ? deps.auth.getCurrentUser() : null);
            }
        }, CONFIG.AUTH_STATE_TIMEOUT_MS);
    });
}

async function loadUserData() {
    if (!STATE.currentUser) {
        STATE.userData = null;
        return null;
    }

    const response = await safeCall(deps.firestore.getUserData, "getUserData", STATE.currentUser.uid);
    STATE.userData = response && response.success && response.exists ? response.data : null;
    return STATE.userData;
}

/* ==========================================
   WORKSPACES
========================================== */

async function loadWorkspaces() {
    if (!STATE.currentUser) {
        STATE.workspaces = [];
        STATE.currentWorkspace = null;
        return STATE.workspaces;
    }

    const workspacesResponse = await safeCall(
        deps.firestore.getUserWorkspaces,
        "getUserWorkspaces",
        STATE.currentUser.uid
    );
    STATE.workspaces =
        workspacesResponse && workspacesResponse.success && Array.isArray(workspacesResponse.data)
            ? workspacesResponse.data
            : [];

    const savedWorkspaceId = await safeCall(deps.firestore.getCurrentWorkspaceId, "getCurrentWorkspaceId");

    STATE.currentWorkspace =
        STATE.workspaces.find((ws) => ws.id === savedWorkspaceId) || STATE.workspaces[0] || null;

    return STATE.workspaces;
}

/* ==========================================
   HEADER WORKSPACE SWITCHER
========================================== */

function attachWorkspaceSwitcher(header) {
    const trigger = qs("[data-workspace-switcher-trigger]", header || document);
    const menu = qs("[data-workspace-switcher-menu]", header || document);

    if (trigger && menu && trigger.dataset.bound !== "true") {
        trigger.addEventListener("click", (event) => {
            event.stopPropagation();
            const isOpen = menu.classList.toggle("open");
            trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
        });
        trigger.dataset.bound = "true";

        addDocumentListenerOnce("workspace-switcher-outside-click", "click", (event) => {
            const currentMenu = qs("[data-workspace-switcher-menu]");
            const currentTrigger = qs("[data-workspace-switcher-trigger]");
            if (
                currentMenu &&
                !currentMenu.contains(event.target) &&
                !currentTrigger?.contains(event.target)
            ) {
                currentMenu.classList.remove("open");
                currentTrigger?.setAttribute("aria-expanded", "false");
            }
        });

        addDocumentListenerOnce("workspace-switcher-escape", "keydown", (event) => {
            if (event.key === "Escape") {
                const currentMenu = qs("[data-workspace-switcher-menu]");
                const currentTrigger = qs("[data-workspace-switcher-trigger]");
                if (currentMenu) {
                    currentMenu.classList.remove("open");
                    currentTrigger?.setAttribute("aria-expanded", "false");
                }
            }
        });
    }

    populateWorkspaceSwitcherMenu(header);
}

function populateWorkspaceSwitcherMenu(header) {
    const scope = header || document;
    const nameLabel = qs("[data-workspace-switcher-name]", scope);
    const list = qs("[data-workspace-switcher-list]", scope);

    if (nameLabel) {
        nameLabel.textContent =
            STATE.currentWorkspace?.workspaceName || STATE.currentWorkspace?.name || "Workspace";
    }

    if (!list) return;

    list.innerHTML = "";

    if (!STATE.workspaces || STATE.workspaces.length === 0) {
        const empty = document.createElement("p");
        empty.className = "menu-empty";
        empty.textContent = "No workspaces available";
        list.appendChild(empty);
        return;
    }

    STATE.workspaces.forEach((workspace) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "workspace-switcher-item";
        item.dataset.workspaceId = workspace.id;
        item.textContent = workspace.workspaceName || workspace.name || "Untitled Workspace";
        if (STATE.currentWorkspace?.id === workspace.id) {
            item.classList.add("active");
        }
        list.appendChild(item);
    });

    if (list.dataset.delegateBound !== "true") {
        list.addEventListener("click", handleWorkspaceSwitcherSelect);
        list.dataset.delegateBound = "true";
    }
}

async function handleWorkspaceSwitcherSelect(event) {
    const item = event.target.closest("[data-workspace-id]");
    if (!item) return;

    const selectedId = item.dataset.workspaceId;
    const selectedWorkspace = STATE.workspaces.find((ws) => ws.id === selectedId) || null;
    STATE.currentWorkspace = selectedWorkspace;

    await safeCall(deps.firestore.setCurrentWorkspaceId, "setCurrentWorkspaceId", selectedId);

    const menu = qs("[data-workspace-switcher-menu]");
    const trigger = qs("[data-workspace-switcher-trigger]");
    if (menu) {
        menu.classList.remove("open");
        trigger?.setAttribute("aria-expanded", "false");
    }

    populateWorkspaceSwitcherMenu(qs(CONFIG.MOUNTS.HEADER));

    document.dispatchEvent(
        new CustomEvent("novaeditor:workspace-changed", { detail: selectedWorkspace })
    );

    loadProjectWorkspaceOptions();
}

/* ==========================================
   PROJECT MODAL
========================================== */

async function initProjectModal() {
    try {
        const mount = await loadPartial(CONFIG.PARTIALS.PROJECT_MODAL, CONFIG.MOUNTS.PROJECT_MODAL);
        if (!mount) return;

        attachProjectModalEvents();
        attachProjectFormEnhancements();
    } catch (error) {
        console.error("[NovaLayout] initProjectModal error:", error);
    }
}

function getProjectModal() {
    return qs("#projectModal");
}

function openProjectModal() {
    const modal = getProjectModal();
    if (!modal) {
        notify("Project modal not found on this page.", "error");
        return;
    }

    loadProjectWorkspaceOptions();
    modal.hidden = false;

    requestAnimationFrame(() => {
        modal.classList.add("show");
        modal.classList.remove("hide");
    });

    document.body.style.overflow = "hidden";
    qs("#projectName", modal)?.focus();
}

function closeProjectModal() {
    const modal = getProjectModal();
    if (!modal) return;

    modal.classList.remove("show");
    modal.classList.add("hide");

    setTimeout(() => {
        modal.hidden = true;
        modal.classList.remove("hide");
    }, 200);

    document.body.style.overflow = "";
}

function attachProjectModalEvents() {
    const modal = getProjectModal();
    if (!modal) return;

    qs("#closeProjectModal", modal)?.addEventListener("click", closeProjectModal);
    qs("#cancelProjectBtn", modal)?.addEventListener("click", closeProjectModal);
    qs(".project-modal-overlay", modal)?.addEventListener("click", closeProjectModal);

    addDocumentListenerOnce("project-modal-escape", "keydown", (event) => {
        const currentModal = getProjectModal();
        if (event.key === "Escape" && currentModal?.classList.contains("show")) {
            closeProjectModal();
        }
    });
}

/* ==========================================
   PROJECT WORKSPACES
========================================== */

function buildWorkspaceOptions(select) {
    select.innerHTML = "";

    if (!STATE.workspaces || STATE.workspaces.length === 0) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No Workspace Available";
        select.appendChild(option);
        return;
    }

    STATE.workspaces.forEach((workspace) => {
        const option = document.createElement("option");
        option.value = workspace.id;
        option.textContent = workspace.workspaceName || workspace.name || "Untitled Workspace";
        option.selected = workspace.id === STATE.currentWorkspace?.id;
        select.appendChild(option);
    });
}

function loadProjectWorkspaceOptions() {
    const modal = getProjectModal();
    if (!modal) return;

    const select = qs("#projectWorkspace", modal);
    if (!select) return;

    buildWorkspaceOptions(select);
}

/* ==========================================
   PROJECT FORM ENHANCEMENTS
========================================== */

function attachProjectFormEnhancements() {
    const modal = getProjectModal();
    if (!modal) return;

    const form = qs("#projectForm", modal);
    if (!form) return;

    const language = qs("#projectLanguage", form);
    const framework = qs("#projectFramework", form);
    const template = qs("#projectTemplate", form);
    const projectName = qs("#projectName", form);
    const description = qs("#projectDescription", form);

    function syncFramework() {
        if (!language || !framework) return;

        switch (language.value) {
            case "html":
                framework.innerHTML = `
                    <option value="none">None</option>
                    <option value="bootstrap">Bootstrap</option>
                    <option value="tailwind">Tailwind CSS</option>
                `;
                break;

            case "react":
                framework.innerHTML = `
                    <option value="vite">React + Vite</option>
                    <option value="next">Next.js</option>
                `;
                break;

            case "vue":
                framework.innerHTML = `
                    <option value="vite">Vue + Vite</option>
                `;
                break;

            case "node":
                framework.innerHTML = `
                    <option value="express">Express</option>
                `;
                break;

            default:
                framework.innerHTML = `
                    <option value="none">None</option>
                `;
        }
    }

    if (language && language.dataset.bound !== "true") {
        language.addEventListener("change", syncFramework);
        language.dataset.bound = "true";
    }
    syncFramework();

    if (projectName && projectName.dataset.bound !== "true") {
        projectName.addEventListener("input", () => {
            projectName.value = projectName.value.replace(/\s+/g, " ").trimStart();
        });
        projectName.dataset.bound = "true";
    }

    if (description && description.dataset.bound !== "true") {
        description.addEventListener("input", () => {
            if (description.value.length > 200) {
                description.value = description.value.slice(0, 200);
            }
        });
        description.dataset.bound = "true";
    }

    if (template && template.dataset.bound !== "true") {
        template.addEventListener("change", () => {
            if (template.value === "portfolio" && language?.value === "html") {
                framework.value = "bootstrap";
            }
        });
        template.dataset.bound = "true";
    }

    if (form.dataset.submitBound !== "true") {
        form.addEventListener("submit", handleProjectFormSubmit);
        form.dataset.submitBound = "true";
    }
}

/* ==========================================
   PROJECT HELPERS
========================================== */

function getProjectPayload(form) {
    return {
        name: qs("#projectName", form)?.value.trim() || "",
        description: qs("#projectDescription", form)?.value.trim() || "",
        language: qs("#projectLanguage", form)?.value || "html",
        framework: qs("#projectFramework", form)?.value || "none",
        template: qs("#projectTemplate", form)?.value || "blank",
        workspaceId:
            qs("#projectWorkspace", form)?.value ||
            STATE.currentWorkspace?.id ||
            STATE.userData?.currentWorkspaceId ||
            "",
        ownerUid: STATE.currentUser?.uid,
        visibility: form.querySelector('input[name="visibility"]:checked')?.value || "private",
        createReadme: qs("#createReadme", form)?.checked ?? true,
        initializeGit: qs("#initializeGit", form)?.checked ?? true,
        createDefaultFiles: qs("#createDefaultFiles", form)?.checked ?? true,
    };
}

function validateProject(project) {
    if (!project.name) {
        notify("Project name is required.", "warning");
        return false;
    }
    if (project.name.length < 3) {
        notify("Project name must be at least 3 characters.", "warning");
        return false;
    }
    if (project.name.length > 50) {
        notify("Project name cannot exceed 50 characters.", "warning");
        return false;
    }
    return true;
}

function resetProjectForm() {
    const modal = getProjectModal();
    if (!modal) return;

    const form = qs("#projectForm", modal);
    if (!form) return;

    form.reset();
    loadProjectWorkspaceOptions();
}

/* ==========================================
   PROJECT FORM SUBMIT
========================================== */

async function handleProjectFormSubmit(event) {
    event.preventDefault();

    if (!STATE.currentUser) {
        notify("You must be signed in to create a project.", "error");
        return;
    }

    if (typeof deps.firestore.createProject !== "function") {
        console.error('[NovaLayout] "createProject" is not exported by firestore.js.');
        notify("Project creation is currently unavailable.", "error");
        return;
    }

    const form = event.currentTarget;
    const payload = getProjectPayload(form);

    if (!validateProject(payload)) return;

    const createButton = qs("#createProjectBtn", form);
    createButton?.classList.add("loading");
    createButton?.setAttribute("disabled", "true");

    try {
        notify("Creating project...", "loading");

        const response = await safeCall(deps.firestore.createProject, "createProject", payload);

        if (!response || !response.success) {
            notify(response?.error || "Unable to create project.", "error");
            return;
        }

        notify("Project created successfully.", "success");
        closeProjectModal();
        resetProjectForm();

        document.dispatchEvent(
            new CustomEvent("novaeditor:project-created", { detail: response.data })
        );

        window.location.href = `${CONFIG.ROUTES.EDITOR}?project=${encodeURIComponent(response.data.id)}`;
    } finally {
        createButton?.classList.remove("loading");
        createButton?.removeAttribute("disabled");
    }
}

/* ==========================================
   GLOBAL LISTENERS
========================================== */

function attachGlobalListenersOnce() {
    addDocumentListenerOnce("global-new-project-delegate", "click", (event) => {
        const trigger = event.target.closest("[data-new-project]");
        if (!trigger) return;
        event.preventDefault();
        event.stopPropagation();
        openProjectModal();
    });
}

/* ==========================================
   INITIALIZATION
========================================== */

async function init() {
    if (STATE.initialized) return getState();
    STATE.initialized = true;

    await loadDependencies();

    try {
        await resolveInitialAuthState();
        await loadUserData();
    } catch (error) {
        console.error("[NovaLayout] Resolving auth state failed during init:", error);
    }

    if (!STATE.currentUser) {
        document.dispatchEvent(new CustomEvent("novaeditor:unauthenticated"));
    }

    try {
        await loadWorkspaces();
    } catch (error) {
        console.error("[NovaLayout] loadWorkspaces failed during init:", error);
    }

    await Promise.allSettled([initSidebar(), initHeader(), initProjectModal()]);

    try {
        attachUserDropdown(document);
    } catch (error) {
        console.error("[NovaLayout] attachUserDropdown failed during init:", error);
    }

    attachGlobalListenersOnce();

    STATE.ready = true;
    document.dispatchEvent(new CustomEvent("novaeditor:layout-ready", { detail: getState() }));

    return getState();
}

async function refresh() {
    try {
        await loadUserData();
        await loadWorkspaces();

        populateSidebarUser();
        populateWorkspaceSwitcherMenu(qs(CONFIG.MOUNTS.HEADER));
        await refreshNotificationBadge();
        loadProjectWorkspaceOptions();
    } catch (error) {
        console.error("[NovaLayout] refresh error:", error);
    }

    return getState();
}

function getState() {
    return {
        currentUser: STATE.currentUser,
        userData: STATE.userData,
        workspaces: STATE.workspaces,
        currentWorkspace: STATE.currentWorkspace,
        theme: STATE.theme,
    };
}

function isReady() {
    return STATE.ready;
}

/* ==========================================
   BOOTSTRAP
========================================== */

document.addEventListener("DOMContentLoaded", () => {
    init().catch((error) => {
        console.error("[NovaLayout] Unhandled error during init():", error);
    });
});

/* ==========================================
   PUBLIC API
========================================== */

window.NovaLayout = {
    init,
    refresh,
    getState,
    isReady,
};

export { init, refresh, getState, isReady };