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
  orderBy,
  writeBatch,
  runTransaction,
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
  FOLDERS: "folders",
  FILES: "files",
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
   GET USER DATA
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
   CURRENT WORKSPACE ID
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
   EDITOR FILE SYSTEM
========================================== */

function foldersCollection(projectId) {
  return collection(db, COLLECTIONS.PROJECTS, projectId, SUB_COLLECTIONS.FOLDERS);
}

function filesCollection(projectId) {
  return collection(db, COLLECTIONS.PROJECTS, projectId, SUB_COLLECTIONS.FILES);
}

function folderRef(projectId, folderId) {
  return doc(db, COLLECTIONS.PROJECTS, projectId, SUB_COLLECTIONS.FOLDERS, folderId);
}

function fileRef(projectId, fileId) {
  return doc(db, COLLECTIONS.PROJECTS, projectId, SUB_COLLECTIONS.FILES, fileId);
}

/* ==========================================
   VALIDATION
========================================== */

function validateId(value, label) {
  if (!value || typeof value !== "string" || !value.trim()) {
    return createResponse(false, { error: `${label} is required.` });
  }
  return null;
}

function validateName(name) {
  if (!name || typeof name !== "string" || !name.trim()) {
    return createResponse(false, { error: "Name is required." });
  }
  return null;
}

/* ==========================================
   PROJECT COUNTERS (transaction-safe)
========================================== */

async function adjustProjectCounters(projectId, { files = 0, folders = 0 } = {}) {
  const reference = projectRef(projectId);

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) return;

    const data = snapshot.data();
    const currentFiles = data.totalFiles || 0;
    const currentFolders = data.totalFolders || 0;

    transaction.update(reference, {
      totalFiles: Math.max(0, currentFiles + files),
      totalFolders: Math.max(0, currentFolders + folders),
      updatedAt: serverTimestamp(),
    });
  });
}

/* ==========================================
   CREATE FOLDER
========================================== */

/**
 * Create a new folder inside a project.
 * @param {string} projectId
 * @param {{ name: string, parentId?: string|null }} data
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
export async function createFolder(projectId, data) {
  return run(async () => {
    const projectError = validateId(projectId, "Project ID");
    if (projectError) return projectError;

    const nameError = validateName(data?.name);
    if (nameError) return nameError;

    const payload = {
      name: data.name.trim(),
      parentId: data.parentId || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const reference = await addDoc(foldersCollection(projectId), payload);
    await adjustProjectCounters(projectId, { folders: 1 });

    return createResponse(true, {
      data: { id: reference.id, ...payload },
    });
  });
}

/* ==========================================
   GET FOLDERS
========================================== */

/**
 * Get all folders for a project, ordered by name.
 * @param {string} projectId
 * @returns {Promise<{success: boolean, data?: array, error?: string}>}
 */
export async function getFolders(projectId) {
  return run(async () => {
    const projectError = validateId(projectId, "Project ID");
    if (projectError) return projectError;

    const q = query(foldersCollection(projectId), orderBy("name", "asc"));
    const snapshot = await getDocs(q);
    const folders = [];

    snapshot.forEach((document) => {
      folders.push({ id: document.id, ...document.data() });
    });

    return createResponse(true, { data: folders });
  });
}

/* ==========================================
   RENAME FOLDER
========================================== */

/**
 * Rename an existing folder.
 * @param {string} projectId
 * @param {string} folderId
 * @param {string} newName
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function renameFolder(projectId, folderId, newName) {
  return run(async () => {
    const projectError = validateId(projectId, "Project ID");
    if (projectError) return projectError;

    const folderError = validateId(folderId, "Folder ID");
    if (folderError) return folderError;

    const nameError = validateName(newName);
    if (nameError) return nameError;

    await updateDocument(folderRef(projectId, folderId), { name: newName.trim() });
    return createResponse(true);
  });
}

/* ==========================================
   DELETE FOLDER (recursive + atomic batch)
========================================== */

async function collectFolderTree(projectId, folderId) {
  const folderIds = [folderId];
  const fileIds = [];

  const foldersSnap = await getDocs(foldersCollection(projectId));
  const filesSnap = await getDocs(filesCollection(projectId));

  const allFolders = [];
  foldersSnap.forEach((d) => allFolders.push({ id: d.id, ...d.data() }));

  const allFiles = [];
  filesSnap.forEach((d) => allFiles.push({ id: d.id, ...d.data() }));

  const queue = [folderId];

  while (queue.length) {
    const current = queue.shift();
    const children = allFolders.filter((f) => f.parentId === current);

    for (const child of children) {
      folderIds.push(child.id);
      queue.push(child.id);
    }

    const childFiles = allFiles.filter((f) => f.folderId === current);
    for (const file of childFiles) {
      fileIds.push(file.id);
    }
  }

  return { folderIds, fileIds };
}

