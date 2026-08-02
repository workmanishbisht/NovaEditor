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