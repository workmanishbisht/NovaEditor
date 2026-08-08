"use strict";

/* ==========================================
   Imports
========================================== */

import {
  GoogleAuthProvider,
  GithubAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  updateProfile,
  deleteUser,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import { auth } from "./firebase-config.js";

/* ==========================================
   Providers
========================================== */

const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: "select_account",
});

googleProvider.addScope("profile");
googleProvider.addScope("email");

const githubProvider = new GithubAuthProvider();

githubProvider.setCustomParameters({
  allow_signup: "true",
});

githubProvider.addScope("read:user");
githubProvider.addScope("user:email");

/* ==========================================
   Friendly Error Messages
========================================== */

const AUTH_ERROR_MESSAGES = Object.freeze({
  "auth/popup-closed-by-user":
    "Sign-in was cancelled before it could complete.",
  "auth/popup-blocked":
    "Your browser blocked the sign-in popup. Please allow popups and try again.",
  "auth/network-request-failed":
    "Network error. Please check your connection and try again.",
  "auth/too-many-requests":
    "Too many attempts. Please wait a moment and try again.",
  "auth/account-exists-with-different-credential":
    "An account already exists with this email using a different sign-in method.",
  "auth/user-disabled":
    "This account has been disabled. Please contact support.",
  "auth/invalid-credential":
    "Invalid credentials. Please try again.",
  "auth/internal-error":
    "Something went wrong. Please try again.",
});

const DEFAULT_AUTH_ERROR_MESSAGE = "Authentication failed.";

/**
 * Converts a raw Firebase auth error into a friendly, UI-safe message.
 * Falls back to a generic message for unmapped error codes.
 */
function getAuthError(error) {
  const code = error?.code ?? null;

  const message = code && AUTH_ERROR_MESSAGES[code]
    ? AUTH_ERROR_MESSAGES[code]
    : DEFAULT_AUTH_ERROR_MESSAGE;

  return { message, code };
}

/* ==========================================
   Helpers
========================================== */

function createResponse(success, data = {}) {
  const { user = null, error = null, code = null, ...meta } = data;

  return {
    success,
    user,
    error,
    code,
    ...meta,
  };
}

function createErrorResponse(error, data = {}) {
  const { message, code } = getAuthError(error);

  return createResponse(false, {
    ...data,
    error: message,
    code,
  });
}

