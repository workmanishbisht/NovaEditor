"use strict";

/* ==========================================
   NOVA EDITOR — SETTINGS.JS
   Connects the existing Settings UI (settings.html)
   to the existing Firebase Auth / Firestore / Storage
   architecture. No new Firebase app, no duplicate
   Firestore/Storage instance, no Monaco logic here.
========================================== */

import {
    checkSession,
    logout,
    deleteAccount,
    redirectToLanding,
    getCurrentUser,
    updateUserProfile,
    providers,
} from "../firebase/auth.js";

import {
    linkWithPopup,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import {
    getStorage,
    ref as storageRef,
    uploadBytes,
    getDownloadURL,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

import {
    getUser,
    updateUser,
    isUsernameAvailable,
    deleteUser as deleteUserDocument,
    getUserWorkspaces,
    getWorkspace,
    updateWorkspace,
    getCurrentWorkspaceId,
    saveEditorPreferences,
    getEditorPreferences,
} from "../firebase/firestore.js";

/* ==========================================
   STORAGE
   getStorage() (no args) attaches to the same
   default Firebase app that firebase-config.js
   already initializes — no second app, no second
   config.
========================================== */
const storage = getStorage();

/* ==========================================
   CONFIG
========================================== */
const CONFIG = {
    DEFAULT_AVATAR: "../assets/images/avatar/default.png",
    THEME_STORAGE_KEY: "novaeditor:theme",
    USERNAME: {
        MIN: 3,
        MAX: 20,
        REGEX: /^[a-zA-Z0-9_]+$/,
    },
    MAX_PHOTO_BYTES: 2 * 1024 * 1024,
    ALLOWED_PHOTO_TYPES: ["image/jpeg", "image/png", "image/gif"],
    DEFAULT_NOTIFICATIONS: {
        email: true,
        projectActivity: true,
        productUpdates: false,
    },
    DEFAULT_EDITOR_PREFS: {
        theme: "system",
        language: "javascript",
        fontSize: "16",
        tabSize: "4",
        wordWrap: true,
        autoSave: true,
        minimap: true,
        lineNumbers: true,
    },
};

/* ==========================================
   STATE
========================================== */
const STATE = {
    currentUser: null,
    userData: null,
    editorPreferences: null,
    workspace: null,
    providerStatus: { google: false, github: false },
    activeTab: "account",
    saving: false,
    savingEditorPrefs: false,
    savingNotifications: false,
    savingWorkspace: false,
    deleting: false,
    linking: false,
    listenersBound: false,
    systemThemeMedia: null,
};

/* ==========================================
   DOM CACHE
========================================== */
const DOM = {
    // Account
    saveChangesBtn: document.getElementById("saveChangesBtn"),
    profilePhoto: document.getElementById("profilePhotoImg"),
    profilePhotoEditBtn: document.getElementById("profilePhotoEditBtn"),
    changePhotoBtn: document.getElementById("changePhotoBtn"),
    profilePhotoHint: document.getElementById("profilePhotoHint"),
    fullName: document.getElementById("fullName"),
    username: document.getElementById("username"),
    emailAddress: document.getElementById("emailAddress"),
    location: document.getElementById("location"),
    role: document.getElementById("role"),

    // Connected Accounts
    googleStatusText: document.getElementById("googleStatusText"),
    githubStatusText: document.getElementById("githubStatusText"),
    googleConnectBtn: document.getElementById("googleConnectBtn"),
    githubConnectBtn: document.getElementById("githubConnectBtn"),

    // Appearance
    themeOptions: document.querySelectorAll("[data-theme-option]"),

    // Editor Preferences
    saveEditorPrefsBtn: document.getElementById("saveEditorPrefsBtn"),
    defaultLanguage: document.getElementById("defaultLanguage"),
    fontSize: document.getElementById("fontSize"),
    tabSize: document.getElementById("tabSize"),
    wordWrap: document.getElementById("wordWrap"),
    autoSave: document.getElementById("autoSave"),
    minimap: document.getElementById("minimap"),
    lineNumbers: document.getElementById("lineNumbers"),

    // Notifications
    saveNotificationsBtn: document.getElementById("saveNotificationsBtn"),
    notifyEmail: document.getElementById("notifyEmail"),
    notifyProjectActivity: document.getElementById("notifyProjectActivity"),
    notifyProductUpdates: document.getElementById("notifyProductUpdates"),

    // Workspace
    saveWorkspaceBtn: document.getElementById("saveWorkspaceBtn"),
    workspaceName: document.getElementById("workspaceName"),
    defaultProjectName: document.getElementById("defaultProjectName"),
    codingExperience: document.getElementById("codingExperience"),

    // Security
    securityManageBtn: document.getElementById("securityManageBtn"),

    // Data & Privacy
    exportDataBtn: document.getElementById("exportDataBtn"),
    dangerZoneManageBtn: document.getElementById("dangerZoneManageBtn"),

    // About
    aboutSignedInEmail: document.getElementById("aboutSignedInEmail"),
};

/* ==========================================
   TOAST HELPER
   (reuses the global API set up by toast.js)
========================================== */
function notify(message, type = "info") {
    if (typeof window.showToast === "function") {
        window.showToast(message, type);
    } else {
        console.warn(`[Settings] showToast unavailable — ${type}: ${message}`);
    }
}

/* ==========================================
   BOOTSTRAP
   Reuses layout.js's own auth resolution
   instead of standing up a second auth
   listener.
========================================== */
function bootstrap() {
    if (window.NovaLayout && typeof window.NovaLayout.isReady === "function" && window.NovaLayout.isReady()) {
        onLayoutReady({ detail: window.NovaLayout.getState() });
    } else {
        document.addEventListener("novaeditor:layout-ready", onLayoutReady, { once: true });
    }

    document.addEventListener(
        "novaeditor:unauthenticated",
        () => redirectToLanding(),
        { once: true }
    );
}

async function onLayoutReady(event) {
    let user = event?.detail?.currentUser || null;

    if (!user) {
        user = await checkSession();
        if (!user) {
            redirectToLanding();
            return;
        }
    }

    STATE.currentUser = user;

    try {
        await Promise.all([
            loadAccountData(),
            loadEditorPreferences(),
            loadWorkspaceData(),
        ]);
    } catch (error) {
        console.error("[Settings] Failed to load settings data:", error);
        notify("Unable to load your settings.", "error");
    }

    populateConnectedAccounts();
    populateAbout();
    applyThemePreference(STATE.editorPreferences?.theme || CONFIG.DEFAULT_EDITOR_PREFS.theme, {
        persist: false,
    });

    if (!STATE.listenersBound) {
        attachTabEvents();
        attachAccountEvents();
        attachProfilePhotoEvents();
        attachConnectedAccountsEvents();
        attachAppearanceEvents();
        attachEditorPreferencesEvents();
        attachNotificationsEvents();
        attachWorkspaceEvents();
        attachSecurityEvents();
        attachDataPrivacyEvents();
        STATE.listenersBound = true;
    }
}

/* ==========================================
   TAB NAVIGATION
   All nine nav items now map to a real panel
   in settings.html (data-tab-panel). Exactly
   one is visible at a time.
========================================== */
function attachTabEvents() {
    const navItems = document.querySelectorAll("[data-settings-nav]");

    navItems.forEach((item) => {
        item.addEventListener("click", (event) => {
            event.preventDefault();
            setActiveTab(item.dataset.settingsNav);
        });
    });
}

function setActiveTab(key) {
    const panel = document.getElementById(key);
    if (!panel) return;

    STATE.activeTab = key;

    document.querySelectorAll("[data-tab-panel]").forEach((section) => {
        section.hidden = section.id !== key;
    });

    document.querySelectorAll("[data-settings-nav]").forEach((item) => {
        const isActive = item.dataset.settingsNav === key;
        item.classList.toggle("active", isActive);
        if (isActive) {
            item.setAttribute("aria-current", "page");
        } else {
            item.removeAttribute("aria-current");
        }
    });

    panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ==========================================
   1. ACCOUNT — LOAD
========================================== */
async function loadAccountData() {
    const uid = STATE.currentUser.uid;
    const response = await getUser(uid);

    STATE.userData = response.success && response.exists ? response.data : {};
    renderAccountFields();
}

function renderAccountFields() {
    const authUser = STATE.currentUser;
    const dbUser = STATE.userData || {};

    const name = dbUser.displayName || authUser.displayName || "";
    const username = dbUser.username || "";
    const email = dbUser.email || authUser.email || "";
    const location = dbUser.location || "";
    const role = dbUser.role || "";
    const photo = dbUser.photoURL || authUser.photoURL || CONFIG.DEFAULT_AVATAR;

    if (DOM.fullName) DOM.fullName.value = name;
    if (DOM.username) DOM.username.value = username;
    if (DOM.location) DOM.location.value = location;
    if (DOM.role) DOM.role.value = role;

    if (DOM.emailAddress) {
        DOM.emailAddress.value = email;
        // Google/GitHub manage the email — never editable here.
        DOM.emailAddress.readOnly = true;
    }

    if (DOM.profilePhoto) {
        DOM.profilePhoto.src = photo;
        DOM.profilePhoto.onerror = () => {
            DOM.profilePhoto.src = CONFIG.DEFAULT_AVATAR;
        };
    }
}

/* ==========================================
   1. ACCOUNT — SAVE CHANGES
========================================== */
function attachAccountEvents() {
    if (!DOM.saveChangesBtn) return;
    DOM.saveChangesBtn.addEventListener("click", handleSaveChanges);
}

function setButtonLoading(button, isLoading, labelWhenIdle) {
    if (!button) return;
    button.disabled = isLoading;
    button.classList.toggle("is-saving", isLoading);
    const span = button.querySelector("span");
    if (span && labelWhenIdle) {
        span.textContent = isLoading ? "Saving..." : labelWhenIdle;
    }
}

async function handleSaveChanges() {
    if (STATE.saving) return;

    const fullName = (DOM.fullName?.value || "").trim();
    const username = (DOM.username?.value || "").trim().toLowerCase();
    const location = (DOM.location?.value || "").trim();
    const role = (DOM.role?.value || "").trim();

    if (!fullName) {
        notify("Full name is required.", "warning");
        return;
    }

    if (!username) {
        notify("Username is required.", "warning");
        return;
    }

    if (username.length < CONFIG.USERNAME.MIN || username.length > CONFIG.USERNAME.MAX) {
        notify(`Username must be ${CONFIG.USERNAME.MIN}-${CONFIG.USERNAME.MAX} characters.`, "warning");
        return;
    }

    if (!CONFIG.USERNAME.REGEX.test(username)) {
        notify("Username can only contain letters, numbers and underscore.", "warning");
        return;
    }

    STATE.saving = true;
    setButtonLoading(DOM.saveChangesBtn, true, "Save Changes");

    try {
        const uid = STATE.currentUser.uid;
        const currentUsername = (STATE.userData?.username || "").toLowerCase();

        if (username !== currentUsername) {
            const availability = await isUsernameAvailable(username);
            if (!availability.success) {
                throw new Error(availability.error || "Unable to verify username.");
            }
            if (!availability.data.available) {
                notify("That username is already taken.", "warning");
                return;
            }
        }

        // Preserve every field not edited here — updateUser() uses
        // setDoc(..., { merge: true }), so it never overwrites
        // preferences/workspace data and never creates a duplicate document.
        const payload = { displayName: fullName, username, location, role };

        const response = await updateUser(uid, payload);
        if (!response.success) {
            throw new Error(response.error || "Unable to save changes.");
        }

        STATE.userData = { ...STATE.userData, ...payload };
        notify("Changes saved successfully.", "success");

        if (window.NovaLayout && typeof window.NovaLayout.refresh === "function") {
            window.NovaLayout.refresh();
        }
    } catch (error) {
        console.error("[Settings] Save changes failed:", error);
        notify(error.message || "Unable to save changes.", "error");
    } finally {
        STATE.saving = false;
        setButtonLoading(DOM.saveChangesBtn, false, "Save Changes");
    }
}

/* ==========================================
   PROFILE PHOTO — FULL UPLOAD FLOW
   Uses Firebase Storage (same default app as
   auth.js/firestore.js — getStorage() attaches
   to it automatically, no second app/config).
========================================== */
let photoInput = null;

function attachProfilePhotoEvents() {
    photoInput = document.createElement("input");
    photoInput.type = "file";
    photoInput.accept = CONFIG.ALLOWED_PHOTO_TYPES.join(",");
    photoInput.hidden = true;
    document.body.appendChild(photoInput);

    [DOM.changePhotoBtn, DOM.profilePhotoEditBtn].forEach((btn) => {
        if (!btn) return;
        btn.addEventListener("click", (event) => {
            event.preventDefault();
            photoInput.click();
        });
    });

    photoInput.addEventListener("change", handlePhotoSelected);
}

async function handlePhotoSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file later

    if (!file) return;

    if (!CONFIG.ALLOWED_PHOTO_TYPES.includes(file.type)) {
        notify("Please choose a JPG, PNG or GIF image.", "warning");
        return;
    }

    if (file.size > CONFIG.MAX_PHOTO_BYTES) {
        notify("Image must be 2MB or smaller.", "warning");
        return;
    }

    const uid = STATE.currentUser.uid;
    const extension = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `avatars/${uid}/${Date.now()}.${extension}`;

    setPhotoUploading(true);
    notify("Uploading photo...", "loading");

    try {
        const fileRef = storageRef(storage, path);
        await uploadBytes(fileRef, file, { contentType: file.type });
        const downloadURL = await getDownloadURL(fileRef);

        // 1. Firestore profile document (existing users/{uid} doc, merge update).
        const firestoreResult = await updateUser(uid, { photoURL: downloadURL });
        if (!firestoreResult.success) {
            throw new Error(firestoreResult.error || "Unable to save your photo.");
        }

        // 2. Firebase Auth profile object, via the existing auth.js helper.
        const authResult = await updateUserProfile({ photoURL: downloadURL });
        if (!authResult.success) {
            console.warn("[Settings] Firestore photo saved but Auth profile update failed:", authResult.error);
        }

        // 3. Local state + Settings avatar.
        STATE.userData = { ...STATE.userData, photoURL: downloadURL };
        if (DOM.profilePhoto) DOM.profilePhoto.src = downloadURL;

        // 4. Sidebar avatar, via the existing layout refresh.
        if (window.NovaLayout && typeof window.NovaLayout.refresh === "function") {
            window.NovaLayout.refresh();
        }

        notify("Profile photo updated.", "success");
    } catch (error) {
        console.error("[Settings] Photo upload failed:", error);
        notify(error.message || "Unable to upload photo.", "error");
    } finally {
        setPhotoUploading(false);
    }
}

function setPhotoUploading(isUploading) {
    if (DOM.changePhotoBtn) DOM.changePhotoBtn.disabled = isUploading;
    if (DOM.profilePhotoEditBtn) DOM.profilePhotoEditBtn.disabled = isUploading;
    if (DOM.profilePhoto) DOM.profilePhoto.classList.toggle("is-uploading", isUploading);
}

/* ==========================================
   2. CONNECTED ACCOUNTS
========================================== */
function populateConnectedAccounts() {
    const providerIds = (STATE.currentUser.providerData || []).map((p) => p.providerId);
    const googleConnected = providerIds.includes("google.com");
    const githubConnected = providerIds.includes("github.com");

    STATE.providerStatus = { google: googleConnected, github: githubConnected };

    renderProviderRow(DOM.googleStatusText, DOM.googleConnectBtn, googleConnected);
    renderProviderRow(DOM.githubStatusText, DOM.githubConnectBtn, githubConnected);
}

function renderProviderRow(statusEl, btnEl, isConnected) {
    if (statusEl) statusEl.textContent = isConnected ? "Connected" : "Not connected";

    if (!btnEl) return;

    const span = btnEl.querySelector("span");
    if (isConnected) {
        if (span) span.textContent = "Connected";
        btnEl.disabled = true;
        btnEl.classList.add("is-connected");
    } else {
        if (span) span.textContent = "Connect";
        btnEl.disabled = false;
        btnEl.classList.remove("is-connected");
    }
}

function attachConnectedAccountsEvents() {
    if (DOM.googleConnectBtn) {
        DOM.googleConnectBtn.addEventListener("click", () => handleLinkProvider("google"));
    }
    if (DOM.githubConnectBtn) {
        DOM.githubConnectBtn.addEventListener("click", () => handleLinkProvider("github"));
    }
}

/**
 * Links an additional provider to the current Firebase Auth user
 * using the SAME provider instances auth.js already exports and
 * configures (scopes/custom parameters), via Firebase's own
 * linkWithPopup API. No custom linking system.
 */
async function handleLinkProvider(providerKey) {
    if (STATE.linking) return;
    if (STATE.providerStatus[providerKey]) return;

    const provider = providers[providerKey];
    if (!provider) return;

    const user = getCurrentUser();
    if (!user) {
        notify("Please sign in again to connect another account.", "error");
        return;
    }

    STATE.linking = true;
    const btn = providerKey === "google" ? DOM.googleConnectBtn : DOM.githubConnectBtn;
    if (btn) btn.disabled = true;

    try {
        await linkWithPopup(user, provider);
        STATE.currentUser = getCurrentUser() || STATE.currentUser;
        populateConnectedAccounts();
        notify("Account connected successfully.", "success");
    } catch (error) {
        console.error("[Settings] Provider linking failed:", error);

        if (error?.code === "auth/credential-already-in-use" || error?.code === "auth/email-already-in-use") {
            notify("That account is already linked to a different Nova Editor profile.", "error");
        } else if (error?.code === "auth/popup-closed-by-user") {
            notify("Connection cancelled before it could complete.", "info");
        } else if (error?.code === "auth/provider-already-linked") {
            notify("That provider is already connected.", "info");
            populateConnectedAccounts();
        } else {
            notify("Unable to connect that account.", "error");
        }
    } finally {
        STATE.linking = false;
        if (btn && !STATE.providerStatus[providerKey]) btn.disabled = false;
    }
}

/* ==========================================
   3. APPEARANCE
   Reuses layout.js's own theme system:
   - Same localStorage key ("novaeditor:theme")
     and same two effective values ("light"/"dark")
     that the header's theme toggle already reads.
   - The user's raw preference (light/dark/system)
     is stored in the SAME editor-preferences doc
     setup.js already writes to (theme field) —
     no second preferences document.
========================================== */
function attachAppearanceEvents() {
    DOM.themeOptions.forEach((btn) => {
        btn.addEventListener("click", () => {
            applyThemePreference(btn.dataset.themeOption, { persist: true });
        });
    });
}

function resolveEffectiveTheme(preference) {
    if (preference === "system") {
        if (!STATE.systemThemeMedia) {
            STATE.systemThemeMedia = window.matchMedia("(prefers-color-scheme: dark)");
        }
        return STATE.systemThemeMedia.matches ? "dark" : "light";
    }
    return preference === "dark" ? "dark" : "light";
}

function applyThemePreference(preference, { persist }) {
    const pref = ["light", "dark", "system"].includes(preference) ? preference : "light";
    const effective = resolveEffectiveTheme(pref);

    // Apply immediately — exact same attribute + storage key layout.js uses,
    // so the header toggle and every other page stay in sync.
    document.documentElement.setAttribute("data-theme", effective);
    try {
        localStorage.setItem(CONFIG.THEME_STORAGE_KEY, effective);
    } catch (error) {
        console.warn("[Settings] Unable to persist theme to localStorage:", error);
    }
    syncHeaderThemeToggle(effective);

    // Live-update if "system" is selected and the OS theme changes.
    if (pref === "system" && STATE.systemThemeMedia && !STATE.systemThemeMedia.dataset?.bound) {
        STATE.systemThemeMedia.addEventListener?.("change", () => {
            if (STATE.editorPreferences?.theme === "system") {
                applyThemePreference("system", { persist: false });
            }
        });
    }

    DOM.themeOptions.forEach((btn) => {
        const isActive = btn.dataset.themeOption === pref;
        btn.classList.toggle("active", isActive);
        btn.setAttribute("aria-checked", isActive ? "true" : "false");
    });

    STATE.editorPreferences = { ...STATE.editorPreferences, theme: pref };

    if (persist) {
        saveEditorPreferences(STATE.currentUser.uid, { theme: pref })
            .then((response) => {
                if (!response.success) throw new Error(response.error);
                notify("Preferences saved.", "success");
            })
            .catch((error) => {
                console.error("[Settings] Failed to save theme preference:", error);
                notify("Unable to save changes.", "error");
            });
    }
}

function syncHeaderThemeToggle(effective) {
    const toggleBtn = document.querySelector("[data-theme-toggle]");
    if (!toggleBtn) return;
    toggleBtn.setAttribute("aria-pressed", effective === "dark" ? "true" : "false");
    toggleBtn.classList.toggle("is-dark", effective === "dark");
}

/* ==========================================
   4. EDITOR PREFERENCES
   Loads/saves the SAME users/{uid}/preferences/editor
   document setup.js already writes to.
========================================== */
async function loadEditorPreferences() {
    const uid = STATE.currentUser.uid;
    const response = await getEditorPreferences(uid);

    STATE.editorPreferences = {
        ...CONFIG.DEFAULT_EDITOR_PREFS,
        ...(response.success && response.exists ? response.data : {}),
    };

    renderEditorPreferenceFields();
}

function renderEditorPreferenceFields() {
    const prefs = STATE.editorPreferences || CONFIG.DEFAULT_EDITOR_PREFS;

    if (DOM.defaultLanguage) DOM.defaultLanguage.value = prefs.language || "javascript";
    if (DOM.fontSize) DOM.fontSize.value = prefs.fontSize || "16";
    if (DOM.tabSize) DOM.tabSize.value = prefs.tabSize || "4";
    if (DOM.wordWrap) DOM.wordWrap.checked = !!prefs.wordWrap;
    if (DOM.autoSave) DOM.autoSave.checked = !!prefs.autoSave;
    if (DOM.minimap) DOM.minimap.checked = !!prefs.minimap;
    if (DOM.lineNumbers) DOM.lineNumbers.checked = !!prefs.lineNumbers;
}

function attachEditorPreferencesEvents() {
    if (!DOM.saveEditorPrefsBtn) return;
    DOM.saveEditorPrefsBtn.addEventListener("click", handleSaveEditorPreferences);
}

async function handleSaveEditorPreferences() {
    if (STATE.savingEditorPrefs) return;

    const fontSize = Number(DOM.fontSize?.value);
    if (!fontSize || fontSize < 10 || fontSize > 24) {
        notify("Font size must be between 10 and 24.", "warning");
        return;
    }

    STATE.savingEditorPrefs = true;
    setButtonLoading(DOM.saveEditorPrefsBtn, true, "Save Changes");

    const payload = {
        language: DOM.defaultLanguage?.value || "javascript",
        fontSize: String(fontSize),
        tabSize: DOM.tabSize?.value || "4",
        wordWrap: !!DOM.wordWrap?.checked,
        autoSave: !!DOM.autoSave?.checked,
        minimap: !!DOM.minimap?.checked,
        lineNumbers: !!DOM.lineNumbers?.checked,
        // Monaco itself is never touched here — this only persists the
        // preference. The editor layer reads it separately.
    };

    try {
        const response = await saveEditorPreferences(STATE.currentUser.uid, payload);
        if (!response.success) throw new Error(response.error || "Unable to save changes.");

        STATE.editorPreferences = { ...STATE.editorPreferences, ...payload };
        notify("Preferences saved.", "success");
    } catch (error) {
        console.error("[Settings] Save editor preferences failed:", error);
        notify(error.message || "Unable to save changes.", "error");
    } finally {
        STATE.savingEditorPrefs = false;
        setButtonLoading(DOM.saveEditorPrefsBtn, false, "Save Changes");
    }
}

/* ==========================================
   5. NOTIFICATIONS
   No dedicated collection exists anywhere in
   the provided architecture, so preferences are
   stored on the SAME users/{uid} document as a
   `notifications` object (merge update — nothing
   else on the document is touched).
========================================== */
function renderNotificationFields() {
    const prefs = { ...CONFIG.DEFAULT_NOTIFICATIONS, ...(STATE.userData?.notifications || {}) };

    if (DOM.notifyEmail) DOM.notifyEmail.checked = !!prefs.email;
    if (DOM.notifyProjectActivity) DOM.notifyProjectActivity.checked = !!prefs.projectActivity;
    if (DOM.notifyProductUpdates) DOM.notifyProductUpdates.checked = !!prefs.productUpdates;
}

function attachNotificationsEvents() {
    if (!DOM.saveNotificationsBtn) return;
    DOM.saveNotificationsBtn.addEventListener("click", handleSaveNotifications);

    // Render once data is loaded — hook into the same load pass as Account.
    renderNotificationFields();
}

async function handleSaveNotifications() {
    if (STATE.savingNotifications) return;

    STATE.savingNotifications = true;
    setButtonLoading(DOM.saveNotificationsBtn, true, "Save Changes");

    const notifications = {
        email: !!DOM.notifyEmail?.checked,
        projectActivity: !!DOM.notifyProjectActivity?.checked,
        productUpdates: !!DOM.notifyProductUpdates?.checked,
    };

    try {
        const response = await updateUser(STATE.currentUser.uid, { notifications });
        if (!response.success) throw new Error(response.error || "Unable to save changes.");

        STATE.userData = { ...STATE.userData, notifications };
        notify("Preferences saved.", "success");
    } catch (error) {
        console.error("[Settings] Save notifications failed:", error);
        notify(error.message || "Unable to save changes.", "error");
    } finally {
        STATE.savingNotifications = false;
        setButtonLoading(DOM.saveNotificationsBtn, false, "Save Changes");
    }
}

/* ==========================================
   6. WORKSPACE
   Loads/saves the SAME workspace document
   created during setup (workspaces/{id}), found
   via the user's currentWorkspaceId — never a
   new workspace document.
========================================== */
async function loadWorkspaceData() {
    const uid = STATE.currentUser.uid;
    let workspaceId = STATE.userData?.currentWorkspaceId || getCurrentWorkspaceId();
    let workspace = null;

    if (workspaceId) {
        const response = await getWorkspace(workspaceId);
        if (response.success && response.exists) {
            workspace = { id: workspaceId, ...response.data };
        }
    }

    if (!workspace) {
        // Fallback: locate any workspace owned by this user.
        const listResponse = await getUserWorkspaces(uid);
        if (listResponse.success && listResponse.data?.length) {
            workspace = listResponse.data[0];
        }
    }

    STATE.workspace = workspace;
    renderWorkspaceFields();
}

function renderWorkspaceFields() {
    const workspace = STATE.workspace || {};

    if (DOM.workspaceName) DOM.workspaceName.value = workspace.workspaceName || "";
    if (DOM.defaultProjectName) DOM.defaultProjectName.value = workspace.defaultProject || "";
    if (DOM.codingExperience) DOM.codingExperience.value = workspace.experience || "Beginner";
}

function attachWorkspaceEvents() {
    if (!DOM.saveWorkspaceBtn) return;
    DOM.saveWorkspaceBtn.addEventListener("click", handleSaveWorkspace);
}

async function handleSaveWorkspace() {
    if (STATE.savingWorkspace) return;

    if (!STATE.workspace?.id) {
        notify("No workspace found to update.", "error");
        return;
    }

    const workspaceName = (DOM.workspaceName?.value || "").trim();
    if (!workspaceName || workspaceName.length < 3) {
        notify("Workspace name must be at least 3 characters.", "warning");
        return;
    }

    STATE.savingWorkspace = true;
    setButtonLoading(DOM.saveWorkspaceBtn, true, "Save Changes");

    const payload = {
        workspaceName,
        defaultProject: (DOM.defaultProjectName?.value || "").trim(),
        experience: DOM.codingExperience?.value || "Beginner",
    };

    try {
        const response = await updateWorkspace(STATE.workspace.id, payload);
        if (!response.success) throw new Error(response.error || "Unable to save changes.");

        STATE.workspace = { ...STATE.workspace, ...payload };
        notify("Workspace updated.", "success");

        if (window.NovaLayout && typeof window.NovaLayout.refresh === "function") {
            window.NovaLayout.refresh();
        }
    } catch (error) {
        console.error("[Settings] Save workspace failed:", error);
        notify(error.message || "Unable to save changes.", "error");
    } finally {
        STATE.savingWorkspace = false;
        setButtonLoading(DOM.saveWorkspaceBtn, false, "Save Changes");
    }
}

/* ==========================================
   7. SECURITY
   Only what's compatible with Google/GitHub
   auth: sign out. No password reset, no
   invented session list.
========================================== */
function attachSecurityEvents() {
    if (!DOM.securityManageBtn) return;

    DOM.securityManageBtn.addEventListener("click", () => {
        openConfirmModal({
            title: "Sign out",
            message:
                "You'll be signed out of Nova Editor on this device and returned to the sign in page.",
            confirmLabel: "Sign Out",
            danger: false,

            onConfirm: async () => {
                const result = await logout();

                if (result.success) {
                    notify("Signed out successfully.", "success");
                    redirectToLanding();
                } else {
                    notify(result.error || "Unable to sign out.", "error");
                }
            },
        });

        // Style Sign Out button
        setTimeout(() => {
            const buttons = document.querySelectorAll("button");

            buttons.forEach((button) => {
                if (button.textContent.trim() === "Sign Out") {
                    button.style.setProperty("color", "#dc2626", "important");
                    button.style.setProperty(
                        "background-color",
                        "#fef2f2",
                        "important"
                    );
                    button.style.setProperty(
                        "border",
                        "1px solid #fecaca",
                        "important"
                    );

                    // Button spacing
                    button.style.setProperty("padding", "9px 16px", "important");
                    button.style.setProperty("border-radius", "6px", "important");
                    button.style.setProperty("font-size", "15px", "important");
                    button.style.setProperty("font-weight", "500", "important");
                    button.style.setProperty("cursor", "pointer", "important");
                    button.style.setProperty("margin-left", "8px", "important");

                    // Hover
                    button.addEventListener("mouseenter", () => {
                        button.style.setProperty(
                            "background-color",
                            "#fee2e2",
                            "important"
                        );
                        button.style.setProperty(
                            "color",
                            "#b91c1c",
                            "important"
                        );
                    });

                    button.addEventListener("mouseleave", () => {
                        button.style.setProperty(
                            "background-color",
                            "#fef2f2",
                            "important"
                        );
                        button.style.setProperty(
                            "color",
                            "#dc2626",
                            "important"
                        );
                    });
                }
            });
        }, 50);
    });
}

/* ==========================================
   8. DATA & PRIVACY
========================================== */
function attachDataPrivacyEvents() {
    if (DOM.exportDataBtn) {
        DOM.exportDataBtn.addEventListener("click", handleExportData);
    }

    if (DOM.dangerZoneManageBtn) {
        DOM.dangerZoneManageBtn.addEventListener("click", () => {
            openConfirmModal({
                title: "Delete account",
                message:
                    "This permanently deletes your Nova Editor account and profile data. Your projects are not removed automatically — delete those separately from Projects first. This cannot be undone.",
                confirmLabel: "Delete Account",
                danger: true,
                onConfirm: handleDeleteAccount,
            });
        });
    }
}

function handleExportData() {
    try {
        const exportPayload = {
            profile: {
                displayName: STATE.userData?.displayName || "",
                username: STATE.userData?.username || "",
                email: STATE.userData?.email || STATE.currentUser?.email || "",
                location: STATE.userData?.location || "",
                role: STATE.userData?.role || "",
            },
            workspace: STATE.workspace
                ? {
                    workspaceName: STATE.workspace.workspaceName || "",
                    defaultProject: STATE.workspace.defaultProject || "",
                    experience: STATE.workspace.experience || "",
                }
                : null,
            editorPreferences: STATE.editorPreferences || null,
            notifications: STATE.userData?.notifications || CONFIG.DEFAULT_NOTIFICATIONS,
            exportedAt: new Date().toISOString(),
        };

        const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = url;
        link.download = "nova-editor-data-export.json";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);

        notify("Account action completed.", "success");
    } catch (error) {
        console.error("[Settings] Export data failed:", error);
        notify("Something went wrong.", "error");
    }
}

async function handleDeleteAccount() {
    if (STATE.deleting) return;
    STATE.deleting = true;

    try {
        const uid = STATE.currentUser.uid;

        // 1. Firestore document first — deleting Auth first would strip the
        //    permissions most security rules require to remove it after.
        const docResult = await deleteUserDocument(uid);
        if (!docResult.success) {
            throw new Error(docResult.error || "Unable to delete account data.");
        }

        // 2. Firebase Auth user.
        const authResult = await deleteAccount();
        if (!authResult.success) {
            throw new Error(authResult.error || "Unable to delete account.");
        }

        notify("Account deleted.", "success");
        redirectToLanding();
    } catch (error) {
        console.error("[Settings] Delete account failed:", error);
        notify(error.message || "Something went wrong.", "error");
    } finally {
        STATE.deleting = false;
    }
}

/* ==========================================
   9. ABOUT
========================================== */
function populateAbout() {
    if (DOM.aboutSignedInEmail) {
        DOM.aboutSignedInEmail.textContent =
            STATE.userData?.email || STATE.currentUser?.email || "—";
    }
}

/* ==========================================
   CONFIRMATION MODAL
   Minimal, self-contained dialog built from
   existing button classes/CSS variables — no
   alert()/confirm()/prompt(), no second modal
   system.
========================================== */
let confirmModalEls = null;
let pendingConfirmAction = null;

function ensureConfirmModal() {
    if (confirmModalEls) return confirmModalEls;

    const overlay = document.createElement("div");
    overlay.className = "settings-confirm-overlay";
    overlay.hidden = true;
    overlay.innerHTML = `
        <div class="settings-confirm-modal" role="alertdialog" aria-modal="true"
             aria-labelledby="settingsConfirmTitle" aria-describedby="settingsConfirmMessage">
            <h3 id="settingsConfirmTitle"></h3>
            <p id="settingsConfirmMessage"></p>
            <div class="settings-confirm-actions">
                <button type="button" class="btn btn-outline" data-confirm-cancel>Cancel</button>
                <button type="button" class="btn" data-confirm-ok></button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    confirmModalEls = {
        overlay,
        title: overlay.querySelector("#settingsConfirmTitle"),
        message: overlay.querySelector("#settingsConfirmMessage"),
        cancelBtn: overlay.querySelector("[data-confirm-cancel]"),
        okBtn: overlay.querySelector("[data-confirm-ok]"),
    };

    confirmModalEls.overlay.addEventListener("click", (event) => {
        if (event.target === confirmModalEls.overlay) closeConfirmModal();
    });
    confirmModalEls.cancelBtn.addEventListener("click", closeConfirmModal);
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && confirmModalEls && !confirmModalEls.overlay.hidden) {
            closeConfirmModal();
        }
    });

    return confirmModalEls;
}

function openConfirmModal({ title, message, confirmLabel = "Confirm", danger = false, onConfirm }) {
    const els = ensureConfirmModal();

    els.title.textContent = title;
    els.message.textContent = message;
    els.okBtn.textContent = confirmLabel;
    els.okBtn.className = danger ? "btn btn-danger-outline" : "btn btn-primary-solid";

    pendingConfirmAction = onConfirm;

    els.okBtn.onclick = async () => {
        els.okBtn.disabled = true;
        els.cancelBtn.disabled = true;
        try {
            if (typeof pendingConfirmAction === "function") {
                await pendingConfirmAction();
            }
        } finally {
            els.okBtn.disabled = false;
            els.cancelBtn.disabled = false;
            closeConfirmModal();
        }
    };

    els.overlay.hidden = false;
    requestAnimationFrame(() => els.overlay.classList.add("open"));
}

function closeConfirmModal() {
    if (!confirmModalEls) return;
    confirmModalEls.overlay.classList.remove("open");
    setTimeout(() => {
        if (confirmModalEls) confirmModalEls.overlay.hidden = true;
    }, 180);
}

/* ==========================================
   BOOTSTRAP
========================================== */
bootstrap();

// Notifications fields are populated once account/user data has loaded —
// re-render here too in case this module evaluates before that promise
// settles on a slow connection.
document.addEventListener("novaeditor:layout-ready", () => {
    setTimeout(renderNotificationFields, 0);
}, { once: true });