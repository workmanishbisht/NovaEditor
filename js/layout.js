"use strict";

/* ==========================================
   IMPORTS
========================================== */

import {
    checkSession,
    logout,
} from "../firebase/auth.js";

import {
    getUser,
    getUserWorkspaces,
    updateUser,
    createProject,
} from "../firebase/firestore.js";

/* ==========================================
   CONFIG
========================================== */

const CONFIG = Object.freeze({
    ROUTES: Object.freeze({
        LOGIN: "../pages/login.html",
        SETUP: "../pages/setup.html",
        DASHBOARD: "../pages/dashboard.html",
        EDITOR: "../pages/editor.html",
    }),
    COMPONENTS: Object.freeze({
        SIDEBAR: "../components/sidebar.html",
        HEADER: "../components/header.html",
    }),
    THEME_STORAGE_KEY: "novaeditor-theme",
});

/* ==========================================
   STATE
========================================== */

const STATE = {
    currentUser: null,
    userData: null,
    workspaces: [],
    currentWorkspace: null,
    ready: false,
};

/* ==========================================
   HELPERS
========================================== */

function showToast(message, type = "info") {
    if (typeof window.showToast === "function") {
        window.showToast(message, type);
    }
}

function qs(selector, scope = document) {
    return scope.querySelector(selector);
}

function qsa(selector, scope = document) {
    return Array.from(scope.querySelectorAll(selector));
}

/* ==========================================
   COMPONENT LOADING
========================================== */

