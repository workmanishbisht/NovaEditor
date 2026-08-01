"use strict";

/* ==========================================
   DOM Elements
========================================== */

const googleBtn = document.querySelector(".google-btn");
const githubBtn = document.querySelector(".github-btn");

const loginButtons = document.querySelectorAll(".login-buttons button");

/* ==========================================
   Config
========================================== */

const CONFIG = {
  redirectDelay: 800,
  loadingText: "Connecting...",
  dashboardPage: "../pages/dashboard.html",
  setupPage: "../pages/setup.html",
};

/* ==========================================
   State
========================================== */

const state = {
  loading: false,
};

/* ==========================================
   Helpers
========================================== */

function isLoading() {
  return state.loading;
}

function setLoading(value) {
  state.loading = value;
}

function disableButtons() {
  loginButtons.forEach((button) => {
    button.disabled = true;
    button.classList.add("is-loading");
  });
}

function enableButtons() {
  loginButtons.forEach((button) => {
    button.disabled = false;
    button.classList.remove("is-loading");
  });
}

function setButtonLoading(button) {
  if (!button) return;

  if (!button.dataset.original) {
    button.dataset.original = button.innerHTML;
  }

  button.innerHTML = `
      <i class="ri-loader-4-line ri-spin"></i>
      <span>${CONFIG.loadingText}</span>
  `;
}

function restoreButton(button) {
  if (!button) return;

  if (button.dataset.original) {
    button.innerHTML = button.dataset.original;
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/* ==========================================
   Toast
========================================== */

function showToast(message, type = "info") {
  if (typeof window.showToast === "function") {
    window.showToast(message, type);
    return;
  }

  console.warn("Toast system not initialized.");
  console.log(`[${type.toUpperCase()}] ${message}`);
}

/* ==========================================
   Loading Manager
========================================== */

function startLoading(button) {
  if (isLoading()) return false;

  setLoading(true);

  disableButtons();

  setButtonLoading(button);

  return true;
}

function stopLoading(button) {
  restoreButton(button);

  enableButtons();

  setLoading(false);
}

/* ==========================================
   Authentication
========================================== */

async function authenticate(provider) {
  const allowedProviders = ["google", "github"];

  if (!allowedProviders.includes(provider)) {
    throw new Error("Unsupported provider.");
  }

  /*
      Firebase Placeholder

      Google

      await signInWithPopup(auth, googleProvider);

      GitHub

      await signInWithPopup(auth, githubProvider);

  */

  await wait(1500);

  return {
    success: true,
    provider,
  };
}

/* ==========================================
   Google Login
========================================== */

async function handleGoogleLogin() {
  if (!startLoading(googleBtn)) return;

  showToast("Signing in with Google...", "loading");

  try {
    const result = await authenticate("google");

    if (result.success) {
      showToast("Google login successful.", "success");

      await wait(CONFIG.redirectDelay);

      /*
          Redirect

          window.location.href = CONFIG.dashboardPage;
      */
    }
  } catch (error) {
    console.error(error);

    showToast("Google authentication failed.", "error");
  } finally {
    stopLoading(googleBtn);
  }
}

/* ==========================================
   GitHub Login
========================================== */

async function handleGithubLogin() {
  if (!startLoading(githubBtn)) return;

  showToast("Signing in with GitHub...", "loading");

  try {
    const result = await authenticate("github");

    if (result.success) {
      showToast("GitHub login successful.", "success");

      await wait(CONFIG.redirectDelay);

      /*
          Redirect

          window.location.href = CONFIG.dashboardPage;
      */
    }
  } catch (error) {
    console.error(error);

    showToast("GitHub authentication failed.", "error");
  } finally {
    stopLoading(githubBtn);
  }
}

/* ==========================================
   Event Listeners
========================================== */

if (googleBtn) {
  googleBtn.addEventListener("click", handleGoogleLogin);
}

if (githubBtn) {
  githubBtn.addEventListener("click", handleGithubLogin);
}

/* ==========================================
   Session Manager
========================================== */

async function checkSession() {
  /*
    Firebase Placeholder

    const user = auth.currentUser;

    if (user) {
      redirectUser(user);
    }

  */

  return null;
}

/* ==========================================
   First Login Check
========================================== */

async function checkFirstLogin(user) {
  /*
    Firebase Placeholder

    const doc = await getDoc(...);

    if (!doc.exists()) {

        return true;

    }

    return false;

  */

  return false;
}

/* ==========================================
   Redirect Manager
========================================== */

async function redirectUser(user = null) {
  const isFirstLogin = await checkFirstLogin(user);

  if (isFirstLogin) {
    showToast("Welcome to Nova Editor!", "success");

    await wait(CONFIG.redirectDelay);

    /*
      window.location.href = CONFIG.setupPage;
    */

    return;
  }

  showToast("Redirecting to dashboard...", "success");

  await wait(CONFIG.redirectDelay);

  /*
      window.location.href = CONFIG.dashboardPage;
  */
}

/* ==========================================
   Keyboard Accessibility
========================================== */

function handleKeyboard(event) {
  if (event.key !== "Enter") return;

  const element = document.activeElement;

  if (!element) return;

  if (element.classList.contains("google-btn")) {
    handleGoogleLogin();
  }

  if (element.classList.contains("github-btn")) {
    handleGithubLogin();
  }
}

document.addEventListener("keydown", handleKeyboard);

/* ==========================================
   Focus Manager
========================================== */

window.addEventListener("load", () => {
  if (googleBtn) {
    googleBtn.focus();
  }
});

/* ==========================================
   Initialize
========================================== */

(async function init() {
  try {
    await checkSession();
  } catch (error) {
    console.error("Initialization failed:", error);
  }
})();

/* ==========================================
   Cleanup
========================================== */

window.addEventListener("beforeunload", () => {
  setLoading(false);
});

/* ==========================================
   Export (Future)
========================================== */

window.NovaAuth = {
  google: handleGoogleLogin,

  github: handleGithubLogin,

  session: checkSession,

  redirect: redirectUser,
};