/* ==========================================
   NOVA EDITOR — PROFILE.JS
========================================== */
import { showToast } from "../components/toast.js";

/* ==========================================
   CONFIG
========================================== */
const MODULE_URL = new URL(".", import.meta.url);
const PROJECT_ROOT = new URL("../", MODULE_URL);
const CONFIG = {
    DEFAULT_AVATAR: new URL("assets/images/avatar/default.png", PROJECT_ROOT).href,
    THEME_STORAGE_KEY: "novaeditor:theme",
    LANGUAGE_LABELS: {
        javascript: "JavaScript",
        typescript: "TypeScript",
        python: "Python",
        html: "HTML",
        css: "CSS",
    },
    THEME_LABELS: {
        system: "System",
        light: "Light",
        dark: "Dark",
    },
    DEFAULTS: {
        theme: "system",
        defaultLanguage: "javascript",
        fontSize: 14,
        tabSize: "2",
    },
};

/* ==========================================
   STATE
========================================== */
const STATE = {
    currentUser: null,
    userData: null,
    currentWorkspace: null,
    editorPrefs: null,
    ready: false,
};

/* ==========================================
   DEPENDENCIES (Firebase — same modules
   layout.js already relies on)
========================================== */
const deps = {
    auth: {},
    firestore: {},
};
async function loadDependencies() {
    try {
        deps.auth = await import("../firebase/auth.js");
    } catch (error) {
        console.error("[NovaProfile] Failed to load firebase/auth.js:", error);
        deps.auth = {};
    }
    try {
        deps.firestore = await import("../firebase/firestore.js");
    } catch (error) {
        console.error("[NovaProfile] Failed to load firebase/firestore.js:", error);
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
        console.warn(`[NovaProfile] showToast unavailable — ${type}: ${message}`);
    }
}
async function safeCall(fn, fnName, ...args) {
    if (typeof fn !== "function") {
        console.error(`[NovaProfile] "${fnName}" is not exported by the expected module.`);
        return undefined;
    }
    try {
        return await fn(...args);
    } catch (error) {
        console.error(`[NovaProfile] "${fnName}" threw an error:`, error);
        return undefined;
    }
}
function qs(selector, scope = document) {
    return scope.querySelector(selector);
}
function setText(selector, value, fallback = "—") {
    const el = qs(selector);
    if (el) el.textContent = value || fallback;
}

/* ==========================================
   FORMATTERS
========================================== */
function toDateSafe(raw) {
    if (!raw) return null;
    if (typeof raw.toDate === "function") return raw.toDate();
    if (typeof raw.seconds === "number") return new Date(raw.seconds * 1000);
    const parsed = new Date(raw);
    return isNaN(parsed.getTime()) ? null : parsed;
}
function formatMemberSince() {
    const date =
        toDateSafe(STATE.userData?.createdAt) ||
        toDateSafe(STATE.currentUser?.metadata?.creationTime);
    if (!date) return "Member since —";
    const formatted = date.toLocaleDateString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
    });
    return `Member since ${formatted}`;
}
function languageLabel(value) {
    if (!value) return "—";
    return CONFIG.LANGUAGE_LABELS[value] || value;
}
function themeLabel(value) {
    if (!value) return "System";
    return CONFIG.THEME_LABELS[value] || value;
}

/* ==========================================
   POPULATE — SUMMARY
========================================== */
function populateSummary() {
    const user = STATE.currentUser;
    const data = STATE.userData;

    const displayName = data?.displayName || user?.displayName || "User";
    const username = data?.username ? `@${data.username}` : "@—";
    const email = data?.email || user?.email || "—";
    const photoURL = data?.photoURL || user?.photoURL || CONFIG.DEFAULT_AVATAR;

    setText("#profileName", displayName, "User");
    setText("#profileUsername", username, "@—");
    setText("#profileEmail", email);
    setText("#profileMemberSince", formatMemberSince(), "Member since —");

    const avatar = qs("#profileAvatar");
    if (avatar) {
        avatar.src = photoURL;
        avatar.onerror = () => {
            avatar.onerror = null;
            avatar.src = CONFIG.DEFAULT_AVATAR;
        };
    }

    const workspaceName =
        STATE.currentWorkspace?.workspaceName || STATE.currentWorkspace?.name || "—";
    setText("#profileWorkspaceValue", workspaceName);
    setText("#profileRoleValue", data?.role || "—");
}

