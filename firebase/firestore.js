"use strict";

/* ==========================================
   Firestore
========================================== */

import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  addDoc,
  getDocs,
  query,
  where,
  limit,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

import { db } from "./firebase-config.js";

/* ==========================================
   Collections
========================================== */

const COLLECTIONS = Object.freeze({
  USERS: "users",
  WORKSPACES: "workspaces",
  PROJECTS: "projects",
  NOTIFICATIONS: "notifications",
});

/* ==========================================
   Sub Collections
========================================== */

const SUB_COLLECTIONS = Object.freeze({
  PREFERENCES: "preferences",
});

/* ==========================================
   Preference Documents
========================================== */

const PREFERENCE_DOCS = Object.freeze({
  EDITOR: "editor",
  AI: "ai",
});

/* ==========================================
   Local device preferences
   ------------------------------------------
   layout.js calls getCurrentWorkspaceId()/
   setCurrentWorkspaceId(id) with NO uid
   argument, so this is intentionally a
   per-browser preference (like the theme
   toggle), not a per-user Firestore field.
   If you want "current workspace" to be
   scoped per-account instead, this needs a
   uid parameter and a write to the user doc.
========================================== */

const CURRENT_WORKSPACE_STORAGE_KEY = "novaeditor:currentWorkspaceId";

/* ==========================================
   Response
========================================== */

function createResponse(success, { data = null, exists = false, error = null, code = null } = {}) {
  return { success, data, exists, error, code };
}

/* ==========================================
   Error Wrapper
========================================== */

async function run(action) {
  try {
    return await action();
  } catch (error) {
    console.error(error);
    return createResponse(false, {
      error: error.message,
      code: error.code,
    });
  }
}

/* ==========================================
   References
========================================== */

function userRef(uid) {
  return doc(db, COLLECTIONS.USERS, uid);
}

function workspaceRef(workspaceId) {
  return doc(db, COLLECTIONS.WORKSPACES, workspaceId);
}

function projectRef(projectId) {
  return doc(db, COLLECTIONS.PROJECTS, projectId);
}

function editorPreferenceRef(uid) {
  return doc(db, COLLECTIONS.USERS, uid, SUB_COLLECTIONS.PREFERENCES, PREFERENCE_DOCS.EDITOR);
}

function aiPreferenceRef(uid) {
  return doc(db, COLLECTIONS.USERS, uid, SUB_COLLECTIONS.PREFERENCES, PREFERENCE_DOCS.AI);
}

function notificationsCollection() {
  return collection(db, COLLECTIONS.NOTIFICATIONS);
}

/* ==========================================
   Helpers
========================================== */

async function setDocument(reference, data, { merge = true, includeCreatedAt = false } = {}) {
  const payload = {
    ...data,
    updatedAt: serverTimestamp(),
  };

  if (includeCreatedAt) {
    payload.createdAt = serverTimestamp();
  }

  await setDoc(reference, payload, { merge });
}

