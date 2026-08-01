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

const githubProvider = new GithubAuthProvider();

githubProvider.setCustomParameters({
  allow_signup: "true",
});

/* ==========================================
   Helpers
========================================== */

function createResponse(success, data = {}) {
  return {
    success,
    user: data.user ?? null,
    error: data.error ?? null,
    code: data.code ?? null,
  };
}

async function signIn(provider) {
  try {
    const result = await signInWithPopup(auth, provider);

    return createResponse(true, {
      user: result.user,
    });
  } catch (error) {
    return createResponse(false, {
      error: error.message,
      code: error.code,
    });
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
    return createResponse(false, {
      error: error.message,
      code: error.code,
    });
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
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user ?? null);
    });
  });
}

/* ==========================================
   Auth Listener
========================================== */

export function onAuthStateChangedListener(callback) {
  return onAuthStateChanged(auth, callback);
}

/* ==========================================
   Update Profile
========================================== */

export async function updateUserProfile(profile) {
  try {
    if (!auth.currentUser) {
      throw new Error("No authenticated user found.");
    }

    await updateProfile(auth.currentUser, profile);

    return createResponse(true);
  } catch (error) {
    return createResponse(false, {
      error: error.message,
      code: error.code,
    });
  }
}

/* ==========================================
   Delete Account
========================================== */

export async function deleteAccount() {
  try {
    if (!auth.currentUser) {
      throw new Error("No authenticated user found.");
    }

    /*
      Requires recent authentication.
    */

    await deleteUser(auth.currentUser);

    return createResponse(true);
  } catch (error) {
    return createResponse(false, {
      error: error.message,
      code: error.code,
    });
  }
}

/* ==========================================
   Exports
========================================== */

export const providers = Object.freeze({
  google: googleProvider,
  github: githubProvider,
});