/* ==========================================
   POPULATE — PERSONAL INFORMATION
========================================== */
function populatePersonalInfo() {
    const user = STATE.currentUser;
    const data = STATE.userData;

    setText("#infoFullName", data?.displayName || user?.displayName || "—");
    setText("#infoEmail", data?.email || user?.email || "—");
    setText("#infoUsername", data?.username ? `@${data.username}` : "—");
    setText("#infoLocation", data?.location || "—");
    setText("#infoRole", data?.role || "—");
}

/* ==========================================
   POPULATE — WORKSPACE INFORMATION
========================================== */
function populateWorkspaceInfo() {
    const workspace = STATE.currentWorkspace;

    setText("#infoWorkspaceName", workspace?.workspaceName || workspace?.name || "—");
    setText("#infoDefaultProject", workspace?.defaultProject || "—");
    setText("#infoExperience", workspace?.experience || "—");
}

/* ==========================================
   POPULATE — EDITOR PREFERENCES
========================================== */
function populateEditorPreferences() {
    const prefs = STATE.editorPrefs || {};

    setText("#prefTheme", themeLabel(prefs.theme), "System");
    setText("#prefLanguage", languageLabel(prefs.defaultLanguage), "JavaScript");

    const fontSize = prefs.fontSize ?? CONFIG.DEFAULTS.fontSize;
    setText("#prefFontSize", `${fontSize} px`, "14 px");

    const tabSize = prefs.tabSize ?? CONFIG.DEFAULTS.tabSize;
    setText("#prefTabSize", `${tabSize} Spaces`, "2 Spaces");
}

/* ==========================================
   DATA LOADING
========================================== */
async function loadEditorPreferences() {
    if (!STATE.currentUser) {
        STATE.editorPrefs = null;
        return;
    }
    const response = await safeCall(
        deps.firestore.getEditorPreferences,
        "getEditorPreferences",
        STATE.currentUser.uid
    );
    STATE.editorPrefs = response && response.success && response.exists ? response.data : null;
}

function syncFromLayoutState() {
    const layoutState =
        typeof window.NovaLayout?.getState === "function" ? window.NovaLayout.getState() : null;
    if (!layoutState) return;
    STATE.currentUser = layoutState.currentUser || null;
    STATE.userData = layoutState.userData || null;
    STATE.currentWorkspace = layoutState.currentWorkspace || null;
}

async function loadProfileData() {
    syncFromLayoutState();
    await loadEditorPreferences();
    populateSummary();
    populatePersonalInfo();
    populateWorkspaceInfo();
    populateEditorPreferences();
    STATE.ready = true;
}

/* ==========================================
   GENERIC MODAL HELPERS
========================================== */
let modalCloseTimer = null;
function openModal(modal, focusEl) {
    if (!modal) return;
    if (modalCloseTimer) {
        clearTimeout(modalCloseTimer);
        modalCloseTimer = null;
    }
    modal.hidden = false;
    document.body.classList.add("nova-modal-open");
    requestAnimationFrame(() => {
        modal.classList.add("show");
    });
    setTimeout(() => {
        (focusEl || qs("input, select", modal))?.focus();
    }, 60);
}
function closeModal(modal) {
    if (!modal) return;
    modal.classList.remove("show");
    if (modalCloseTimer) clearTimeout(modalCloseTimer);
    modalCloseTimer = setTimeout(() => {
        modal.hidden = true;
        modalCloseTimer = null;
    }, 200);
    document.body.classList.remove("nova-modal-open");
}
function attachModalDismiss(modal) {
    if (!modal || modal.dataset.dismissBound === "true") return;
    modal.querySelectorAll("[data-modal-close]").forEach((el) => {
        el.addEventListener("click", () => closeModal(modal));
    });
    const backdrop = qs(".nova-modal-backdrop", modal);
    if (backdrop) backdrop.addEventListener("click", () => closeModal(modal));
    modal.dataset.dismissBound = "true";
}
document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".nova-modal.show").forEach((modal) => closeModal(modal));
});