async function loadComponent(url, mountSelector) {
    const mount = qs(mountSelector);

    if (!mount) return null;

    try {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Failed to load ${url} (${response.status})`);
        }

        mount.innerHTML = await response.text();

        return mount;
    } catch (error) {
        console.error(error);
        mount.innerHTML = "";
        return null;
    }
}

async function loadLayoutComponents() {
    await Promise.all([
        loadComponent(CONFIG.COMPONENTS.SIDEBAR, "#sidebarMount"),
        loadComponent(CONFIG.COMPONENTS.HEADER, "#headerMount"),
    ]);
}

/* ==========================================
   ACTIVE NAV HIGHLIGHT
========================================== */

function highlightActiveNav() {
    const page = document.body.dataset.page;

    if (!page) return;

    qsa(".nav-item[data-nav]").forEach((item) => {
        item.classList.toggle("active", item.dataset.nav === page);
    });
}

/* ==========================================
   PROFILE (Sidebar only — single profile area)
========================================== */

function renderProfile() {
    const authUser = STATE.currentUser;
    const dbUser = STATE.userData || {};

    const name = dbUser.displayName || authUser?.displayName || "there";
    const username = dbUser.username ? `@${dbUser.username}` : "@no-username";
    const photo = dbUser.photoURL || authUser?.photoURL || "../assets/images/avatar/default.png";

    const sidebarName = qs("#sidebarUserName");
    const sidebarUsername = qs("#sidebarUserUsername");
    const sidebarAvatar = qs("#sidebarUserAvatar");

    if (sidebarName) sidebarName.textContent = name;
    if (sidebarUsername) sidebarUsername.textContent = username;

    if (sidebarAvatar) {
        sidebarAvatar.src = photo;
        sidebarAvatar.onerror = () => {
            sidebarAvatar.src = "../assets/images/avatar/default.png";
        };
    }
}

/* ==========================================
   WORKSPACE SWITCHER
========================================== */

async function loadWorkspaces() {
    if (!STATE.currentUser) return;

    const response = await getUserWorkspaces(STATE.currentUser.uid);

    const list = qs("#workspaceSwitcherList");
    const nameLabel = qs("#workspaceSwitcherName");

    if (!response.success || !response.data || response.data.length === 0) {
        STATE.workspaces = [];

        if (list) {
            list.innerHTML = `<p class="menu-empty">No workspaces yet.</p>`;
        }

        if (nameLabel) nameLabel.textContent = "Workspace";

        return;
    }

    STATE.workspaces = response.data;

    const currentId = STATE.userData?.currentWorkspaceId;

    STATE.currentWorkspace =
        STATE.workspaces.find((workspace) => workspace.id === currentId) ||
        STATE.workspaces[0];

    if (nameLabel) {
        nameLabel.textContent = STATE.currentWorkspace?.workspaceName || "Workspace";
    }

    if (list) {
        list.innerHTML = STATE.workspaces
            .map((workspace) => {
                const active = workspace.id === STATE.currentWorkspace?.id;

                return `
          <button
            type="button"
            class="workspace-switcher-item${active ? " active" : ""}"
            data-workspace-id="${workspace.id}"
          >
            <i class="ri-stack-line"></i>
            <span>${workspace.workspaceName}</span>
          </button>
        `;
            })
            .join("");

        qsa("[data-workspace-id]", list).forEach((button) => {
            button.addEventListener("click", () => switchWorkspace(button.dataset.workspaceId));
        });
    }
}

async function switchWorkspace(workspaceId) {
    if (!STATE.currentUser || workspaceId === STATE.currentWorkspace?.id) {
        closeAllMenus();
        return;
    }

    const response = await updateUser(STATE.currentUser.uid, {
        currentWorkspaceId: workspaceId,
    });

    if (!response.success) {
        showToast(response.error || "Unable to switch workspace.", "error");
        return;
    }

    STATE.userData = { ...STATE.userData, currentWorkspaceId: workspaceId };

    showToast("Workspace switched.", "success");

    closeAllMenus();

    await loadWorkspaces();
}

/* ==========================================
   DROPDOWNS
   Generic open/close-on-outside-click handling
   for every trigger/menu pair in the layout.
========================================== */

const DROPDOWNS = [
    { trigger: "#sidebarUserTrigger", menu: "#sidebarUserMenu" },
    { trigger: "#notificationBtn", menu: "#notificationMenu" },
    { trigger: "#workspaceSwitcherTrigger", menu: "#workspaceSwitcherMenu" },
];

function closeAllMenus() {
    DROPDOWNS.forEach(({ trigger, menu }) => {
        const menuEl = qs(menu);
        const triggerEl = qs(trigger);

        if (menuEl) menuEl.classList.remove("open");
        if (triggerEl) triggerEl.setAttribute("aria-expanded", "false");
    });
}

function attachDropdowns() {
    DROPDOWNS.forEach(({ trigger, menu }) => {
        const triggerEl = qs(trigger);
        const menuEl = qs(menu);

        if (!triggerEl || !menuEl) return;

        triggerEl.addEventListener("click", (event) => {
            event.stopPropagation();

            const isOpen = menuEl.classList.contains("open");

            closeAllMenus();

            if (!isOpen) {
                menuEl.classList.add("open");
                triggerEl.setAttribute("aria-expanded", "true");
            }
        });
    });

    document.addEventListener("click", closeAllMenus);

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeAllMenus();
    });
}

/* ==========================================
   LOGOUT
   Sidebar is the only profile area, so it's
   the only place logout can be triggered from.
========================================== */

function attachLogout() {
    const button = qs("#sidebarLogoutBtn");

    if (!button) return;

    button.addEventListener("click", async () => {
        const response = await logout();

        if (!response.success) {
            showToast(response.error || "Unable to log out.", "error");
            return;
        }

        window.location.href = CONFIG.ROUTES.LOGIN;
    });
}

/* ==========================================
   THEME
========================================== */

function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);

    const icon = qs("#themeToggleIcon");

    if (icon) {
        icon.className = theme === "dark" ? "ri-moon-line" : "ri-sun-line";
    }
}

function initTheme() {
    const saved = localStorage.getItem(CONFIG.THEME_STORAGE_KEY);
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

    applyTheme(saved || (prefersDark ? "dark" : "light"));
}

function attachThemeToggle() {
    const button = qs("#themeToggleBtn");

    if (!button) return;

    button.addEventListener("click", () => {
        const current = document.documentElement.getAttribute("data-theme") || "light";
        const next = current === "dark" ? "light" : "dark";

        applyTheme(next);
        localStorage.setItem(CONFIG.THEME_STORAGE_KEY, next);
    });
}

/* ==========================================
   RESPONSIVE SIDEBAR
========================================== */

function attachSidebarToggle() {
    const sidebar = qs("#appSidebar");
    const overlay = qs("#sidebarOverlay");
    const openBtn = qs("#sidebarToggleBtn");
    const closeBtn = qs("#sidebarCloseBtn");

    if (!sidebar) return;

    const open = () => {
        sidebar.classList.add("open");
        overlay?.classList.add("open");
        openBtn?.setAttribute("aria-expanded", "true");
    };

    const close = () => {
        sidebar.classList.remove("open");
        overlay?.classList.remove("open");
        openBtn?.setAttribute("aria-expanded", "false");
    };

    openBtn?.addEventListener("click", open);
    closeBtn?.addEventListener("click", close);
    overlay?.addEventListener("click", close);
}

/* ==========================================
   SEARCH SHORTCUT (Ctrl / Cmd + K)
========================================== */

function attachSearchShortcut() {
    const input = qs("#globalSearchInput");

    if (!input) return;

    document.addEventListener("keydown", (event) => {
        const isShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";

        if (isShortcut) {
            event.preventDefault();
            input.focus();
        }
    });
}

/* ==========================================
   NEW PROJECT (shared across header + pages)
   Any element with [data-new-project] triggers
   this flow, wherever it lives in the page.
========================================== */

function attachNewProjectHandlers() {
    qsa("[data-new-project]").forEach((button) => {
        button.addEventListener("click", handleNewProject);
    });

    qsa("[data-import-project]").forEach((button) => {
        button.addEventListener("click", () => {
            showToast("Importing projects is coming soon.", "info");
        });
    });
}

async function handleNewProject() {
    if (!STATE.currentUser) return;

    const name = window.prompt("Name your new project:", "Untitled Project");

    if (!name || !name.trim()) return;

    showToast("Creating project...", "loading");

    const response = await createProject({
        name: name.trim(),
        ownerUid: STATE.currentUser.uid,
        workspaceId: STATE.currentWorkspace?.id || STATE.userData?.currentWorkspaceId || "",
        language: "javascript",
    });

    if (!response.success) {
        showToast(response.error || "Unable to create project.", "error");
        return;
    }

    showToast("Project created.", "success");

    document.dispatchEvent(new CustomEvent("novaeditor:project-created", {
        detail: response.data,
    }));
}

/* ==========================================
   AUTH BOOTSTRAP
========================================== */

async function bootstrapUser() {
    const user = await checkSession();

    if (!user) {
        window.location.href = CONFIG.ROUTES.LOGIN;
        return false;
    }

    STATE.currentUser = user;

    const response = await getUser(user.uid);

    if (!response.success) {
        showToast(response.error || "Unable to load your profile.", "error");
        return false;
    }

    STATE.userData = response.data || {};

    if (!STATE.userData.setupCompleted) {
        window.location.href = CONFIG.ROUTES.SETUP;
        return false;
    }

    return true;
}

/* ==========================================
   INITIALIZATION
========================================== */

async function initLayout() {
    try {
        await loadLayoutComponents();

        highlightActiveNav();
        initTheme();

        attachDropdowns();
        attachLogout();
        attachThemeToggle();
        attachSidebarToggle();
        attachSearchShortcut();
        attachNewProjectHandlers();

        const ok = await bootstrapUser();

        if (!ok) return;

        renderProfile();
        await loadWorkspaces();

        STATE.ready = true;

        document.dispatchEvent(new CustomEvent("novaeditor:layout-ready", {
            detail: {
                user: STATE.currentUser,
                userData: STATE.userData,
                workspace: STATE.currentWorkspace,
            },
        }));

    } catch (error) {
        console.error(error);
        showToast("Something went wrong loading the app.", "error");
    }
}

/* ==========================================
   PUBLIC API
========================================== */

window.NovaLayout = {
    getState: () => STATE,
    isReady: () => STATE.ready,
};

/* ==========================================
   BOOTSTRAP
========================================== */

initLayout();