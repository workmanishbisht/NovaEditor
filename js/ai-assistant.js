/* ==========================================
   AI Assistant — Coming Soon page
========================================== */
import { init } from "./layout.js";

// Ensure layout is initialized (layout.js also listens for DOMContentLoaded)
if (document.readyState === "loading") {
    // layout.js already handles DOMContentLoaded → init()
} else {
    init().catch((err) => {
        console.error("[AI Assistant] Layout init failed:", err);
    });
}

/**
 * Notify Me button
 * Reuses existing toast system when available.
 */
function attachNotifyMe() {
    const btn = document.getElementById("notifyMeBtn");
    if (!btn || btn.dataset.bound === "true") return;
    btn.dataset.bound = "true";

    btn.addEventListener("click", async () => {
        if (btn.dataset.notified === "true") return;

        const message =
            "You're on the list! We'll notify you when AI Assistant is available.";
        let toastShown = false;

        try {
            const toastMod = await import("../components/toast.js");
            if (typeof toastMod.showToast === "function") {
                toastMod.showToast(message, "success");
                toastShown = true;
            }
        } catch (_) {
            // toast module may not exist yet
        }

        if (!toastShown && typeof window.showToast === "function") {
            window.showToast(message, "success");
            toastShown = true;
        }

        if (!toastShown) {
            // Fallback: temporary button state
            const original = btn.innerHTML;
            btn.innerHTML =
                '<i class="ri-check-line" aria-hidden="true"></i> You\'re on the list';
            btn.disabled = true;
            setTimeout(() => {
                btn.innerHTML = original;
                btn.disabled = false;
            }, 2200);
            return;
        }

        btn.dataset.notified = "true";
        btn.innerHTML =
            '<i class="ri-check-line" aria-hidden="true"></i> You\'re on the list';
        btn.disabled = true;
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attachNotifyMe);
} else {
    attachNotifyMe();
}