/* ==========================================
   EDIT PROFILE MODAL
========================================== */
function fillEditProfileForm() {
    const user = STATE.currentUser;
    const data = STATE.userData;

    const fullNameInput = qs("#editFullName");
    const emailInput = qs("#editEmailReadonly");
    const usernameInput = qs("#editUsername");
    const locationInput = qs("#editLocation");
    const roleSelect = qs("#editRole");
    const photoInput = qs("#editPhotoURL");

    if (fullNameInput) fullNameInput.value = data?.displayName || user?.displayName || "";
    if (emailInput) emailInput.value = data?.email || user?.email || "";
    if (usernameInput) usernameInput.value = data?.username || "";
    if (locationInput) locationInput.value = data?.location || "";
    if (roleSelect) roleSelect.value = data?.role || "Developer";
    if (photoInput) photoInput.value = data?.photoURL || "";
}
function openEditProfileModal(focusSelector) {
    const modal = qs("#editProfileModal");
    if (!modal) return;
    fillEditProfileForm();
    openModal(modal, focusSelector ? qs(focusSelector, modal) : null);
}
async function handleEditProfileSubmit(event) {
    event.preventDefault();
    if (!STATE.currentUser) {
        notify("You must be signed in to update your profile.", "error");
        return;
    }
    if (typeof deps.firestore.updateUser !== "function") {
        notify("Profile updates are currently unavailable.", "error");
        return;
    }

    const form = event.currentTarget;
    const fullName = qs("#editFullName", form)?.value.trim() || "";
    const usernameRaw = qs("#editUsername", form)?.value.trim().toLowerCase() || "";
    const location = qs("#editLocation", form)?.value.trim() || "";
    const role = qs("#editRole", form)?.value || "";
    const photoURL = qs("#editPhotoURL", form)?.value.trim() || "";

    if (!fullName) {
        notify("Full name is required.", "warning");
        return;
    }

    const saveButton = qs("#saveProfileBtn", form);
    saveButton?.setAttribute("disabled", "true");

    try {
        const currentUsername = (STATE.userData?.username || "").toLowerCase();

        if (usernameRaw && usernameRaw !== currentUsername) {
            const availability = await safeCall(
                deps.firestore.isUsernameAvailable,
                "isUsernameAvailable",
                usernameRaw
            );
            if (!availability?.success) {
                notify("Unable to verify username availability.", "error");
                return;
            }
            if (!availability.data?.available) {
                notify("That username is already taken.", "warning");
                qs("#editUsername", form)?.focus();
                return;
            }
        }

        const payload = {
            displayName: fullName,
            location,
            role,
            photoURL,
        };
        if (usernameRaw) {
            payload.username = usernameRaw;
        }

        const response = await deps.firestore.updateUser(STATE.currentUser.uid, payload);
        if (!response || !response.success) {
            notify(response?.error || "Unable to update profile.", "error");
            return;
        }

        notify("Profile updated successfully.", "success");
        closeModal(qs("#editProfileModal"));

        await safeCall(window.NovaLayout?.refresh, "NovaLayout.refresh");
        await loadProfileData();
    } catch (error) {
        console.error("[NovaProfile] handleEditProfileSubmit error:", error);
        notify("Something went wrong while updating your profile.", "error");
    } finally {
        saveButton?.removeAttribute("disabled");
    }
}

/* ==========================================
   EDITOR PREFERENCES MODAL
========================================== */
function fillEditPreferencesForm() {
    const prefs = STATE.editorPrefs || {};
    const themeSelect = qs("#editTheme");
    const languageSelect = qs("#editLanguage");
    const fontSizeInput = qs("#editFontSize");
    const tabSizeSelect = qs("#editTabSize");

    if (themeSelect) themeSelect.value = prefs.theme || CONFIG.DEFAULTS.theme;
    if (languageSelect) languageSelect.value = prefs.defaultLanguage || CONFIG.DEFAULTS.defaultLanguage;
    if (fontSizeInput) fontSizeInput.value = prefs.fontSize ?? CONFIG.DEFAULTS.fontSize;
    if (tabSizeSelect) tabSizeSelect.value = String(prefs.tabSize ?? CONFIG.DEFAULTS.tabSize);
}
function openEditPreferencesModal(focusSelector) {
    const modal = qs("#editPreferencesModal");
    if (!modal) return;
    fillEditPreferencesForm();
    openModal(modal, focusSelector ? qs(focusSelector, modal) : null);
}
function applyThemePreference(theme) {
    try {
        if (theme && theme !== "system") {
            localStorage.setItem(CONFIG.THEME_STORAGE_KEY, theme);
            document.documentElement.setAttribute("data-theme", theme);
        } else {
            localStorage.removeItem(CONFIG.THEME_STORAGE_KEY);
        }
    } catch (error) {
        console.error("[NovaProfile] applyThemePreference failed:", error);
    }
}
async function handleEditPreferencesSubmit(event) {
    event.preventDefault();
    if (!STATE.currentUser) {
        notify("You must be signed in to update preferences.", "error");
        return;
    }
    if (typeof deps.firestore.saveEditorPreferences !== "function") {
        notify("Editor preferences are currently unavailable.", "error");
        return;
    }

    const form = event.currentTarget;
    const theme = qs("#editTheme", form)?.value || CONFIG.DEFAULTS.theme;
    const defaultLanguage = qs("#editLanguage", form)?.value || CONFIG.DEFAULTS.defaultLanguage;
    const fontSizeRaw = Number(qs("#editFontSize", form)?.value);
    const fontSize = Number.isFinite(fontSizeRaw) && fontSizeRaw > 0 ? fontSizeRaw : CONFIG.DEFAULTS.fontSize;
    const tabSize = qs("#editTabSize", form)?.value || CONFIG.DEFAULTS.tabSize;

    const saveButton = qs("#savePreferencesBtn", form);
    saveButton?.setAttribute("disabled", "true");

    try {
        const response = await deps.firestore.saveEditorPreferences(STATE.currentUser.uid, {
            theme,
            defaultLanguage,
            fontSize,
            tabSize,
        });
        if (!response || !response.success) {
            notify(response?.error || "Unable to save preferences.", "error");
            return;
        }

        applyThemePreference(theme);
        notify("Editor preferences saved.", "success");
        closeModal(qs("#editPreferencesModal"));
        await loadProfileData();
    } catch (error) {
        console.error("[NovaProfile] handleEditPreferencesSubmit error:", error);
        notify("Something went wrong while saving preferences.", "error");
    } finally {
        saveButton?.removeAttribute("disabled");
    }
}