async function signIn(provider) {
  try {
    const result = await signInWithPopup(auth, provider);

    return createResponse(true, {
      user: result.user,
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

/* ==========================================
   Google Login
========================================== */

export function loginWithGoogle() {
  return signIn(googleProvider);
}

/* ==========================================
   GitHub Login
========================================== */

export function loginWithGithub() {
  return signIn(githubProvider);
}

/* ==========================================
   Logout
========================================== */

export async function logout() {
  try {
    await signOut(auth);

    return createResponse(true);
  } catch (error) {
    return createErrorResponse(error);
  }
}

/**
 * Convenience wrapper for UI code that wants "sign out and leave the
 * protected page" in one call. Uses replace() so dashboard.html /
 * editor.html do not remain in browser history after logout.
 * Existing callers can keep using logout() directly if they need to
 * handle the result themselves (e.g. to show a toast first).
 */
export async function logoutAndRedirect() {
  const result = await logout();

  if (result.success) {
    redirectToLanding();
  }

  return result;
}

/* ==========================================
   Current User
========================================== */

export function getCurrentUser() {
  return auth.currentUser ?? null;
}

/* ==========================================
   Session
========================================== */

export function checkSession() {
  return new Promise((resolve) => {
    let unsubscribe = null;

    const cleanup = () => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    };

    unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        cleanup();
        resolve(user ?? null);
      },
      () => {
        // Ensure the listener is always released, even if
        // onAuthStateChanged itself errors out.
        cleanup();
        resolve(null);
      }
    );
  });
}

/* ==========================================
   Auth Listener
========================================== */

export function onAuthStateChangedListener(callback) {
  return onAuthStateChanged(auth, callback);
}

/* ==========================================
   Auth Listener — compatibility alias
   ------------------------------------------
   layout.js (and other consumers) look for
   `onAuthStateChange`, not
   `onAuthStateChangedListener`. Both are kept:
   this one is a thin wrapper around the same
   underlying Firebase `onAuthStateChanged`
   call so nothing about the original listener
   is duplicated or diverges — it just gives
   external code the name it expects, and
   returns the unsubscribe function Firebase
   hands back.
========================================== */

export function onAuthStateChange(callback) {
  return onAuthStateChanged(auth, callback);
}

/* ==========================================
   SECURITY: Centralized Route Guard
   ------------------------------------------
   Single source of truth for "is there a real
   Firebase Authentication session right now".
   dashboard.js and editor.js must use these
   helpers instead of inventing their own auth
   checks or trusting localStorage/sessionStorage/
   custom "isLoggedIn" flags.
========================================== */

/**
 * Resolves once Firebase Auth has finished restoring its session
 * (never before), with the current user or null. This is the only
 * function in the app that should be treated as the authoritative
 * "auth state loading vs. resolved" boundary — it deliberately reuses
 * checkSession()'s single-shot onAuthStateChanged listener so there is
 * exactly one code path for "wait for Firebase to tell us who's
 * signed in."
 */
export function getAuthenticatedUser() {
  return checkSession();
}

/**
 * Boolean convenience check. Still waits for auth state to settle
 * before answering, so callers never get a false "not authenticated"
 * during the brief window before Firebase restores the session.
 */
export async function isAuthenticated() {
  const user = await getAuthenticatedUser();
  return !!user;
}

/**
 * Security-critical redirect used whenever an unauthenticated visitor
 * must leave a protected page. Uses replace() — never href — so the
 * protected page is dropped from browser history and pressing "back"
 * cannot reveal it again.
 *
 * NOTE: dashboard.html and editor.html both live under /pages/, so the
 * root landing page must be addressed as "../index.html" here — a bare
 * "index.html" would resolve to the non-existent /pages/index.html.
 */
export function redirectToLanding() {
  window.location.replace("../index.html");
}

/**
 * Guard for protected pages (dashboard.html, editor.html).
 *
 * Waits for Firebase Auth initialization, then either:
 *   - resolves with the authenticated user, or
 *   - redirects to index.html and resolves null.
 *
 * Callers MUST treat a null return as "stop here": do not render UI,
 * do not query Firestore, do not initialize Monaco, etc. This is what
 * prevents protected data from ever being requested before an auth
 * check completes.
 */
export async function requireAuth() {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirectToLanding();
    return null;
  }

  return user;
}

/**
 * Guard for login.html: if a session already exists, the caller
 * should send the user onward instead of showing the login form
 * again. This helper only resolves the user (or null) — it does not
 * redirect itself, because login.js has extra business logic
 * (e.g. "has the user finished setup?") that decides *where*
 * an already-authenticated visitor should land.
 */
export async function redirectIfAuthenticated() {
  return getAuthenticatedUser();
}

/* ==========================================
   Update Profile
========================================== */

export async function updateUserProfile(profile) {
  try {
    if (!auth.currentUser) {
      return createResponse(false, {
        error: "No authenticated user found.",
        code: "auth/no-current-user",
      });
    }

    await updateProfile(auth.currentUser, profile);

    return createResponse(true, {
      user: auth.currentUser,
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

/* ==========================================
   Delete Account
========================================== */

export async function deleteAccount() {
  try {
    if (!auth.currentUser) {
      return createResponse(false, {
        error: "No authenticated user found.",
        code: "auth/no-current-user",
      });
    }

    /*
      Firebase requires a recent login before allowing account
      deletion. Surface this as a friendly, actionable message
      instead of the raw Firebase error.
    */

    await deleteUser(auth.currentUser);

    return createResponse(true);
  } catch (error) {
    if (error?.code === "auth/requires-recent-login") {
      return createResponse(false, {
        error: "Please sign in again before deleting your account.",
        code: error.code,
      });
    }

    return createErrorResponse(error);
  }
}

/* ==========================================
   Exports
========================================== */

export const providers = Object.freeze({
  google: googleProvider,
  github: githubProvider,
});