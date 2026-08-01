"use strict";

/* ==========================================
   Imports
========================================== */

import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

import { db } from "./firebase-config.js";

/* ==========================================
   Collections
========================================== */

const COLLECTIONS = Object.freeze({
  USERS: "users",
  SETTINGS: "settings",
  PROJECTS: "projects",
  WORKSPACES: "workspaces",
});

/* ==========================================
   Helpers
========================================== */

function userRef(uid) {
  return doc(db, COLLECTIONS.USERS, uid);
}

function subDocRef(uid, subCollection, docId) {
  return doc(db, COLLECTIONS.USERS, uid, subCollection, docId);
}

function settingsRef(uid) {
  return subDocRef(uid, COLLECTIONS.SETTINGS, "preferences");
}

function projectRef(uid, projectId) {
  return subDocRef(uid, COLLECTIONS.PROJECTS, projectId);
}

function workspaceRef(uid, workspaceId) {
  return subDocRef(uid, COLLECTIONS.WORKSPACES, workspaceId);
}

function createResponse(success, data = {}) {
  return {
    success,
    data: data.data ?? null,
    exists: data.exists ?? false,
    error: data.error ?? null,
    code: data.code ?? null,
  };
}

async function runOperation(operation) {
  try {
    return await operation();
  } catch (error) {
    return createResponse(false, {
      error: error.message,
      code: error.code,
    });
  }
}

async function setDocument(ref, data, { includeCreatedAt = false } = {}) {
  const payload = {
    ...data,
    updatedAt: serverTimestamp(),
  };

  if (includeCreatedAt) {
    payload.createdAt = serverTimestamp();
  }

  await setDoc(ref, payload, { merge: true });
}

async function updateDocument(ref, data) {
  await updateDoc(ref, {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

async function fetchDocumentResponse(ref) {
  const snapshot = await getDoc(ref);

  return createResponse(true, {
    data: snapshot.exists() ? snapshot.data() : null,
    exists: snapshot.exists(),
  });
}

/* ==========================================
   Create User
========================================== */

export async function createUser(uid, userData) {
  return runOperation(async () => {
    await setDocument(userRef(uid), userData, { includeCreatedAt: true });
    return createResponse(true);
  });
}

/* ==========================================
   Get User
========================================== */

export async function getUser(uid) {
  return runOperation(() => fetchDocumentResponse(userRef(uid)));
}

/* ==========================================
   Update User
========================================== */

export async function updateUser(uid, userData) {
  return runOperation(async () => {
    await updateDocument(userRef(uid), userData);
    return createResponse(true);
  });
}

/* ==========================================
   User Exists
========================================== */

export async function userExists(uid) {
  return runOperation(async () => {
    const snapshot = await getDoc(userRef(uid));
    return createResponse(true, { exists: snapshot.exists() });
  });
}

/* ==========================================
   User Settings
========================================== */

export async function saveUserSettings(uid, settings) {
  return runOperation(async () => {
    await setDocument(settingsRef(uid), settings);
    return createResponse(true);
  });
}

/* ==========================================
   Get User Settings
========================================== */

export async function getUserSettings(uid) {
  return runOperation(() => fetchDocumentResponse(settingsRef(uid)));
}

/* ==========================================
   Delete User
========================================== */

export async function deleteUserDocument(uid) {
  throw new Error("deleteUserDocument() is not implemented yet.");
}

/* ==========================================
   Create Project
========================================== */

export async function createProject(uid, projectId, projectData) {
  return runOperation(async () => {
    await setDocument(projectRef(uid, projectId), projectData, {
      includeCreatedAt: true,
    });
    return createResponse(true);
  });
}

/* ==========================================
   Get Project
========================================== */

export async function getProject(uid, projectId) {
  return runOperation(() => fetchDocumentResponse(projectRef(uid, projectId)));
}

/* ==========================================
   Update Project
========================================== */

export async function updateProject(uid, projectId, projectData) {
  return runOperation(async () => {
    await updateDocument(projectRef(uid, projectId), projectData);
    return createResponse(true);
  });
}

/* ==========================================
   Delete Project
========================================== */

export async function deleteProject(uid, projectId) {
  throw new Error("deleteProject() is not implemented yet.");
}

/* ==========================================
   Create Workspace
========================================== */

export async function createWorkspace(uid, workspaceId, workspaceData) {
  return runOperation(async () => {
    await setDocument(workspaceRef(uid, workspaceId), workspaceData, {
      includeCreatedAt: true,
    });
    return createResponse(true);
  });
}

/* ==========================================
   Get Workspace
========================================== */

export async function getWorkspace(uid, workspaceId) {
  return runOperation(() =>
    fetchDocumentResponse(workspaceRef(uid, workspaceId)),
  );
}

/* ==========================================
   Update Workspace
========================================== */

export async function updateWorkspace(uid, workspaceId, workspaceData) {
  return runOperation(async () => {
    await updateDocument(workspaceRef(uid, workspaceId), workspaceData);
    return createResponse(true);
  });
}

/* ==========================================
   Delete Workspace
========================================== */

export async function deleteWorkspace(uid, workspaceId) {
  throw new Error("deleteWorkspace() is not implemented yet.");
}
