"use strict";

/* ==========================================
   IMPORTS
========================================== */

import {
  checkSession,
} from "../firebase/auth.js";

import {
  getUser,
  updateUser,
  createWorkspace,
  isUsernameAvailable,
  saveEditorPreferences,
  saveAIPreferences,
} from "../firebase/firestore.js";

/* ==========================================
   CONFIG
========================================== */

const CONFIG = Object.freeze({
  ROUTES: Object.freeze({
    LOGIN: "../pages/login.html",
    DASHBOARD: "../pages/dashboard.html",
  }),
  USERNAME: Object.freeze({
    MIN: 3,
    MAX: 20,
    REGEX: /^[a-zA-Z0-9_]+$/,
    DEBOUNCE: 500,
  }),
  REDIRECT_DELAY: 800,
});

/* ==========================================
   STATE
========================================== */

const STATE = {
  currentStep: 1,
  currentUser: null,
  userData: null,
  loading: false,
  usernameValid: false,
  form: {
    profile: {},
    workspace: {},
    editor: {},
    ai: {},
  },
};

/* ==========================================
   DOM CACHE
========================================== */

const DOM = {

  /* Steps */
  steps: document.querySelectorAll(".setup-step"),
  sidebarSteps: document.querySelectorAll(".progress-item"),
  topSteps: document.querySelectorAll(".step-track-item"),

  /* Step 1 */
  userAvatar: document.getElementById("userAvatar"),
  userName: document.getElementById("userName"),
  userEmail: document.getElementById("userEmail"),
  displayName: document.getElementById("displayName"),
  email: document.getElementById("email"),
  username: document.getElementById("username"),
  usernameStatus: document.getElementById("usernameStatus"),
  step1Next: document.getElementById("step1Next"),

  /* Step 2 */
  workspaceName: document.getElementById("workspaceName"),
  defaultProject: document.getElementById("defaultProject"),
  experience: document.getElementById("experience"),
  step2Back: document.getElementById("step2Back"),
  step2Next: document.getElementById("step2Next"),

  /* Step 3 */
  theme: document.getElementById("theme"),
  language: document.getElementById("language"),
  fontSize: document.getElementById("fontSize"),
  tabSize: document.getElementById("tabSize"),
  wordWrap: document.getElementById("wordWrap"),
  autoSave: document.getElementById("autoSave"),
  minimap: document.getElementById("minimap"),
  lineNumbers: document.getElementById("lineNumbers"),
  step3Back: document.getElementById("step3Back"),
  step3Next: document.getElementById("step3Next"),

  /* Step 4 */
  aiAssistant: document.getElementById("aiAssistant"),
  aiSuggestions: document.getElementById("aiSuggestions"),
  aiExplain: document.getElementById("aiExplain"),
  aiAutoComplete: document.getElementById("aiAutoComplete"),
  summaryName: document.getElementById("summaryName"),
  summaryWorkspace: document.getElementById("summaryWorkspace"),
  summaryExperience: document.getElementById("summaryExperience"),
  summaryTheme: document.getElementById("summaryTheme"),
  summaryLanguage: document.getElementById("summaryLanguage"),
  step4Back: document.getElementById("step4Back"),
  finishSetup: document.getElementById("finishSetup"),

};

/* ==========================================
   HELPERS
========================================== */

