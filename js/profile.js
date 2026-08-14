/* ==========================================
   NOVA EDITOR — PROFILE.JS
   Reuses window.NovaLayout (from layout.js) for
   currentUser / userData / currentWorkspace so
   auth + Firestore wiring is not duplicated here.
========================================== */
import { showToast } from "../components/toast.js";

/* ==========================================
   CONFIG
========================================== */
const MODULE_URL = new URL(".", import.meta.url);
const PROJECT_ROOT = new URL("../", MODULE_URL);
const DEFAULT_AVATAR = new URL("assets/images/avatar/default.png", PROJECT_ROOT).href;
const MODAL_CLOSE_ANIMATION_MS = 200;

/* ==========================================
   DEPENDENCIES
========================================== */
let firestore = {};
async function loadFirestore() {
    try {
        firestore = await import("../firebase/firestore.js");
    } catch (error) {
        console.error("[Profile] Failed to load firebase/firestore.js:", error);
        firestore = {};
    }
}

/* ==========================================
   SAFE HELPERS
========================================== */
function notify(message, type = "info") {
    if (typeof showToast === "function") {
        showToast(message, type);
    } else {
        console.warn(`[Profile] showToast unavailable — ${type}: ${message}`);
    }
}
function qs(selector, scope = document) {
    return scope.querySelector(selector);
}
function setText(id, value, fallback = "—") {
    const el = document.getElementById(id);
    if (el) el.textContent = value || fallback;
}
function formatMemberSince(value) {
    if (!value) return "—";
    const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
}

/* ==========================================
   PAGE STATE
========================================== */
const PAGE_STATE = {
    currentUser: null,
    userData: null,
    currentWorkspace: null,
    preferences: null,
};

/* ==========================================
   RENDER
========================================== */
function renderSummary() {
    const { currentUser, userData, currentWorkspace } = PAGE_STATE;
    const displayName = userData?.displayName || currentUser?.displayName || "User";
    const avatarUrl = userData?.photoURL || currentUser?.photoURL || DEFAULT_AVATAR;

    const avatarEl = qs("#profileAvatar");
    if (avatarEl) avatarEl.src = avatarUrl;

    setText("profileName", displayName, "User");
    setText("profileUsername", userData?.username ? `@${userData.username}` : "@—");
    setText("profileEmail", currentUser?.email || userData?.email);

    const memberSinceEl = qs("#profileMemberSince");
    if (memberSinceEl) memberSinceEl.textContent = `Member since ${formatMemberSince(userData?.createdAt)}`;

    setText("profileWorkspaceValue", currentWorkspace?.workspaceName || currentWorkspace?.name);
    setText("profileRoleValue", userData?.role);
}
function renderPersonalInfo() {
    const { currentUser, userData } = PAGE_STATE;
    setText("infoFullName", userData?.displayName || currentUser?.displayName);
    setText("infoEmail", currentUser?.email || userData?.email);
    setText("infoUsername", userData?.username ? `@${userData.username}` : null);
    setText("infoLocation", userData?.location);
    setText("infoRole", userData?.role);
}
function renderWorkspaceInfo() {
    const { currentWorkspace } = PAGE_STATE;
    setText("infoWorkspaceName", currentWorkspace?.workspaceName || currentWorkspace?.name);
    setText("infoDefaultProject", currentWorkspace?.defaultProject);
    setText("infoExperience", currentWorkspace?.experience);
}
function renderPreferences() {
    const prefs = PAGE_STATE.preferences || {};
    setText("prefTheme", prefs.theme ? capitalize(prefs.theme) : "System");
    setText("prefLanguage", prefs.defaultLanguage ? capitalize(prefs.defaultLanguage) : "JavaScript");
    setText("prefFontSize", prefs.fontSize ? `${prefs.fontSize} px` : "14 px");
    setText("prefTabSize", prefs.tabSize ? `${prefs.tabSize} Spaces` : "2 Spaces");
}
function capitalize(value) {
    const str = String(value);
    return str.charAt(0).toUpperCase() + str.slice(1);
}
function renderAll() {
    renderSummary();
    renderPersonalInfo();
    renderWorkspaceInfo();
    renderPreferences();
}

