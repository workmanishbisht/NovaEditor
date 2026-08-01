import {
  loginWithGoogle,
  loginWithGithub,
  logout,
  checkSession,
} from "../firebase/auth.js";

import { createUser, userExists } from "../firebase/firestore.js";

/* ==========================================
   DOM Elements
========================================== */

const googleBtn = document.querySelector(".google-btn");

const githubBtn = document.querySelector(".github-btn");

const loginButtons = document.querySelectorAll(".login-buttons button");

/* ==========================================
   Config
========================================== */

const CONFIG = Object.freeze({
  redirectDelay: 800,
  loadingText: "Connecting...",
  dashboardPage: "../pages/dashboard.html",
  setupPage: "../pages/setup.html",
});

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
  if (isLoading()) {
    return false;
  }

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

function resetLoading() {
  loginButtons.forEach((button) => {
    restoreButton(button);
  });

  enableButtons();

  setLoading(false);
}

/* ==========================================
   Authentication
========================================== */

const AUTH_PROVIDERS = Object.freeze({
  google: loginWithGoogle,
  github: loginWithGithub,
});

async function authenticate(provider) {
  const authProvider = AUTH_PROVIDERS[provider];

  if (!authProvider) {
    throw new Error("Unsupported authentication provider.");
  }

  const result = await authProvider();

  if (!result.success) {
    throw new Error(result.error || "Authentication failed.");
  }

  return result.user;
}

/* ==========================================
   Complete Login
========================================== */

async function completeLogin(user) {
  const existsResponse = await userExists(user.uid);

  if (!existsResponse.success) {
    throw new Error(existsResponse.error || "Unable to verify user.");
  }

  if (!existsResponse.exists) {
    const createResponse = await createUser(user.uid, {
      uid: user.uid,
      displayName: user.displayName || "",
      email: user.email || "",
      photoURL: user.photoURL || "",
      provider: user.providerData?.[0]?.providerId || "",
      emailVerified: user.emailVerified,
      createdBy: "authentication",
    });

    if (!createResponse.success) {
      throw new Error(createResponse.error || "Unable to create user.");
    }

    showToast("Welcome to Nova Editor!", "success");
  }

  await redirectUser(user);
}

/* ==========================================
   Google Login
========================================== */

async function handleGoogleLogin() {
  if (!startLoading(googleBtn)) return;

  showToast("Signing in with Google...", "loading");

  try {
    const user = await authenticate("google");

    showToast("Google login successful.", "success");

    await completeLogin(user);
  } catch (error) {
    console.error(error);

    showToast(error.message || "Google authentication failed.", "error");
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
    const user = await authenticate("github");

    showToast("GitHub login successful.", "success");

    await completeLogin(user);
  } catch (error) {
    console.error(error);

    showToast(error.message || "GitHub authentication failed.", "error");
  } finally {
    stopLoading(githubBtn);
  }
}

/* ==========================================
   First Login Check
========================================== */

async function checkFirstLogin(user) {
  const response = await userExists(user.uid);

  if (!response.success) {
    throw new Error(response.error || "Unable to verify user.");
  }

  return !response.exists;
}

/* ==========================================
   Redirect Manager
========================================== */

async function redirectUser(user) {
  const isFirstLogin = await checkFirstLogin(user);

  await wait(CONFIG.redirectDelay);

  if (isFirstLogin) {
    showToast("Welcome to Nova Editor!", "success");

    window.location.href = CONFIG.setupPage;

    return;
  }

  showToast("Redirecting to dashboard...", "success");

  window.location.href = CONFIG.dashboardPage;
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
   Keyboard Accessibility
========================================== */

function handleKeyboard(event) {
  if (event.key !== "Enter") return;

  const element = document.activeElement;

  if (!element) return;

  if (element.classList.contains("google-btn")) {
    handleGoogleLogin();
    return;
  }

  if (element.classList.contains("github-btn")) {
    handleGithubLogin();
  }
}

document.addEventListener("keydown", handleKeyboard);

/* ==========================================
   Focus Manager
========================================== */

document.addEventListener("DOMContentLoaded", () => {
  googleBtn?.focus();
});

/* ==========================================
   Initialize
========================================== */

async function initialize() {
  try {
    const user = await checkSession();

    if (!user) {
      return;
    }

    showToast("Session found. Redirecting...", "info");

    await redirectUser(user);
  } catch (error) {
    console.error(error);

    showToast(error.message || "Unable to restore session.", "error");
  }
}

initialize();

/* ==========================================
   Cleanup
========================================== */

window.addEventListener("beforeunload", () => {
  resetLoading();
});

/* ==========================================
   Export
========================================== */

window.NovaAuth = Object.freeze({
  google: handleGoogleLogin,
  github: handleGithubLogin,
  logout,
  session: checkSession,
  redirect: redirectUser,
});
