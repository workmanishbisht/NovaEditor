"use strict";

/* ==========================================
   NOVA EDITOR — NOTIFICATIONS.JS
   ------------------------------------------
   Connects the existing Notifications UI
   (pages/notifications.html) to real Firestore
   data using ONLY the functions already
   exported by firebase/firestore.js:

     createNotification            (used elsewhere, not here)
     getUserNotifications
     subscribeToUserNotifications
     markNotificationRead
     markAllNotificationsRead
     deleteNotification
     clearAllNotifications
     getUnreadNotificationCount

   - No new Firebase initialization.
   - No new auth system — reuses NovaLayout's
     already-resolved auth state, exactly like
     projects.js (no second onAuthStateChanged
     listener).
   - No new Firestore schema/service.
   - No alert() / confirm() / prompt() — reuses
     the same `.nova-modal` confirmation pattern
     already used in projects.js / dashboard.js.
   - No dummy/static notification data — the
     static example cards in notifications.html
     are replaced entirely by real Firestore
     data on load.
========================================== */

/* ==========================================
   CONFIG
========================================== */
const SELECTORS = {
    LIST: "#notificationsList",
    SKELETON: "#notificationsSkeleton",
    EMPTY_STATE: "#notificationsEmptyState",
    ERROR_STATE: "#notificationsErrorState",
    TABS_CONTAINER: "#notificationsTabs",
    MARK_ALL_BTN: "#markAllReadBtn",
    CLEAR_ALL_BTN: "#clearAllBtn",
    RETRY_BTN: "#notificationsRetryBtn",
    HEADER_BADGE: "[data-notification-badge]",
};

// Order matches the tab buttons already present in notifications.html:
// All, Unread, Projects, System, Account, AI
const TAB_KEYS = ["all", "unread", "projects", "system", "account", "ai"];

// Maps a notification's `type` (falls back to `category`) to the
// existing icon container classes / Remix Icons already defined in
// notifications.css / notifications.html — no new icon classes added.
const TYPE_ICON_MAP = {
    "project-created": { icon: "ri-folder-line", className: "notif-icon-project" },
    "project-trash": { icon: "ri-delete-bin-line", className: "notif-icon-trash" },
    "project-restored": { icon: "ri-inbox-unarchive-line", className: "notif-icon-project" },
    "project-deleted": { icon: "ri-delete-bin-line", className: "notif-icon-trash" },
    "settings-updated": { icon: "ri-information-line", className: "notif-icon-system" },
    "auth-signin": { icon: "ri-user-line", className: "notif-icon-account" },
    "ai-response-ready": { icon: "ri-sparkling-line", className: "notif-icon-ai" },
};

const CATEGORY_ICON_MAP = {
    projects: { icon: "ri-folder-line", className: "notif-icon-project" },
    system: { icon: "ri-information-line", className: "notif-icon-system" },
    account: { icon: "ri-user-line", className: "notif-icon-account" },
    ai: { icon: "ri-sparkling-line", className: "notif-icon-ai" },
};

/* ==========================================
   STATE
========================================== */
const STATE = {
    currentUser: null,
    allNotifications: [],
    activeTab: "all",
    status: "idle", // idle | loading | loaded | error
    errorMessage: "",
    unsubscribe: null,
};

/* ==========================================
   DEPENDENCIES
   ------------------------------------------
   Loaded lazily and reused — never a second
   Firebase init, never a second auth listener.
   Same pattern as projects.js.
========================================== */
const deps = { auth: {}, firestore: {} };

