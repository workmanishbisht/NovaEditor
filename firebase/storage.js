"use strict";

/* ==========================================
   Imports
========================================== */

import {
  ref,
  uploadBytes,
  deleteObject,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

import { storage } from "./firebase-config.js";

/* ==========================================
   Storage Paths
========================================== */

const STORAGE = Object.freeze({
  AVATARS: "avatars",
  WORKSPACES: "workspaces",
  PROJECTS: "projects",
});

/* ==========================================
   Helpers
========================================== */

function avatarRef(uid) {
  return ref(storage, `${STORAGE.AVATARS}/${uid}`);
}

function workspaceFileRef(uid, workspaceId, fileName) {
  return ref(
    storage,
    `${STORAGE.WORKSPACES}/${uid}/${workspaceId}/${fileName}`,
  );
}

function projectThumbnailRef(uid, projectId, fileName) {
  return ref(storage, `${STORAGE.PROJECTS}/${uid}/${projectId}/${fileName}`);
}

function createResponse(success, data = {}) {
  return {
    success,
    url: data.url ?? null,
    error: data.error ?? null,
    code: data.code ?? null,
  };
}

/* ==========================================
   Upload Avatar
========================================== */

export async function uploadAvatar(uid, file) {
  try {
    const avatar = avatarRef(uid);

    await uploadBytes(avatar, file);

    const url = await getDownloadURL(avatar);

    return createResponse(true, {
      url,
    });
  } catch (error) {
    return createResponse(false, {
      error: error.message,
      code: error.code,
    });
  }
}

/* ==========================================
   Delete Avatar
========================================== */

export async function deleteAvatar(uid) {
  try {
    await deleteObject(avatarRef(uid));

    return createResponse(true);
  } catch (error) {
    return createResponse(false, {
      error: error.message,
      code: error.code,
    });
  }
}

/* ==========================================
   Get Avatar URL
========================================== */

export async function getAvatarURL(uid) {
  try {
    const url = await getDownloadURL(avatarRef(uid));

    return createResponse(true, {
      url,
    });
  } catch (error) {
    return createResponse(false, {
      error: error.message,
      code: error.code,
    });
  }
}

/* ==========================================
   Upload Workspace File
========================================== */

export async function uploadWorkspaceFile(uid, workspaceId, file) {
  try {
    const workspaceFile = workspaceFileRef(uid, workspaceId, file.name);

    await uploadBytes(workspaceFile, file);

    const url = await getDownloadURL(workspaceFile);

    return createResponse(true, {
      url,
    });
  } catch (error) {
    return createResponse(false, {
      error: error.message,
      code: error.code,
    });
  }
}

/* ==========================================
   Delete File
========================================== */

export async function deleteFile(path) {
  try {
    const fileRef = ref(storage, path);

    await deleteObject(fileRef);

    return createResponse(true);
  } catch (error) {
    return createResponse(false, {
      error: error.message,
      code: error.code,
    });
  }
}

/* ==========================================
   Get File Download URL
========================================== */

export async function getFileDownloadURL(path) {
  try {
    const fileRef = ref(storage, path);

    const url = await getDownloadURL(fileRef);

    return createResponse(true, {
      url,
    });
  } catch (error) {
    return createResponse(false, {
      error: error.message,
      code: error.code,
    });
  }
}

/* ==========================================
   Upload Project Thumbnail
========================================== */

export async function uploadProjectThumbnail(uid, projectId, file) {
  try {
    const thumbnail = projectThumbnailRef(uid, projectId, file.name);

    await uploadBytes(thumbnail, file);

    const url = await getDownloadURL(thumbnail);

    return createResponse(true, {
      url,
    });
  } catch (error) {
    return createResponse(false, {
      error: error.message,
      code: error.code,
    });
  }
}

/* ==========================================
   Delete Workspace Folder
========================================== */

export async function deleteWorkspaceFolder(uid, workspaceId) {
  void uid;
  void workspaceId;

  throw new Error("deleteWorkspaceFolder() is not implemented yet.");
}
