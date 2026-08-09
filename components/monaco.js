/* ==========================================
   NOVA EDITOR — monaco.js
   ------------------------------------------
   Encapsulates ALL Monaco Editor-specific
   implementation:
     - CDN script loading
     - Editor instance creation / lifecycle
     - Model creation, switching, disposal
     - Model rename/remapping (single + bulk)
     - Language detection / labeling
     - Content-change & cursor-change wiring
     - Focus / read-only / theme control
     - DOM host visibility for the Monaco shell

   This module owns its own internal state
   (MONACO_STATE) and exposes a small, explicit
   API. It never reaches into application state
   (open tabs, files, Firestore, etc.) — callers
   (editor.js) pass in whatever content/paths are
   needed and react to callbacks for editor events.
   ========================================== */

const qs = (sel, scope = document) => scope.querySelector(sel);

/* ==========================================
   INTERNAL MONACO STATE
   ========================================== */
const MONACO_STATE = {
    monaco: null,
    editor: null,
    models: new Map(),
};

/* ==========================================
   LANGUAGE DETECTION
   ========================================== */
export function getLanguageFromPath(path) {
    if (!path) return "plaintext";
    // Use basename so renamed files (stale path / new name) resolve correctly
    const lower = String(path).split("/").pop().toLowerCase();
    if (lower.endsWith(".tsx") || lower.endsWith(".ts")) return "typescript";
    if (lower.endsWith(".jsx") || lower.endsWith(".js")) return "javascript";
    if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
    if (lower.endsWith(".css")) return "css";
    if (lower.endsWith(".json")) return "json";
    if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
    if (lower.endsWith(".py")) return "python";
    return "plaintext";
}

export function getLanguageLabel(path) {
    const lang = getLanguageFromPath(path);
    const map = {
        javascript: "JavaScript",
        typescript: "TypeScript",
        html: "HTML",
        css: "CSS",
        json: "JSON",
        markdown: "Markdown",
        python: "Python",
        plaintext: "Plain Text",
    };
    return map[lang] || "Plain Text";
}

/* ==========================================
   SCRIPT LOADING
   ========================================== */
function loadMonacoScript() {
    return new Promise((resolve, reject) => {
        if (window.monaco) {
            resolve(window.monaco);
            return;
        }
        const loader = document.createElement("script");
        loader.src = "https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/loader.js";
        loader.onload = () => {
            window.require.config({
                paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs" },
            });
            window.require(["vs/editor/editor.main"], () => {
                resolve(window.monaco);
            });
        };
        loader.onerror = () => reject(new Error("Failed to load Monaco Editor"));
        document.head.appendChild(loader);
    });
}

/* ==========================================
   EDITOR INSTANCE LIFECYCLE
   ------------------------------------------
   initMonaco() loads the Monaco script, hides
   the static mock shell, mounts a dedicated
   host element, creates the editor instance,
   and wires content-change / cursor-change
   events to the provided callbacks.

   Returns true on success, false if there was
   nowhere to mount the editor. Throws if the
   Monaco script itself fails to load — callers
   should wrap this in try/catch.
   ========================================== */
export async function initMonaco({ readOnly = false, onContentChange, onCursorChange } = {}) {
    const monacoContainer = qs("#monacoContainer");
    const surface = qs("#editorSurface");
    if (!monacoContainer && !surface) return false;

    const monaco = await loadMonacoScript();
    MONACO_STATE.monaco = monaco;

    // Permanently hide the static mock shell so it never overlays the real editor
    const shell = qs("#monacoEditorShell");
    if (shell) {
        shell.hidden = true;
        shell.style.display = "none";
    }
    const existingCodeArea = qs("#editorCodeArea");
    if (existingCodeArea) existingCodeArea.style.display = "none";

    // Dedicated empty host for Monaco — never mount into the static shell
    let editorEl = qs("#monacoEditorHost");
    if (!editorEl) {
        editorEl = document.createElement("div");
        editorEl.id = "monacoEditorHost";
        editorEl.style.cssText = "width:100%;height:100%;min-height:200px;";
        const parent = monacoContainer || surface;
        // Place host before the empty-state sibling so both can toggle independently
        if (monacoContainer) {
            monacoContainer.insertBefore(editorEl, monacoContainer.firstChild);
        } else {
            parent.appendChild(editorEl);
        }
    }
    editorEl.style.display = "block";

    if (MONACO_STATE.editor) {
        MONACO_STATE.editor.dispose();
    }

    MONACO_STATE.editor = monaco.editor.create(editorEl, {
        value: "",
        language: "plaintext",
        theme: document.documentElement.classList.contains("dark") ? "vs-dark" : "vs",
        automaticLayout: true,
        minimap: { enabled: true },
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, monospace",
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        wordWrap: "on",
        tabSize: 2,
        readOnly: !!readOnly,
        padding: { top: 8 },
    });

    MONACO_STATE.editor.onDidChangeModelContent(() => {
        if (typeof onContentChange === "function") onContentChange();
    });

    MONACO_STATE.editor.onDidChangeCursorPosition((e) => {
        if (typeof onCursorChange === "function") {
            onCursorChange({
                lineNumber: e.position.lineNumber,
                column: e.position.column,
            });
        }
    });

    return true;
}