/* ==========================================
   INTERACTIONS
========================================== */
function attachInteractions() {
    qs("#editProfileBtn")?.addEventListener("click", () => openEditProfileModal());
    qs("#avatarEditBadge")?.addEventListener("click", () => openEditProfileModal("#editPhotoURL"));

    qs("#infoRowFullName")?.addEventListener("click", () => openEditProfileModal("#editFullName"));
    qs("#infoRowUsername")?.addEventListener("click", () => openEditProfileModal("#editUsername"));
    qs("#infoRowLocation")?.addEventListener("click", () => openEditProfileModal("#editLocation"));
    qs("#infoRowRole")?.addEventListener("click", () => openEditProfileModal("#editRole"));

    qs("#prefRowTheme")?.addEventListener("click", () => openEditPreferencesModal("#editTheme"));
    qs("#prefRowLanguage")?.addEventListener("click", () => openEditPreferencesModal("#editLanguage"));
    qs("#prefRowFontSize")?.addEventListener("click", () => openEditPreferencesModal("#editFontSize"));
    qs("#prefRowTabSize")?.addEventListener("click", () => openEditPreferencesModal("#editTabSize"));

    qs("#roleMiniCard")?.addEventListener("click", () => openEditProfileModal("#editRole"));
    qs("#workspaceMiniCard")?.addEventListener("click", () => {
        const trigger = qs("[data-workspace-switcher-trigger]");
        if (trigger) {
            trigger.click();
        } else {
            window.location.href = "settings.html";
        }
    });

    const editProfileModal = qs("#editProfileModal");
    const editPreferencesModal = qs("#editPreferencesModal");
    attachModalDismiss(editProfileModal);
    attachModalDismiss(editPreferencesModal);

    qs("#editProfileForm")?.addEventListener("submit", handleEditProfileSubmit);
    qs("#editPreferencesForm")?.addEventListener("submit", handleEditPreferencesSubmit);
}

/* ==========================================
   INITIALIZATION
========================================== */
async function init() {
    attachInteractions();
    await loadDependencies();

    const layoutState =
        typeof window.NovaLayout?.getState === "function" ? window.NovaLayout.getState() : null;

    if (window.NovaLayout?.isReady?.() && layoutState?.currentUser) {
        await loadProfileData();
    } else {
        document.addEventListener(
            "novaeditor:layout-ready",
            async () => {
                await loadProfileData();
            },
            { once: true }
        );
    }

    document.addEventListener("novaeditor:workspace-changed", () => {
        loadProfileData();
    });

    document.addEventListener("novaeditor:unauthenticated", () => {
        STATE.currentUser = null;
        STATE.userData = null;
        STATE.currentWorkspace = null;
        STATE.editorPrefs = null;
    });
}

document.addEventListener("DOMContentLoaded", () => {
    init().catch((error) => {
        console.error("[NovaProfile] Unhandled error during init():", error);
    });
});