function showToast(message, type = "info") {
  if (typeof window.showToast === "function") {
    window.showToast(message, type);
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sanitize(value) {
  return String(value || "").trim();
}

/**
 * Usernames are always stored trimmed and lowercased.
 */
function normalizeUsername(value) {
  return sanitize(value).toLowerCase();
}

/**
 * Disables/enables all step navigation buttons at once.
 * Used to prevent double clicks while a Firebase call is in flight.
 */
function setNavigationDisabled(disabled) {
  [
    DOM.step1Next,
    DOM.step2Back,
    DOM.step2Next,
    DOM.step3Back,
    DOM.step3Next,
    DOM.step4Back,
    DOM.finishSetup,
  ].forEach((button) => {
    if (button) button.disabled = disabled;
  });
}

/* ==========================================
   INITIALIZATION
========================================== */

async function initialize() {
  try {
    const user = await checkSession();

    if (!user) {
      window.location.href = CONFIG.ROUTES.LOGIN;
      return;
    }

    STATE.currentUser = user;

    const response = await getUser(user.uid);

    if (!response.success) {
      throw new Error(response.error || "Unable to load user.");
    }

    STATE.userData = response.data;

    /* Already Setup */

    if (STATE.userData?.setupCompleted) {
      showToast("Redirecting to dashboard...", "success");

      await wait(CONFIG.REDIRECT_DELAY);

      window.location.href = CONFIG.ROUTES.DASHBOARD;
      return;
    }

    populateProfile();
    loadEditorDefaults();
    updateSummary();
    attachEvents();
    showStep(1);

  } catch (error) {
    console.error(error);

    showToast(
      error.message || "Unable to initialize setup.",
      "error"
    );

    window.location.href = CONFIG.ROUTES.LOGIN;
  }
}

/* ==========================================
   PROFILE
========================================== */

function populateProfile() {

  const authUser = STATE.currentUser;
  const dbUser = STATE.userData || {};

  /* Fallback chain: Firestore -> Firebase Auth -> Default avatar */

  const name =
    dbUser.displayName ||
    authUser.displayName ||
    "";

  const email =
    dbUser.email ||
    authUser.email ||
    "";

  const photo =
    dbUser.photoURL ||
    authUser.photoURL ||
    "../assets/images/avatar/default.png";

  if (DOM.userAvatar) {
    DOM.userAvatar.src = photo;

    DOM.userAvatar.onerror = () => {
      DOM.userAvatar.src = "../assets/images/avatar/default.png";
    };
  }

  if (DOM.userName) DOM.userName.textContent = name;
  if (DOM.userEmail) DOM.userEmail.textContent = email;

  if (DOM.displayName) DOM.displayName.value = name;
  if (DOM.email) DOM.email.value = email;

  if (DOM.username) DOM.username.value = dbUser.username || "";

  STATE.form.profile = {
    displayName: name,
    email,
    username: dbUser.username || "",
    photo,
  };

}

/* ==========================================
   PROFILE FIELD SYNC
========================================== */

function attachProfileEvents() {

  if (DOM.displayName) {
    DOM.displayName.addEventListener("input", (e) => {
      STATE.form.profile.displayName = sanitize(e.target.value);
      updateSummary();
    });
  }

  /*
    Email is only kept in sync if the field is actually editable.
    If it's marked readonly/disabled in the HTML, it's left as-is
    and treated as non-editable here too.
  */
  if (DOM.email && !DOM.email.readOnly && !DOM.email.disabled) {
    DOM.email.addEventListener("input", (e) => {
      STATE.form.profile.email = sanitize(e.target.value);
    });
  }

}

/* ==========================================
   DEFAULT VALUES
   (Editor + AI defaults merged into one place)
========================================== */

function loadEditorDefaults() {

  STATE.form.editor = {
    theme: "system",
    language: "javascript",
    fontSize: "16",
    tabSize: "4",
    wordWrap: true,
    autoSave: true,
    minimap: true,
    lineNumbers: true,
  };

  STATE.form.ai = {
    assistant: true,
    suggestions: true,
    explain: true,
    autoComplete: true,
  };

  if (DOM.theme) DOM.theme.value = STATE.form.editor.theme;
  if (DOM.language) DOM.language.value = STATE.form.editor.language;
  if (DOM.fontSize) DOM.fontSize.value = STATE.form.editor.fontSize;
  if (DOM.tabSize) DOM.tabSize.value = STATE.form.editor.tabSize;
  if (DOM.wordWrap) DOM.wordWrap.checked = STATE.form.editor.wordWrap;
  if (DOM.autoSave) DOM.autoSave.checked = STATE.form.editor.autoSave;
  if (DOM.minimap) DOM.minimap.checked = STATE.form.editor.minimap;
  if (DOM.lineNumbers) DOM.lineNumbers.checked = STATE.form.editor.lineNumbers;

  if (DOM.aiAssistant) DOM.aiAssistant.checked = STATE.form.ai.assistant;
  if (DOM.aiSuggestions) DOM.aiSuggestions.checked = STATE.form.ai.suggestions;
  if (DOM.aiExplain) DOM.aiExplain.checked = STATE.form.ai.explain;
  if (DOM.aiAutoComplete) DOM.aiAutoComplete.checked = STATE.form.ai.autoComplete;

}

/* ==========================================
   STEP MANAGER
========================================== */

function showStep(step) {

  STATE.currentStep = step;

  DOM.steps.forEach((item) => {
    item.classList.remove("active");
  });

  const active = document.querySelector(
    `.setup-step[data-step="${step}"]`
  );

  if (active) {
    active.classList.add("active");
  }

  DOM.sidebarSteps.forEach((item, index) => {
    item.classList.remove("active", "completed");

    if (index + 1 < step) {
      item.classList.add("completed");
    }

    if (index + 1 === step) {
      item.classList.add("active");
    }
  });

  DOM.topSteps.forEach((item, index) => {
    item.classList.remove("active", "completed");

    if (index + 1 < step) {
      item.classList.add("completed");
    }

    if (index + 1 === step) {
      item.classList.add("active");
    }
  });

}

/* ==========================================
   USERNAME VALIDATION
========================================== */

let usernameTimer = null;

function attachUsernameValidation() {
  if (!DOM.username) return;

  DOM.username.addEventListener("input", handleUsernameInput);
}

function handleUsernameInput(event) {

  const username = sanitize(event.target.value);

  DOM.username.value = username;
  STATE.form.profile.username = username;

  clearTimeout(usernameTimer);

  if (username.length === 0) {
    updateUsernameStatus("", "Username is required.", false);
    return;
  }

  if (
    username.length < CONFIG.USERNAME.MIN ||
    username.length > CONFIG.USERNAME.MAX
  ) {
    updateUsernameStatus(
      "invalid",
      `Username must be ${CONFIG.USERNAME.MIN}-${CONFIG.USERNAME.MAX} characters.`,
      false
    );
    return;
  }

  if (!CONFIG.USERNAME.REGEX.test(username)) {
    updateUsernameStatus(
      "invalid",
      "Only letters, numbers and underscore are allowed.",
      false
    );
    return;
  }

  updateUsernameStatus("checking", "Checking username...", false);

  usernameTimer = setTimeout(async () => {
    try {
      const response = await isUsernameAvailable(username);

      if (!response.success) {
        updateUsernameStatus(
          "error",
          response.error || "Unable to verify username.",
          false
        );
        return;
      }

      if (!response.data.available) {
        updateUsernameStatus("taken", "Username already exists.", false);
        return;
      }

      updateUsernameStatus("success", "Username available.", true);

    } catch (error) {
      console.error(error);
      updateUsernameStatus("error", "Something went wrong.", false);
    }
  }, CONFIG.USERNAME.DEBOUNCE);

}

/* ==========================================
   USERNAME STATUS
========================================== */

function updateUsernameStatus(type, message, valid) {

  STATE.usernameValid = valid;

  if (DOM.usernameStatus) {
    DOM.usernameStatus.className = "username-status";

    if (type) {
      DOM.usernameStatus.classList.add(type);
    }

    DOM.usernameStatus.textContent = message;
  }

  updateStep1Button();

}

/* ==========================================
   STEP 1 BUTTON
========================================== */

function updateStep1Button() {
  if (!DOM.step1Next) return;

  DOM.step1Next.disabled = !STATE.usernameValid;
}

/* ==========================================
   STEP 1 VALIDATION
========================================== */

function validateStep1() {

  const username = normalizeUsername(DOM.username.value);

  if (!username) {
    showToast("Username is required.", "error");
    return false;
  }

  if (!STATE.usernameValid) {
    showToast("Choose a valid username.", "error");
    return false;
  }

  STATE.form.profile.username = username;

  return true;

}

/* ==========================================
   STEP 2
   Workspace
========================================== */

function attachWorkspaceEvents() {

  if (DOM.workspaceName) {
    DOM.workspaceName.addEventListener("input", (e) => {
      STATE.form.workspace.workspaceName = sanitize(e.target.value);
      updateSummary();
    });
  }

  if (DOM.defaultProject) {
    DOM.defaultProject.addEventListener("input", (e) => {
      STATE.form.workspace.defaultProject = sanitize(e.target.value);
    });
  }

  if (DOM.experience) {
    DOM.experience.addEventListener("change", (e) => {
      STATE.form.workspace.experience = e.target.value;
      updateSummary();
    });
  }

}

/* ==========================================
   Workspace Validation
========================================== */

function validateStep2() {

  if (!DOM.workspaceName || !DOM.experience) return false;

  const workspaceName = sanitize(DOM.workspaceName.value);
  const experience = DOM.experience.value;

  if (!workspaceName) {
    showToast("Workspace name is required.", "error");
    DOM.workspaceName.focus();
    return false;
  }

  if (workspaceName.length < 3) {
    showToast(
      "Workspace name must be at least 3 characters.",
      "error"
    );
    DOM.workspaceName.focus();
    return false;
  }

  if (!experience) {
    showToast("Please select your experience.", "error");
    DOM.experience.focus();
    return false;
  }

  STATE.form.workspace = {
    workspaceName,
    defaultProject: sanitize(DOM.defaultProject.value),
    experience,
  };

  return true;

}

/* ==========================================
   Summary Update
   Kept in sync automatically by every field
   listener below - no manual refresh needed.
========================================== */

function updateSummary() {

  if (DOM.summaryName) {
    DOM.summaryName.textContent = STATE.form.profile.displayName || "-";
  }

  if (DOM.summaryWorkspace) {
    DOM.summaryWorkspace.textContent = STATE.form.workspace.workspaceName || "-";
  }

  if (DOM.summaryExperience) {
    DOM.summaryExperience.textContent = STATE.form.workspace.experience || "-";
  }

  if (DOM.summaryTheme) {
    DOM.summaryTheme.textContent = STATE.form.editor.theme || "System";
  }

  if (DOM.summaryLanguage) {
    DOM.summaryLanguage.textContent = STATE.form.editor.language || "JavaScript";
  }

}

/* ==========================================
   STEP 3
   Editor Preferences
========================================== */

function attachEditorEvents() {

  if (DOM.theme) {
    DOM.theme.addEventListener("change", (e) => {
      STATE.form.editor.theme = e.target.value;
      updateSummary();
    });
  }

  if (DOM.language) {
    DOM.language.addEventListener("change", (e) => {
      STATE.form.editor.language = e.target.value;
      updateSummary();
    });
  }

  if (DOM.fontSize) {
    DOM.fontSize.addEventListener("change", (e) => {
      STATE.form.editor.fontSize = e.target.value;
    });
  }

  if (DOM.tabSize) {
    DOM.tabSize.addEventListener("change", (e) => {
      STATE.form.editor.tabSize = e.target.value;
    });
  }

  if (DOM.wordWrap) {
    DOM.wordWrap.addEventListener("change", (e) => {
      STATE.form.editor.wordWrap = e.target.checked;
    });
  }

  if (DOM.autoSave) {
    DOM.autoSave.addEventListener("change", (e) => {
      STATE.form.editor.autoSave = e.target.checked;
    });
  }

  if (DOM.minimap) {
    DOM.minimap.addEventListener("change", (e) => {
      STATE.form.editor.minimap = e.target.checked;
    });
  }

  if (DOM.lineNumbers) {
    DOM.lineNumbers.addEventListener("change", (e) => {
      STATE.form.editor.lineNumbers = e.target.checked;
    });
  }

}

/* ==========================================
   Step 3 Validation
========================================== */

function validateStep3() {

  if (
    !DOM.theme || !DOM.language || !DOM.fontSize || !DOM.tabSize ||
    !DOM.wordWrap || !DOM.autoSave || !DOM.minimap || !DOM.lineNumbers
  ) {
    return false;
  }

  STATE.form.editor = {
    theme: DOM.theme.value,
    language: DOM.language.value,
    fontSize: DOM.fontSize.value,
    tabSize: DOM.tabSize.value,
    wordWrap: DOM.wordWrap.checked,
    autoSave: DOM.autoSave.checked,
    minimap: DOM.minimap.checked,
    lineNumbers: DOM.lineNumbers.checked,
  };

  return true;

}

/* ==========================================
   STEP 4
   AI Preferences
========================================== */

function attachAIEvents() {

  if (DOM.aiAssistant) {
    DOM.aiAssistant.addEventListener("change", (e) => {
      STATE.form.ai.assistant = e.target.checked;
    });
  }

  if (DOM.aiSuggestions) {
    DOM.aiSuggestions.addEventListener("change", (e) => {
      STATE.form.ai.suggestions = e.target.checked;
    });
  }

  if (DOM.aiExplain) {
    DOM.aiExplain.addEventListener("change", (e) => {
      STATE.form.ai.explain = e.target.checked;
    });
  }

  if (DOM.aiAutoComplete) {
    DOM.aiAutoComplete.addEventListener("change", (e) => {
      STATE.form.ai.autoComplete = e.target.checked;
    });
  }

}

/* ==========================================
   NAVIGATION
   All button click handlers live here so they
   are only ever attached once, from attachEvents().
========================================== */

function attachNavigationEvents() {

  if (DOM.step1Next) {
    DOM.step1Next.addEventListener("click", () => {
      if (STATE.loading) return;
      if (!validateStep1()) return;
      showStep(2);
    });
  }

  if (DOM.step2Back) {
    DOM.step2Back.addEventListener("click", () => {
      if (STATE.loading) return;
      showStep(1);
    });
  }

  if (DOM.step2Next) {
    DOM.step2Next.addEventListener("click", () => {
      if (STATE.loading) return;
      if (!validateStep2()) return;
      updateSummary();
      showStep(3);
    });
  }

  if (DOM.step3Back) {
    DOM.step3Back.addEventListener("click", () => {
      if (STATE.loading) return;
      showStep(2);
    });
  }

  if (DOM.step3Next) {
    DOM.step3Next.addEventListener("click", () => {
      if (STATE.loading) return;
      if (!validateStep3()) return;
      updateSummary();
      showStep(4);
    });
  }

  if (DOM.step4Back) {
    DOM.step4Back.addEventListener("click", () => {
      if (STATE.loading) return;
      showStep(3);
    });
  }

  if (DOM.finishSetup) {
    DOM.finishSetup.addEventListener("click", finishSetup);
  }

}

/* ==========================================
   ACCESSIBILITY
   Enter submits the current step, Escape goes
   back a step. Tab works natively and is left
   untouched.
========================================== */

function attachKeyboardEvents() {
  document.addEventListener("keydown", handleKeydown);
}

function handleKeydown(event) {

  if (event.target.tagName === "TEXTAREA") return;

  if (event.key === "Enter") {
    event.preventDefault();
    triggerStepAction();
  }

  if (event.key === "Escape") {
    triggerStepBack();
  }

}

function triggerStepAction() {

  const buttonsByStep = {
    1: DOM.step1Next,
    2: DOM.step2Next,
    3: DOM.step3Next,
    4: DOM.finishSetup,
  };

  const button = buttonsByStep[STATE.currentStep];

  if (button && !button.disabled) {
    button.click();
  }

}

function triggerStepBack() {

  const buttonsByStep = {
    2: DOM.step2Back,
    3: DOM.step3Back,
    4: DOM.step4Back,
  };

  const button = buttonsByStep[STATE.currentStep];

  if (button) {
    button.click();
  }

}

/* ==========================================
   Centralized Event Binding
   Called exactly once, from initialize(). Guarded
   so an accidental second call never double-attaches
   any listener.
========================================== */

let eventsBound = false;

function attachEvents() {
  if (eventsBound) return;
  eventsBound = true;

  attachProfileEvents();
  attachUsernameValidation();
  attachWorkspaceEvents();
  attachEditorEvents();
  attachAIEvents();
  attachNavigationEvents();
  attachKeyboardEvents();
}

/* ==========================================
   FIREBASE ACTIONS
   Finish Setup

   Order matters:
   1. Create workspace
   2. Save editor + AI preferences together
   3. Update user (username, profile, currentWorkspaceId,
      setupCompleted)
   4. Redirect to dashboard

   setupCompleted is never set until every previous
   step has succeeded.
========================================== */

async function finishSetup() {

  if (STATE.loading) return;

  /* Final safety check - never trust step state blindly. */

  const displayName = sanitize(STATE.form.profile.displayName);
  const username = normalizeUsername(STATE.form.profile.username);
  const workspaceName = sanitize(STATE.form.workspace.workspaceName);

  if (!displayName) {
    showToast("Display name is required.", "error");
    return;
  }

  if (!username || !STATE.usernameValid) {
    showToast("Choose a valid username.", "error");
    return;
  }

  if (!workspaceName || workspaceName.length < 3) {
    showToast("Workspace name is required.", "error");
    return;
  }

  STATE.loading = true;
  setNavigationDisabled(true);

  showToast("Creating your workspace...", "loading");

  try {

    /* 1. Workspace */

    const workspaceResponse = await createWorkspace({
      ownerUid: STATE.currentUser.uid,
      workspaceName: STATE.form.workspace.workspaceName,
      defaultProject: STATE.form.workspace.defaultProject,
      experience: STATE.form.workspace.experience,
      createdAt: Date.now(),
    });

    if (!workspaceResponse.success) {
      throw new Error(
        workspaceResponse.error || "Unable to create workspace."
      );
    }

    const workspaceId = workspaceResponse.data.id;

    /* 2. Editor + AI Preferences (together) */

    const [editorResponse, aiResponse] = await Promise.all([
      saveEditorPreferences(STATE.currentUser.uid, { ...STATE.form.editor }),
      saveAIPreferences(STATE.currentUser.uid, { ...STATE.form.ai }),
    ]);

    if (!editorResponse.success || !aiResponse.success) {
      throw new Error("Unable to save your preferences.");
    }

    /* 3. Update User (only after everything above succeeded) */

    const userPayload = {
      username,
      displayName,
      email: STATE.form.profile.email,
      photoURL: STATE.form.profile.photo,
      currentWorkspaceId: workspaceId,
      setupCompleted: true,
      updatedAt: Date.now(),
    };

    const userResponse = await updateUser(STATE.currentUser.uid, userPayload);

    if (!userResponse.success) {
      throw new Error(
        userResponse.error || "Unable to update your profile."
      );
    }

    /* 4. Done */

    showToast("Setup completed successfully.", "success");

    await wait(CONFIG.REDIRECT_DELAY);

    window.location.href = CONFIG.ROUTES.DASHBOARD;

  } catch (error) {
    console.error(error);

    showToast(
      error.message || "Unable to complete setup.",
      "error"
    );

  } finally {
    STATE.loading = false;
    setNavigationDisabled(false);
    updateStep1Button();
  }

}

/* ==========================================
   BOOTSTRAP
========================================== */

initialize();