export function isReady() {
    return !!MONACO_STATE.editor;
}

export function focus() {
    MONACO_STATE.editor?.focus();
}

export function getValue() {
    return MONACO_STATE.editor ? MONACO_STATE.editor.getValue() : "";
}

export function setReadOnly(readOnly) {
    MONACO_STATE.editor?.updateOptions({ readOnly: !!readOnly });
}

export function setTheme(theme) {
    if (MONACO_STATE.monaco) {
        MONACO_STATE.monaco.editor.setTheme(theme);
    }
}

export function clearModel() {
    if (MONACO_STATE.editor) MONACO_STATE.editor.setModel(null);
}

/* ==========================================
   MODEL MANAGEMENT
   ========================================== */
function getOrCreateModel(path, content = "") {
    if (!MONACO_STATE.monaco) return null;

    if (MONACO_STATE.models.has(path)) {
        return MONACO_STATE.models.get(path);
    }

    const language = getLanguageFromPath(path);
    const uri = MONACO_STATE.monaco.Uri.parse(`file:///${path}`);
    const model = MONACO_STATE.monaco.editor.createModel(content || "", language, uri);
    MONACO_STATE.models.set(path, model);
    return model;
}

/**
 * Create (if needed) and mount the model for `path` on the live editor
 * instance, setting its language. Returns the model, or null if the
 * editor isn't ready yet.
 */
export function setModel(path, content = "") {
    if (!MONACO_STATE.editor || !path) return null;

    const model = getOrCreateModel(path, content);
    if (model) {
        MONACO_STATE.editor.setModel(model);
        const language = getLanguageFromPath(path);
        MONACO_STATE.monaco.editor.setModelLanguage(model, language);
    }
    return model;
}

export function hasModel(path) {
    return MONACO_STATE.models.has(path);
}

export function disposeModel(path) {
    if (!MONACO_STATE.models.has(path)) return;
    try {
        MONACO_STATE.models.get(path).dispose();
    } catch { /* ignore */ }
    MONACO_STATE.models.delete(path);
}

/** Dispose every model whose path equals `path` or is nested under it. */
export function disposeModelsByPrefix(path) {
    const prefix = path.endsWith("/") ? path : path + "/";
    for (const [p, model] of [...MONACO_STATE.models.entries()]) {
        if (p === path || p.startsWith(prefix)) {
            try {
                model.dispose();
            } catch { /* ignore */ }
            MONACO_STATE.models.delete(p);
        }
    }
}

/** Dispose every model whose path is NOT in keepPaths. */
export function disposeUnusedModels(keepPaths = []) {
    if (!MONACO_STATE.monaco) return;
    const keep = new Set(keepPaths);
    for (const [path, model] of MONACO_STATE.models) {
        if (!keep.has(path)) {
            model.dispose();
            MONACO_STATE.models.delete(path);
        }
    }
}

/**
 * Bulk-remap every existing model's key through remapFn(path) => newPath.
 * Used for folder renames, where many nested file paths shift at once.
 * Updates each model's language if its path actually changed.
 */
export function remapModels(remapFn) {
    if (typeof remapFn !== "function" || !MONACO_STATE.models.size) return;

    const remapped = new Map();
    MONACO_STATE.models.forEach((model, p) => {
        const newP = remapFn(p);
        remapped.set(newP, model);
        if (newP !== p && MONACO_STATE.monaco) {
            try {
                MONACO_STATE.monaco.editor.setModelLanguage(model, getLanguageFromPath(newP));
            } catch { /* ignore */ }
        }
    });
    MONACO_STATE.models = remapped;
}

/** Move a single model from oldPath to newPath and refresh its language. */
export function renameModel(oldPath, newPath) {
    if (!MONACO_STATE.models.has(oldPath)) return;
    const model = MONACO_STATE.models.get(oldPath);
    MONACO_STATE.models.delete(oldPath);
    MONACO_STATE.models.set(newPath, model);
    if (MONACO_STATE.monaco && model) {
        try {
            MONACO_STATE.monaco.editor.setModelLanguage(model, getLanguageFromPath(newPath));
        } catch { /* ignore */ }
    }
}

/* ==========================================
   DOM / LAYOUT HELPERS
   ========================================== */
/**
 * Toggle visibility of the Monaco host vs. the static mock shell.
 * The mock shell stays permanently hidden once Monaco has mounted;
 * only the host's display is toggled (e.g. when an empty-state is shown).
 */
export function setHostVisible(visible) {
    const shell = qs("#monacoEditorShell");
    if (shell) {
        shell.hidden = true;
        shell.style.display = "none";
    }
    const host = qs("#monacoEditorHost");
    if (host) {
        host.style.display = visible ? "block" : "none";
    }
}