async function loadDependencies() {
    try {
        deps.auth = await import("../firebase/auth.js");
    } catch (error) {
        console.error("[Notifications] Failed to load firebase/auth.js:", error);
    }
    try {
        deps.firestore = await import("../firebase/firestore.js");
    } catch (error) {
        console.error("[Notifications] Failed to load firebase/firestore.js:", error);
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
    if (typeof window.showToast === "function") {
        window.showToast(message, type);
    } else {
        console.warn(`[Notifications] showToast unavailable — ${type}: ${message}`);
    }
}
function setHidden(el, hidden) {
    if (el) el.hidden = hidden;
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

function timeAgo(value) {
    const date = toDate(value);
    if (!date) return "";

    const diffMs = Date.now() - date.getTime();
    const diffSec = Math.max(0, Math.round(diffMs / 1000));

    if (diffSec < 45) return "Just now";

    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;

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
   ICON HELPER
========================================== */
function getIconInfo(notification) {
    return (
        TYPE_ICON_MAP[notification.type] ||
        CATEGORY_ICON_MAP[notification.category] || {
            icon: "ri-notification-3-line",
            className: "notif-icon-system",
        }
    );
}

/* ==========================================
   CUSTOM CONFIRMATION MODAL
   ------------------------------------------
   Same `.nova-modal` markup pattern already
   used by projects.js (showConfirmModal) and
   dashboard.js (showConfirmDialog) — a local
   copy following that established convention.
   Never falls back to window.confirm().
========================================== */
function showConfirmModal(title, message, options = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "nova-modal";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-labelledby", "notifConfirmModalTitle");

        overlay.innerHTML = `
            <div class="nova-modal-backdrop" data-confirm-cancel></div>
            <div class="nova-modal-dialog" role="document">
                <div class="nova-modal-header">
                    <h2 id="notifConfirmModalTitle" class="nova-modal-title">${escapeHtml(title)}</h2>
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

        const dialog = qs(".nova-modal-dialog", overlay);
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

        qsa("[data-confirm-cancel]", overlay).forEach((el) => {
            el.addEventListener("click", (event) => {
                event.preventDefault();
                cleanup(false);
            });
        });

        qs("[data-confirm-ok]", overlay)?.addEventListener("click", (event) => {
            event.preventDefault();
            cleanup(true);
        });

        qs("[data-confirm-ok]", overlay)?.focus();
    });
}

/* ==========================================
   FILTER
========================================== */
function filterNotifications() {
    const list = STATE.allNotifications;

    switch (STATE.activeTab) {
        case "unread":
            return list.filter((n) => n.read !== true);
        case "projects":
            return list.filter((n) => n.category === "projects");
        case "system":
            return list.filter((n) => n.category === "system");
        case "account":
            return list.filter((n) => n.category === "account");
        case "ai":
            return list.filter((n) => n.category === "ai");
        case "all":
        default:
            return list;
    }
}

/* ==========================================
   RENDER — ROOT
========================================== */
function render() {
    const listEl = qs(SELECTORS.LIST);
    const skeletonEl = qs(SELECTORS.SKELETON);
    const emptyStateEl = qs(SELECTORS.EMPTY_STATE);
    const errorStateEl = qs(SELECTORS.ERROR_STATE);
    if (!listEl) return;

    if (STATE.status === "loading") {
        setHidden(skeletonEl, false);
        setHidden(listEl, true);
        setHidden(emptyStateEl, true);
        setHidden(errorStateEl, true);
        return;
    }

    if (STATE.status === "error") {
        setHidden(skeletonEl, true);
        setHidden(listEl, true);
        setHidden(emptyStateEl, true);
        renderErrorState(errorStateEl);
        return;
    }

    setHidden(skeletonEl, true);
    setHidden(errorStateEl, true);

    const filtered = filterNotifications();

    if (filtered.length === 0) {
        setHidden(listEl, true);
        renderEmptyState(emptyStateEl);
        return;
    }

    setHidden(emptyStateEl, true);
    setHidden(listEl, false);
    renderList(listEl, filtered);
}

/* ==========================================
   RENDER — LIST
========================================== */
function renderList(listEl, notifications) {
    listEl.innerHTML = "";
    const fragment = document.createDocumentFragment();

    notifications.forEach((notification) => {
        fragment.appendChild(renderNotificationItem(notification));
    });

    listEl.appendChild(fragment);
}

function renderNotificationItem(notification) {
    const isUnread = notification.read !== true;
    const iconInfo = getIconInfo(notification);

    const article = document.createElement("article");
    article.className = `notification-item ${isUnread ? "is-unread" : "is-read"}`;
    article.tabIndex = 0;
    article.dataset.id = notification.id;

    article.innerHTML = `
        <span class="notif-icon ${iconInfo.className}" aria-hidden="true">
            <i class="${iconInfo.icon}"></i>
        </span>
        <div class="notif-body">
            <div class="notif-body-top">
                <h3 class="notif-title">${escapeHtml(notification.title || "Notification")}</h3>
                <span class="notif-time">${escapeHtml(timeAgo(notification.createdAt))}</span>
            </div>
            <p class="notif-message">${escapeHtml(notification.message || "")}</p>
        </div>
        <div class="notif-side" style="gap:8px;">
            ${isUnread ? '<span class="unread-dot" aria-label="Unread notification"></span>' : ""}
            <button type="button" class="notif-action-btn" aria-label="Delete notification" data-delete-btn>
                <i class="ri-delete-bin-line"></i>
            </button>
        </div>
    `;

    // Clicking the row (but not the delete button) marks an unread
    // notification as read — never re-marks an already-read one.
    article.addEventListener("click", (event) => {
        if (event.target.closest("[data-delete-btn]")) return;
        if (isUnread) {
            handleMarkAsRead(notification.id);
        }
    });

    article.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            if (event.target.closest("[data-delete-btn]")) return;
            event.preventDefault();
            if (isUnread) {
                handleMarkAsRead(notification.id);
            }
        }
    });

    qs("[data-delete-btn]", article)?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        handleDeleteNotification(notification.id);
    });

    return article;
}

/* ==========================================
   RENDER — EMPTY STATE
========================================== */
function renderEmptyState(emptyStateEl) {
    if (!emptyStateEl) return;
    setHidden(emptyStateEl, false);

    const heading = qs("h3", emptyStateEl);
    const paragraph = qs("p", emptyStateEl);

    const hasAnyNotifications = STATE.allNotifications.length > 0;

    if (hasAnyNotifications) {
        // A filter is active and simply has no matches right now.
        if (heading) heading.textContent = "Nothing here";
        if (paragraph) paragraph.textContent = "No notifications in this category.";
    } else {
        if (heading) heading.textContent = "You're all caught up";
        if (paragraph) paragraph.textContent = "No new notifications right now.";
    }
}

/* ==========================================
   RENDER — ERROR STATE
========================================== */
function renderErrorState(errorStateEl) {
    if (!errorStateEl) return;
    setHidden(errorStateEl, false);

    const paragraph = qs("p", errorStateEl);
    if (paragraph) {
        paragraph.textContent =
            STATE.errorMessage || "Something went wrong while loading your notifications.";
    }
}

/* ==========================================
   HEADER BADGE
   ------------------------------------------
   Reuses the SAME [data-notification-badge]
   element layout.js already renders inside the
   header partial and already keeps in sync on
   page load (refreshNotificationBadge() in
   layout.js, backed by getUnreadNotificationCount()).
   While this page is open, the realtime
   subscription below keeps that same element
   current too — no second badge, no new markup.
========================================== */
function updateHeaderBadge(count) {
    const badge = qs(SELECTORS.HEADER_BADGE);
    if (!badge) return;

    if (typeof count !== "number" || count <= 0) {
        badge.hidden = true;
        return;
    }

    badge.textContent = count > 99 ? "99+" : String(count);
    badge.hidden = false;
}

function computeUnreadCount() {
    return STATE.allNotifications.filter((n) => n.read !== true).length;
}

/* ==========================================
   ACTIONS — MARK AS READ
========================================== */
async function handleMarkAsRead(notificationId) {
    if (typeof deps.firestore.markNotificationRead !== "function") {
        notify("Unable to update notification.", "error");
        return;
    }

    // Optimistic UI update — the realtime subscription will reconcile
    // this with the server state moments later regardless.
    const target = STATE.allNotifications.find((n) => n.id === notificationId);
    if (target) {
        target.read = true;
        render();
        updateHeaderBadge(computeUnreadCount());
    }

    try {
        const response = await deps.firestore.markNotificationRead(notificationId, true);
        if (!response || !response.success) {
            throw new Error(response?.error || "Unable to update notification.");
        }
    } catch (error) {
        console.error("[Notifications] markNotificationRead failed:", error);
        // Revert optimistic update on failure.
        if (target) {
            target.read = false;
            render();
            updateHeaderBadge(computeUnreadCount());
        }
        notify("Unable to update notification.", "error");
    }
}

/* ==========================================
   ACTIONS — MARK ALL AS READ
========================================== */
function attachMarkAllRead() {
    const btn = qs(SELECTORS.MARK_ALL_BTN);
    if (!btn) return;

    btn.addEventListener("click", async () => {
        if (!STATE.currentUser) return;

        if (typeof deps.firestore.markAllNotificationsRead !== "function") {
            notify("Unable to update notifications.", "error");
            return;
        }

        const hasUnread = STATE.allNotifications.some((n) => n.read !== true);
        if (!hasUnread) return;

        btn.disabled = true;

        try {
            const response = await deps.firestore.markAllNotificationsRead(STATE.currentUser.uid);
            if (!response || !response.success) {
                throw new Error(response?.error || "Unable to update notifications.");
            }

            // Optimistic local update — realtime subscription reconciles shortly after.
            STATE.allNotifications = STATE.allNotifications.map((n) => ({ ...n, read: true }));
            render();
            updateHeaderBadge(0);
            notify("All notifications marked as read.", "success");
        } catch (error) {
            console.error("[Notifications] markAllNotificationsRead failed:", error);
            notify("Unable to update notifications.", "error");
        } finally {
            btn.disabled = false;
        }
    });
}

/* ==========================================
   ACTIONS — CLEAR ALL
========================================== */
function attachClearAll() {
    const btn = qs(SELECTORS.CLEAR_ALL_BTN);
    if (!btn) return;

    btn.addEventListener("click", async () => {
        if (!STATE.currentUser) return;

        if (STATE.allNotifications.length === 0) return;

        const confirmed = await showConfirmModal(
            "Clear all notifications?",
            "This will permanently remove your notification history.",
            { confirmLabel: "Clear All", danger: true }
        );
        if (!confirmed) return;

        if (typeof deps.firestore.clearAllNotifications !== "function") {
            notify("Unable to clear notifications.", "error");
            return;
        }

        btn.disabled = true;

        try {
            const response = await deps.firestore.clearAllNotifications(STATE.currentUser.uid);
            if (!response || !response.success) {
                throw new Error(response?.error || "Unable to clear notifications.");
            }

            STATE.allNotifications = [];
            render();
            updateHeaderBadge(0);
            notify("Notifications cleared.", "success");
        } catch (error) {
            console.error("[Notifications] clearAllNotifications failed:", error);
            notify("Unable to clear notifications.", "error");
        } finally {
            btn.disabled = false;
        }
    });
}

/* ==========================================
   ACTIONS — DELETE INDIVIDUAL
========================================== */
async function handleDeleteNotification(notificationId) {
    if (typeof deps.firestore.deleteNotification !== "function") {
        notify("Unable to delete notification.", "error");
        return;
    }

    const previous = STATE.allNotifications;
    // Optimistic removal.
    STATE.allNotifications = STATE.allNotifications.filter((n) => n.id !== notificationId);
    render();
    updateHeaderBadge(computeUnreadCount());

    try {
        const response = await deps.firestore.deleteNotification(notificationId);
        if (!response || !response.success) {
            throw new Error(response?.error || "Unable to delete notification.");
        }
        notify("Notification deleted.", "success");
    } catch (error) {
        console.error("[Notifications] deleteNotification failed:", error);
        // Revert optimistic removal on failure.
        STATE.allNotifications = previous;
        render();
        updateHeaderBadge(computeUnreadCount());
        notify("Unable to delete notification.", "error");
    }
}

/* ==========================================
   TABS
========================================== */
function setupTabs() {
    const container = qs(SELECTORS.TABS_CONTAINER);
    if (!container) return;

    const tabButtons = qsa(".notif-tab", container);

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

            // Purely client-side — no Firestore refetch on filter change.
            render();
        });
    });
}

/* ==========================================
   RETRY
========================================== */
function setupRetry() {
    const btn = qs(SELECTORS.RETRY_BTN);
    if (!btn) return;

    btn.addEventListener("click", () => {
        if (!STATE.currentUser) return;
        startSubscription(STATE.currentUser.uid);
    });
}

/* ==========================================
   REALTIME SUBSCRIPTION
========================================== */
function stopSubscription() {
    if (typeof STATE.unsubscribe === "function") {
        STATE.unsubscribe();
    }
    STATE.unsubscribe = null;
}

function startSubscription(uid) {
    stopSubscription();

    if (typeof deps.firestore.subscribeToUserNotifications !== "function") {
        STATE.status = "error";
        STATE.errorMessage = "Notifications service is currently unavailable.";
        render();
        return;
    }

    STATE.status = "loading";
    render();

    STATE.unsubscribe = deps.firestore.subscribeToUserNotifications(
        uid,
        (notifications) => {
            STATE.allNotifications = notifications;
            STATE.status = "loaded";
            STATE.errorMessage = "";
            render();
            updateHeaderBadge(computeUnreadCount());
        },
        (error) => {
            console.error("[Notifications] subscribeToUserNotifications error:", error);
            STATE.status = "error";
            STATE.errorMessage = "Unable to load notifications.";
            render();
            notify("Unable to load notifications.", "error");
        }
    );
}

/* ==========================================
   AUTH — reuse NovaLayout's resolved state
   ------------------------------------------
   layout.js already owns the single
   onAuthStateChanged listener for this page.
   notifications.js listens for its lifecycle
   events instead of creating a second,
   conflicting listener — same pattern as
   projects.js.
========================================== */
function handleAuthResolved(user) {
    STATE.currentUser = user || null;

    if (!STATE.currentUser) {
        stopSubscription();
        STATE.allNotifications = [];
        STATE.status = "idle";
        render();
        return;
    }

    startSubscription(STATE.currentUser.uid);
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
   CLEANUP
========================================== */
function attachCleanupListeners() {
    window.addEventListener("pagehide", stopSubscription);
    window.addEventListener("beforeunload", stopSubscription);
}

/* ==========================================
   INIT
========================================== */
async function init() {
    await loadDependencies();

    setupTabs();
    attachMarkAllRead();
    attachClearAll();
    setupRetry();
    attachCleanupListeners();
    bootstrapAuth();
}

document.addEventListener("DOMContentLoaded", () => {
    init().catch((error) => {
        console.error("[Notifications] Unhandled error during init():", error);
    });
});
