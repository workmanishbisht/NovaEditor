"use strict";

/* ==========================================
   Toast Configuration
========================================== */

const TOAST_CONFIG = Object.freeze({
    position: "top-right",
    duration: 3500,
    maxToasts: 5,
    animationDuration: 300,
});

/* ==========================================
   Toast Types
========================================== */

const TOAST_TYPES = Object.freeze({
    success: {
        icon: "ri-checkbox-circle-fill",
        className: "toast-success",
    },

    error: {
        icon: "ri-close-circle-fill",
        className: "toast-error",
    },

    warning: {
        icon: "ri-error-warning-fill",
        className: "toast-warning",
    },

    info: {
        icon: "ri-information-fill",
        className: "toast-info",
    },

    loading: {
        icon: "ri-loader-4-line ri-spin",
        className: "toast-loading",
    },
});

/* ==========================================
   State
========================================== */

const toastQueue = [];

let toastContainer = null;

/* ==========================================
   Create Container
========================================== */

function createContainer() {
    if (toastContainer) {
        return toastContainer;
    }

    toastContainer = document.createElement("div");

    toastContainer.className = "toast-container";

    document.body.appendChild(toastContainer);

    return toastContainer;
}

/* ==========================================
   Helpers
========================================== */

function getToastType(type) {
    return TOAST_TYPES[type] || TOAST_TYPES.info;
}

function createId() {
    return `toast-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 9)}`;
}

/* ==========================================
   Create Toast Element
========================================== */

function createToast(message, type = "info") {
    const toastType = getToastType(type);

    const toast = document.createElement("div");

    toast.className = `toast ${toastType.className}`;

    toast.dataset.id = createId();

    toast.innerHTML = `
        <div class="toast-icon">
            <i class="${toastType.icon}"></i>
        </div>

        <div class="toast-content">
            <div class="toast-message">
                ${message}
            </div>

            <div class="toast-progress"></div>
        </div>

        <button
            class="toast-close"
            aria-label="Close Toast"
        >
            <i class="ri-close-line"></i>
        </button>
    `;

    return toast;
}

/* ==========================================
   Remove Toast
========================================== */

function removeToast(toast) {
    if (!toast) return;

    toast.classList.add("toast-hide");

    setTimeout(() => {
        toast.remove();

        processQueue();
    }, TOAST_CONFIG.animationDuration);
}

/* ==========================================
   Auto Remove
========================================== */

function autoRemoveToast(toast, type) {
    if (type === "loading") {
        return;
    }

    setTimeout(() => {
        removeToast(toast);
    }, TOAST_CONFIG.duration);
}

/* ==========================================
   Close Button
========================================== */

function attachCloseEvent(toast) {
    const closeButton = toast.querySelector(".toast-close");

    if (!closeButton) return;

    closeButton.addEventListener("click", () => {
        removeToast(toast);
    });
}


/* ==========================================
   Queue Manager
========================================== */

function processQueue() {
    const container = createContainer();

    while (
        toastQueue.length > 0 &&
        container.children.length < TOAST_CONFIG.maxToasts
    ) {
        const { message, type } = toastQueue.shift();

        const toast = createToast(message, type);

        container.appendChild(toast);

        requestAnimationFrame(() => {
            toast.classList.add("toast-show");
        });

        attachCloseEvent(toast);

        autoRemoveToast(toast, type);
    }
}

/* ==========================================
   Show Toast
========================================== */

function showToast(message, type = "info") {
    if (!message) return;

    toastQueue.push({
        message,
        type,
    });

    processQueue();
}

/* ==========================================
   Remove All Toasts
========================================== */

function clearToasts() {
    const container = createContainer();

    Array.from(container.children).forEach((toast) => {
        removeToast(toast);
    });

    toastQueue.length = 0;
}

/* ==========================================
   Loading Helpers
========================================== */

function showLoadingToast(message = "Loading...") {
    showToast(message, "loading");
}

function showSuccessToast(message) {
    showToast(message, "success");
}

function showErrorToast(message) {
    showToast(message, "error");
}

function showWarningToast(message) {
    showToast(message, "warning");
}

function showInfoToast(message) {
    showToast(message, "info");
}


/* ==========================================
   Global API
========================================== */

window.showToast = showToast;

window.Toast = Object.freeze({
    show: showToast,
    success: showSuccessToast,
    error: showErrorToast,
    warning: showWarningToast,
    info: showInfoToast,
    loading: showLoadingToast,
    clear: clearToasts,
});

/* ==========================================
   Initialize
========================================== */

document.addEventListener("DOMContentLoaded", () => {
    createContainer();
});

/* ==========================================
   Export (Future)
========================================== */

export {
    showToast,
    showSuccessToast,
    showErrorToast,
    showWarningToast,
    showInfoToast,
    showLoadingToast,
    clearToasts,
};