import {
  loginWithGoogle,
  loginWithGithub,
  logout,
  checkSession,
} from "../firebase/auth.js";

import {
  createUser,
  userExists,
  getUser,
} from "../firebase/firestore.js";

/* ==========================================
   DOM Elements
========================================== */

const googleBtn = document.querySelector(".google-btn");

const githubBtn = document.querySelector(".github-btn");

const loginButtons = document.querySelectorAll(
  ".login-buttons button"
);

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
    throw new Error(
      existsResponse.error || "Unable to verify user."
    );
  }

  /* ----------------------------------------
     First Login
  ---------------------------------------- */

  if (!existsResponse.exists) {
    const createResponse = await createUser(user.uid, {
      uid: user.uid,
      displayName: user.displayName || "",
      email: user.email || "",
      photoURL: user.photoURL || "",
      provider: user.providerData?.[0]?.providerId || "",
      emailVerified: user.emailVerified,
      setupCompleted: false,
      createdBy: "authentication",
    });

    if (!createResponse.success) {
      throw new Error(
        createResponse.error || "Unable to create user."
      );
    }

    showToast("Welcome to Nova Editor!", "success");

    await wait(CONFIG.redirectDelay);

    window.location.replace(CONFIG.setupPage);

    return;
  }

  /* ----------------------------------------
     Existing User
  ---------------------------------------- */

  await redirectUser(user);
}


/* ==========================================
   Google Login
========================================== */

async function handleGoogleLogin() {
  if (!startLoading(googleBtn)) {
    return;
  }

  showToast("Signing in with Google...", "loading");

  try {
    const user = await authenticate("google");

    showToast("Google login successful.", "success");

    await completeLogin(user);

  } catch (error) {

    console.error(error);

    showToast(
      error.message || "Google authentication failed.",
      "error"
    );

  } finally {

    stopLoading(googleBtn);

  }
}

/* ==========================================
   GitHub Login
========================================== */

async function handleGithubLogin() {
  if (!startLoading(githubBtn)) {
    return;
  }

  showToast("Signing in with GitHub...", "loading");

  try {
    const user = await authenticate("github");

    showToast("GitHub login successful.", "success");

    await completeLogin(user);

  } catch (error) {

    console.error(error);

    showToast(
      error.message || "GitHub authentication failed.",
      "error"
    );

  } finally {

    stopLoading(githubBtn);

  }
}

/* ==========================================
   Redirect Manager
========================================== */

async function redirectUser(user) {

  const response = await getUser(user.uid);

  if (!response.success) {
    throw new Error(
      response.error || "Unable to load user profile."
    );
  }

  const userData = response.data;

  await wait(CONFIG.redirectDelay);

  // SECURITY: replace() (never href) for every auth-flow redirect out
  // of the login page, so login.html doesn't linger in browser
  // history. Each branch returns immediately after redirecting so
  // only one redirect can ever fire per call.

  if (!userData) {

    window.location.replace(CONFIG.setupPage);

    return;

  }

  if (!userData.setupCompleted) {

    showToast("Complete your setup first.", "info");

    window.location.replace(CONFIG.setupPage);

    return;

  }

  showToast("Redirecting to dashboard...", "success");

  window.location.replace(CONFIG.dashboardPage);
}

/* ==========================================
   Initialize
   ------------------------------------------
   SECURITY: checkSession() (from auth.js) does
   not resolve until Firebase Auth has finished
   restoring its session — so this never fires
   an early "not logged in" redirect flicker,
   and it never trusts anything other than a
   live Firebase Authentication session. If a
   session exists, the visitor is sent onward
   (setup or dashboard, depending on profile
   state); otherwise they simply remain on the
   login form. No separate/duplicate auth check
   is performed anywhere else in this file.
========================================== */

async function initialize() {

  try {

    const user = await checkSession();

    if (!user) {
      return;
    }

    await redirectUser(user);

  } catch (error) {

    console.error(error);

    showToast(
      error.message || "Unable to restore session.",
      "error"
    );

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
   Keyboard Accessibility
========================================== */

function handleKeyboard(event) {
  if (event.key !== "Enter") {
    return;
  }

  const element = document.activeElement;

  if (!element) {
    return;
  }

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
   Cleanup
========================================== */

window.addEventListener("beforeunload", () => {
  resetLoading();
});

/* ==========================================
   Initialize App
========================================== */

initialize();

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