/* ==========================================
   DATA LOADING
========================================== */
function syncFromLayoutState(state) {
    PAGE_STATE.currentUser = state?.currentUser || null;
    PAGE_STATE.userData = state?.userData || null;
    PAGE_STATE.currentWorkspace = state?.currentWorkspace || null;
}
async function loadPreferences() {
    if (!PAGE_STATE.currentUser || typeof firestore.getEditorPreferences !== "function") {
        PAGE_STATE.preferences = null;
        return;
    }
    const response = await firestore.getEditorPreferences(PAGE_STATE.currentUser.uid);
    PAGE_STATE.preferences = response && response.success && response.exists ? response.data : null;
}
async function refreshPage() {
    if (window.NovaLayout && typeof window.NovaLayout.getState === "function") {
        syncFromLayoutState(window.NovaLayout.getState());
    }
    try {
        await loadPreferences();
    } catch (error) {
        console.error("[Profile] loadPreferences failed:", error);
    }
    renderAll();
}

/* ==========================================
   MODAL HELPERS (shared show/hide)
========================================== */
const modalCloseTimers = new WeakMap();
function showModal(modal) {
    if (!modal) return;
    const pending = modalCloseTimers.get(modal);
    if (pending) {
        clearTimeout(pending);
        modalCloseTimers.delete(modal);
    }
    modal.hidden = false;
    requestAnimationFrame(() => {
        modal.classList.add("show");
        modal.classList.remove("hide");
    });
    document.body.classList.add("nova-modal-open");
}
function hideModal(modal) {
    if (!modal) return;
    modal.classList.remove("show");
    modal.classList.add("hide");
    const timer = setTimeout(() => {
        modal.hidden = true;
        modal.classList.remove("hide");
        modalCloseTimers.delete(modal);
    }, MODAL_CLOSE_ANIMATION_MS);
    modalCloseTimers.set(modal, timer);
    document.body.classList.remove("nova-modal-open");
}
function attachModalDismiss(modal, onClose) {
    if (!modal) return;
    qsa("[data-modal-close]", modal).forEach((btn) => {
        btn.addEventListener("click", onClose);
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && modal.classList.contains("show")) onClose();
    });
}
function qsa(selector, scope = document) {
    return Array.from(scope.querySelectorAll(selector));
}

/* ==========================================
   EDIT PROFILE MODAL
========================================== */
function getEditProfileModal() {
    return qs("#editProfileModal");
}
function openEditProfileModal() {
    const modal = getEditProfileModal();
    if (!modal) return;
    const { currentUser, userData } = PAGE_STATE;
    qs("#editFullName", modal).value = userData?.displayName || currentUser?.displayName || "";
    qs("#editEmailReadonly", modal).value = currentUser?.email || userData?.email || "";
    qs("#editUsername", modal).value = userData?.username || "";
    qs("#editLocation", modal).value = userData?.location || "";
    if (userData?.role) qs("#editRole", modal).value = userData.role;
    qs("#editPhotoURL", modal).value = userData?.photoURL || "";
    showModal(modal);
    qs("#editFullName", modal)?.focus();
}
function closeEditProfileModal() {
    hideModal(getEditProfileModal());
}
async function handleEditProfileSubmit(event) {
    event.preventDefault();
    if (!PAGE_STATE.currentUser) {
        notify("You must be signed in to update your profile.", "error");
        return;
    }
    if (typeof firestore.updateUser !== "function") {
        notify("Profile updates are currently unavailable.", "error");
        return;
    }
    const form = event.currentTarget;
    const submitBtn = qs("#saveProfileBtn", form);

    const fullName = qs("#editFullName", form).value.trim();
    const username = qs("#editUsername", form).value.trim().toLowerCase();
    const location = qs("#editLocation", form).value.trim();
    const role = qs("#editRole", form).value;
    const photoURL = qs("#editPhotoURL", form).value.trim();

    if (!fullName) {
        notify("Full name is required.", "warning");
        return;
    }

    submitBtn?.classList.add("loading");
    submitBtn?.setAttribute("disabled", "true");
    try {
        if (username && username !== PAGE_STATE.userData?.username) {
            if (typeof firestore.updateUsername === "function") {
                const usernameResult = await firestore.updateUsername(PAGE_STATE.currentUser.uid, username);
                if (!usernameResult.success) {
                    notify(usernameResult.error || "That username is unavailable.", "error");
                    return;
                }
            }
        }
        const result = await firestore.updateUser(PAGE_STATE.currentUser.uid, {
            displayName: fullName,
            location,
            role,
            photoURL,
        });
        if (!result || !result.success) {
            notify(result?.error || "Unable to update profile.", "error");
            return;
        }
        notify("Profile updated successfully.", "success");
        closeEditProfileModal();
        if (window.NovaLayout && typeof window.NovaLayout.refresh === "function") {
            await window.NovaLayout.refresh();
        }
        await refreshPage();
    } catch (error) {
        console.error("[Profile] handleEditProfileSubmit error:", error);
        notify(error?.message || "Unable to update profile.", "error");
    } finally {
        submitBtn?.classList.remove("loading");
        submitBtn?.removeAttribute("disabled");
    }
}