/**
 * Recursively delete a folder and all of its child folders/files using a single atomic batch.
 * @param {string} projectId
 * @param {string} folderId
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
export async function deleteFolder(projectId, folderId) {
  return run(async () => {
    const projectError = validateId(projectId, "Project ID");
    if (projectError) return projectError;

    const folderError = validateId(folderId, "Folder ID");
    if (folderError) return folderError;

    const { folderIds, fileIds } = await collectFolderTree(projectId, folderId);

    const batch = writeBatch(db);

    fileIds.forEach((id) => batch.delete(fileRef(projectId, id)));
    folderIds.forEach((id) => batch.delete(folderRef(projectId, id)));

    await batch.commit();

    await adjustProjectCounters(projectId, {
      files: -fileIds.length,
      folders: -folderIds.length,
    });

    return createResponse(true, {
      data: {
        deletedFolders: folderIds.length,
        deletedFiles: fileIds.length,
      },
    });
  });
}

/* ==========================================
   CREATE FILE
========================================== */

/**
 * Create a new file inside a project.
 * @param {string} projectId
 * @param {{ name: string, extension?: string, language?: string, folderId?: string|null, path?: string, content?: string, size?: number }} data
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
export async function createFile(projectId, data) {
  return run(async () => {
    const projectError = validateId(projectId, "Project ID");
    if (projectError) return projectError;

    const nameError = validateName(data?.name);
    if (nameError) return nameError;

    const content = data.content || "";
    const payload = {
      name: data.name.trim(),
      extension: data.extension || "",
      language: data.language || "plaintext",
      folderId: data.folderId || null,
      path: data.path || data.name.trim(),
      content,
      size: data.size ?? content.length,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const reference = await addDoc(filesCollection(projectId), payload);
    await adjustProjectCounters(projectId, { files: 1 });

    return createResponse(true, {
      data: { id: reference.id, ...payload },
    });
  });
}

/* ==========================================
   GET FILES
========================================== */

/**
 * Get all files for a project, ordered by name.
 * @param {string} projectId
 * @returns {Promise<{success: boolean, data?: array, error?: string}>}
 */
export async function getFiles(projectId) {
  return run(async () => {
    const projectError = validateId(projectId, "Project ID");
    if (projectError) return projectError;

    const q = query(filesCollection(projectId), orderBy("name", "asc"));
    const snapshot = await getDocs(q);
    const files = [];

    snapshot.forEach((document) => {
      files.push({ id: document.id, ...document.data() });
    });

    return createResponse(true, { data: files });
  });
}

/* ==========================================
   GET FILE
========================================== */

/**
 * Get a single file by ID.
 * @param {string} projectId
 * @param {string} fileId
 * @returns {Promise<{success: boolean, exists?: boolean, data?: object, error?: string}>}
 */
export async function getFile(projectId, fileId) {
  return run(async () => {
    const projectError = validateId(projectId, "Project ID");
    if (projectError) return projectError;

    const fileError = validateId(fileId, "File ID");
    if (fileError) return fileError;

    return await getDocument(fileRef(projectId, fileId));
  });
}

/* ==========================================
   SAVE FILE
========================================== */

/**
 * Save file content and optional metadata.
 * Supports future fields: version, lastModifiedBy.
 * @param {string} projectId
 * @param {string} fileId
 * @param {string} content
 * @param {{ lastModifiedBy?: string, version?: number }} [meta={}]
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function saveFile(projectId, fileId, content, meta = {}) {
  return run(async () => {
    const projectError = validateId(projectId, "Project ID");
    if (projectError) return projectError;

    const fileError = validateId(fileId, "File ID");
    if (fileError) return fileError;

    const payload = {
      content: content ?? "",
      size: content ? content.length : 0,
    };

    if (meta.lastModifiedBy) {
      payload.lastModifiedBy = meta.lastModifiedBy;
    }

    if (meta.version !== undefined) {
      payload.version = meta.version;
    }

    await updateDocument(fileRef(projectId, fileId), payload);
    return createResponse(true);
  });
}

/* ==========================================
   RENAME FILE
========================================== */