async function updateDocument(reference, data) {
  await updateDoc(reference, {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

async function getDocument(reference) {
  const snapshot = await getDoc(reference);

  return createResponse(true, {
    exists: snapshot.exists(),
    data: snapshot.exists() ? snapshot.data() : null,
  });
}

/* ==========================================
   CREATE USER
========================================== */

export async function createUser(uid, userData) {
  return run(async () => {
    await setDocument(
      userRef(uid),
      { uid, ...userData },
      { includeCreatedAt: true }
    );

    return createResponse(true);
  });
}

/* ==========================================
   GET USER
========================================== */

export async function getUser(uid) {
  return run(async () => {
    return await getDocument(userRef(uid));
  });
}

/* ==========================================
   GET USER DATA — alias expected by layout.js
   ------------------------------------------
   layout.js imports "getUserData" (not
   "getUser"). Same wrapped response shape as
   every other read in this module — layout.js
   is responsible for unwrapping .data, same
   as it does for getUserWorkspaces().
========================================== */

export const getUserData = getUser;

/* ==========================================
   UPDATE USER
========================================== */

export async function updateUser(uid, userData) {
  return run(async () => {
    await setDocument(userRef(uid), userData, { merge: true });
    return createResponse(true);
  });
}

/* ==========================================
   USER EXISTS
========================================== */

export async function userExists(uid) {
  return run(async () => {
    const snapshot = await getDoc(userRef(uid));
    return createResponse(true, { exists: snapshot.exists() });
  });
}

/* ==========================================
   DELETE USER
========================================== */

export async function deleteUser(uid) {
  return run(async () => {
    await deleteDoc(userRef(uid));
    return createResponse(true);
  });
}

/* ==========================================
   GET ALL USERS
========================================== */

export async function getUsers() {
  return run(async () => {
    const snapshot = await getDocs(collection(db, COLLECTIONS.USERS));
    const users = [];

    snapshot.forEach((doc) => {
      users.push({ id: doc.id, ...doc.data() });
    });

    return createResponse(true, { data: users });
  });
}

/* ==========================================
   USERNAME
========================================== */

function usersCollection() {
  return collection(db, COLLECTIONS.USERS);
}

/* ==========================================
   CHECK USERNAME
========================================== */

export async function isUsernameAvailable(username) {
  return run(async () => {
    const value = String(username).trim().toLowerCase();

    if (!value) {
      return createResponse(false, { error: "Username is required." });
    }

    const q = query(usersCollection(), where("username", "==", value), limit(1));
    const snapshot = await getDocs(q);

    return createResponse(true, {
      data: { available: snapshot.empty },
    });
  });
}

/* ==========================================
   GET USER BY USERNAME
========================================== */

export async function getUserByUsername(username) {
  return run(async () => {
    const value = String(username).trim().toLowerCase();
    const q = query(usersCollection(), where("username", "==", value), limit(1));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return createResponse(true, { exists: false, data: null });
    }

    const document = snapshot.docs[0];

    return createResponse(true, {
      exists: true,
      data: { id: document.id, ...document.data() },
    });
  });
}

/* ==========================================
   UPDATE USERNAME
========================================== */

export async function updateUsername(uid, username) {
  return run(async () => {
    const check = await isUsernameAvailable(username);

    if (!check.success) {
      return check;
    }

    if (!check.data.available) {
      return createResponse(false, { error: "Username already exists." });
    }

    await setDocument(
      userRef(uid),
      { username: username.trim().toLowerCase() },
      { merge: true }
    );

    return createResponse(true);
  });
}

/* ==========================================
   WORKSPACES COLLECTION
========================================== */

function workspacesCollection() {
  return collection(db, COLLECTIONS.WORKSPACES);
}

/* ==========================================
   CREATE WORKSPACE
========================================== */

export async function createWorkspace(workspaceData) {
  return run(async () => {
    const payload = {
      workspaceName: workspaceData.workspaceName,
      defaultProject: workspaceData.defaultProject || "",
      experience: workspaceData.experience || "Beginner",
      ownerUid: workspaceData.ownerUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const reference = await addDoc(workspacesCollection(), payload);

    return createResponse(true, {
      data: { id: reference.id, ...payload },
    });
  });
}

/* ==========================================
   GET WORKSPACE
========================================== */

export async function getWorkspace(workspaceId) {
  return run(async () => {
    return await getDocument(workspaceRef(workspaceId));
  });
}

/* ==========================================
   UPDATE WORKSPACE
========================================== */

export async function updateWorkspace(workspaceId, workspaceData) {
  return run(async () => {
    await setDocument(workspaceRef(workspaceId), workspaceData, { merge: true });
    return createResponse(true);
  });
}

/* ==========================================
   DELETE WORKSPACE
========================================== */

export async function deleteWorkspace(workspaceId) {
  return run(async () => {
    await deleteDoc(workspaceRef(workspaceId));
    return createResponse(true);
  });
}

/* ==========================================
   GET USER WORKSPACES
========================================== */

export async function getUserWorkspaces(uid) {
  return run(async () => {
    const q = query(workspacesCollection(), where("ownerUid", "==", uid));
    const snapshot = await getDocs(q);
    const workspaces = [];

    snapshot.forEach((document) => {
      workspaces.push({ id: document.id, ...document.data() });
    });

    return createResponse(true, { data: workspaces });
  });
}

/* ==========================================
   CURRENT WORKSPACE ID (per-browser)
   ------------------------------------------
   See the note near CURRENT_WORKSPACE_STORAGE_KEY
   above. Deliberately unwrapped (raw string or
   null / raw boolean) — layout.js compares the
   return value of getCurrentWorkspaceId()
   directly against workspace.id, it does not
   expect a {success,data,...} envelope here.
========================================== */

export function getCurrentWorkspaceId() {
  try {
    return localStorage.getItem(CURRENT_WORKSPACE_STORAGE_KEY);
  } catch (error) {
    console.error("[firestore] getCurrentWorkspaceId failed:", error);
    return null;
  }
}

export function setCurrentWorkspaceId(workspaceId) {
  try {
    if (workspaceId) {
      localStorage.setItem(CURRENT_WORKSPACE_STORAGE_KEY, workspaceId);
    } else {
      localStorage.removeItem(CURRENT_WORKSPACE_STORAGE_KEY);
    }
    return true;
  } catch (error) {
    console.error("[firestore] setCurrentWorkspaceId failed:", error);
    return false;
  }
}

/* ==========================================
   EDITOR PREFERENCES
========================================== */

export async function saveEditorPreferences(uid, preferences) {
  return run(async () => {
    await setDocument(editorPreferenceRef(uid), preferences, { merge: true });
    return createResponse(true);
  });
}

export async function getEditorPreferences(uid) {
  return run(async () => {
    return await getDocument(editorPreferenceRef(uid));
  });
}

/* ==========================================
   AI PREFERENCES
========================================== */

export async function saveAIPreferences(uid, preferences) {
  return run(async () => {
    await setDocument(aiPreferenceRef(uid), preferences, { merge: true });
    return createResponse(true);
  });
}

export async function getAIPreferences(uid) {
  return run(async () => {
    return await getDocument(aiPreferenceRef(uid));
  });
}

/* ==========================================
   ALL PREFERENCES
========================================== */

export async function getUserPreferences(uid) {
  return run(async () => {
    const [editor, ai] = await Promise.all([
      getEditorPreferences(uid),
      getAIPreferences(uid),
    ]);

    return createResponse(true, {
      data: {
        editor: editor.success ? editor.data : null,
        ai: ai.success ? ai.data : null,
      },
    });
  });
}

/* ==========================================
   SAVE ALL PREFERENCES
========================================== */

export async function saveAllPreferences(uid, { editor = {}, ai = {} }) {
  return run(async () => {
    await Promise.all([
      saveEditorPreferences(uid, editor),
      saveAIPreferences(uid, ai),
    ]);

    return createResponse(true);
  });
}

/* ==========================================
   PROJECTS
========================================== */

function projectsCollection() {
  return collection(db, COLLECTIONS.PROJECTS);
}

/* ==========================================
   CREATE PROJECT
========================================== */

export async function createProject(projectData) {
  return run(async () => {
    const payload = {
      name: projectData.name,
      description: projectData.description || "",
      language: projectData.language || "html",
      framework: projectData.framework || "none",
      template: projectData.template || "blank",
      workspaceId: projectData.workspaceId,
      ownerUid: projectData.ownerUid,
      visibility: projectData.visibility || "private",
      initializeGit: projectData.initializeGit ?? true,
      createReadme: projectData.createReadme ?? true,
      createDefaultFiles: projectData.createDefaultFiles ?? true,
      status: "active",
      starred: false,
      archived: false,
      totalFiles: 0,
      totalFolders: 0,
      lastOpenedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const reference = await addDoc(projectsCollection(), payload);
    return createResponse(true, {
      data: {
        id: reference.id,
        ...payload,
      },
    });
  });
}

/* ==========================================
   GET PROJECT
========================================== */

export async function getProject(projectId) {
  return run(async () => {
    return await getDocument(projectRef(projectId));
  });
}

/* ==========================================
   UPDATE PROJECT
========================================== */

export async function updateProject(projectId, projectData) {
  return run(async () => {
    await setDocument(projectRef(projectId), projectData, { merge: true });
    return createResponse(true);
  });
}

/* ==========================================
   DELETE PROJECT
========================================== */

export async function deleteProject(projectId) {
  return run(async () => {
    await deleteDoc(projectRef(projectId));
    return createResponse(true);
  });
}

/* ==========================================
   GET USER PROJECTS
========================================== */

export async function getUserProjects(uid) {
  return run(async () => {
    const q = query(projectsCollection(), where("ownerUid", "==", uid));
    const snapshot = await getDocs(q);
    const projects = [];

    snapshot.forEach((document) => {
      projects.push({ id: document.id, ...document.data() });
    });

    return createResponse(true, { data: projects });
  });
}

/* ==========================================
   NOTIFICATIONS
   ------------------------------------------
   layout.js expects a raw number back (it
   does `typeof count !== "number"`), not the
   {success,data,...} envelope used elsewhere
   in this file — so this one intentionally
   returns a plain integer.
========================================== */

export async function getUnreadNotificationCount(uid) {
  try {
    const q = query(
      notificationsCollection(),
      where("recipientUid", "==", uid),
      where("read", "==", false)
    );
    const snapshot = await getDocs(q);
    return snapshot.size;
  } catch (error) {
    console.error("[firestore] getUnreadNotificationCount failed:", error);
    return 0;
  }
}

/* ==========================================
   EXPORTS COMPLETE
========================================== */