/* ==========================================
   EDIT PREFERENCES MODAL
========================================== */
function getEditPreferencesModal() {
    return qs("#editPreferencesModal");
}
function openEditPreferencesModal() {
    const modal = getEditPreferencesModal();
    if (!modal) return;
    const prefs = PAGE_STATE.preferences || {};
    if (prefs.theme) qs("#editTheme", modal).value = prefs.theme;
    if (prefs.defaultLanguage) qs("#editLanguage", modal).value = prefs.defaultLanguage;
    qs("#editFontSize", modal).value = prefs.fontSize || 14;
    qs("#editTabSize", modal).value = prefs.tabSize || 2;
    showModal(modal);
}
function closeEditPreferencesModal() {
    hideModal(getEditPreferencesModal());
}
async function handleEditPreferencesSubmit(event) {
    event.preventDefault();
    if (!PAGE_STATE.currentUser) {
        notify("You must be signed in to update preferences.", "error");
        return;
    }
    if (typeof firestore.saveEditorPreferences !== "function") {
        notify("Preference updates are currently unavailable.", "error");
        return;
    }
    const form = event.currentTarget;
    const submitBtn = qs("#savePreferencesBtn", form);

    const payload = {
        theme: qs("#editTheme", form).value,
        defaultLanguage: qs("#editLanguage", form).value,
        fontSize: Number(qs("#editFontSize", form).value) || 14,
        tabSize: Number(qs("#editTabSize", form).value) || 2,
    };

    submitBtn?.classList.add("loading");
    submitBtn?.setAttribute("disabled", "true");
    try {
        const result = await firestore.saveEditorPreferences(PAGE_STATE.currentUser.uid, payload);
        if (!result || !result.success) {
            notify(result?.error || "Unable to update preferences.", "error");
            return;
        }
        notify("Editor preferences updated.", "success");
        closeEditPreferencesModal();
        await refreshPage();
    } catch (error) {
        console.error("[Profile] handleEditPreferencesSubmit error:", error);
        notify(error?.message || "Unable to update preferences.", "error");
    } finally {
        submitBtn?.classList.remove("loading");
        submitBtn?.removeAttribute("disabled");
    }
}

/* ==========================================
   WIRING
========================================== */
function attachInteractions() {
    qs("#editProfileBtn")?.addEventListener("click", openEditProfileModal);
    qs("#avatarEditBadge")?.addEventListener("click", openEditProfileModal);

    ["infoRowFullName", "infoRowUsername", "infoRowLocation", "infoRowRole"].forEach((id) => {
        qs(`#${id}`)?.addEventListener("click", openEditProfileModal);
    });

    ["prefRowTheme", "prefRowLanguage", "prefRowFontSize", "prefRowTabSize"].forEach((id) => {
        qs(`#${id}`)?.addEventListener("click", openEditPreferencesModal);
    });

    qs("#editProfileForm")?.addEventListener("submit", handleEditProfileSubmit);
    attachModalDismiss(getEditProfileModal(), closeEditProfileModal);

    qs("#editPreferencesForm")?.addEventListener("submit", handleEditPreferencesSubmit);
    attachModalDismiss(getEditPreferencesModal(), closeEditPreferencesModal);
}

/* ==========================================
   INIT
========================================== */
async function init() {
    // Registered before any await so it can never miss the event that
    // layout.js dispatches once the sidebar/header/auth state are ready.
    document.addEventListener("novaeditor:layout-ready", () => {
        refreshPage().catch((error) => console.error("[Profile] refreshPage error:", error));
    });

    await loadFirestore();
    attachInteractions();

    if (window.NovaLayout && typeof window.NovaLayout.isReady === "function" && window.NovaLayout.isReady()) {
        await refreshPage();
    }
}

document.addEventListener("DOMContentLoaded", () => {
    init().catch((error) => {
        console.error("[Profile] Unhandled error during init():", error);
    });
});