/**
 * Rename an existing file.
 * @param {string} projectId
 * @param {string} fileId
 * @param {string} newName
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function renameFile(projectId, fileId, newName) {
  return run(async () => {
    const projectError = validateId(projectId, "Project ID");
    if (projectError) return projectError;

    const fileError = validateId(fileId, "File ID");
    if (fileError) return fileError;

    const nameError = validateName(newName);
    if (nameError) return nameError;

    await updateDocument(fileRef(projectId, fileId), { name: newName.trim() });
    return createResponse(true);
  });
}

/* ==========================================
   DELETE FILE
========================================== */

/**
 * Delete a single file and decrement project counter.
 * @param {string} projectId
 * @param {string} fileId
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteFile(projectId, fileId) {
  return run(async () => {
    const projectError = validateId(projectId, "Project ID");
    if (projectError) return projectError;

    const fileError = validateId(fileId, "File ID");
    if (fileError) return fileError;

    await deleteDoc(fileRef(projectId, fileId));
    await adjustProjectCounters(projectId, { files: -1 });
    return createResponse(true);
  });
}

/* ==========================================
   FUTURE HELPERS (architecture ready)
========================================== */

/**
 * Move a file to a different folder.
 * @param {string} projectId
 * @param {string} fileId
 * @param {string|null} targetFolderId
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function moveFile(projectId, fileId, targetFolderId) {
  return run(async () => {
    const projectError = validateId(projectId, "Project ID");
    if (projectError) return projectError;

    const fileError = validateId(fileId, "File ID");
    if (fileError) return fileError;

    await updateDocument(fileRef(projectId, fileId), {
      folderId: targetFolderId || null,
    });

    return createResponse(true);
  });
}

/**
 * Move a folder under a new parent.
 * @param {string} projectId
 * @param {string} folderId
 * @param {string|null} targetParentId
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function moveFolder(projectId, folderId, targetParentId) {
  return run(async () => {
    const projectError = validateId(projectId, "Project ID");
    if (projectError) return projectError;

    const folderError = validateId(folderId, "Folder ID");
    if (folderError) return folderError;

    await updateDocument(folderRef(projectId, folderId), {
      parentId: targetParentId || null,
    });

    return createResponse(true);
  });
}

/**
 * Duplicate a file (shallow copy of content + metadata).
 * @param {string} projectId
 * @param {string} fileId
 * @param {string} [newName]
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
export async function duplicateFile(projectId, fileId, newName) {
  return run(async () => {
    const projectError = validateId(projectId, "Project ID");
    if (projectError) return projectError;

    const fileError = validateId(fileId, "File ID");
    if (fileError) return fileError;

    const original = await getDocument(fileRef(projectId, fileId));
    if (!original.exists || !original.data) {
      return createResponse(false, { error: "File not found." });
    }

    const source = original.data;
    const name = newName?.trim() || `${source.name} (copy)`;

    return await createFile(projectId, {
      name,
      extension: source.extension,
      language: source.language,
      folderId: source.folderId,
      path: source.path,
      content: source.content,
    });
  });
}

/**
 * Duplicate a folder (structure only — files are not deep-copied yet).
 * @param {string} projectId
 * @param {string} folderId
 * @param {string} [newName]
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
export async function duplicateFolder(projectId, folderId, newName) {
  return run(async () => {
    const projectError = validateId(projectId, "Project ID");
    if (projectError) return projectError;

    const folderError = validateId(folderId, "Folder ID");
    if (folderError) return folderError;

    const original = await getDocument(folderRef(projectId, folderId));
    if (!original.exists || !original.data) {
      return createResponse(false, { error: "Folder not found." });
    }

    const source = original.data;
    const name = newName?.trim() || `${source.name} (copy)`;

    return await createFolder(projectId, {
      name,
      parentId: source.parentId,
    });
  });
}

/**
 * Alias for duplicateFile — kept for API clarity.
 * @param {string} projectId
 * @param {string} fileId
 * @param {string} [newName]
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
export async function copyFile(projectId, fileId, newName) {
  return duplicateFile(projectId, fileId, newName);
}

/**
 * Alias for duplicateFolder — kept for API clarity.
 * @param {string} projectId
 * @param {string} folderId
 * @param {string} [newName]
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
export async function copyFolder(projectId, folderId, newName) {
  return duplicateFolder(projectId, folderId, newName);
}

/* ==========================================
   NOTIFICATIONS
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