/* ==========================================
   NOVA EDITOR — editor.js
   Production-ready • Pure ES6
   Compatible with editor.html + editor.css
   ========================================== */

(() => {
    "use strict";

    /* ==========================================
       FIRESTORE (from ../firebase/firestore.js)
       Expected to be available on the page.
       ========================================== */
    const FS = window.NovaFirestore || {};

    /* ==========================================
       STATE
       ========================================== */
    const STATE = {
        // SECURITY: populated only after requireAuth() confirms a live
        // Firebase Authentication session (see initEditorGuard below).
        // Never read/write this from localStorage or any custom flag.
        currentUser: null,
        projectId: null,
        currentProject: null,
        folders: [],
        files: [],
        activeFile: null,
        openTabs: [],
        expandedFolders: new Set(),
        selectedFolder: null,
        activeExplorerTab: "files",
        activeRightTab: "ai",
        activeTerminalTab: "terminal",
        isExplorerOpen: true,
        isRightPanelOpen: true,
        isTerminalOpen: true,
        isSaving: false,
        isRunning: false,
        isLoading: false,
        commandPaletteOpen: false,
        contextMenu: null,
        fileContents: {},
        monaco: null,
        monacoEditor: null,
        monacoModels: new Map(),
        autoSaveTimer: null,
        previewTimer: null,
        isReadOnly: false,
        cursorPosition: { lineNumber: 1, column: 1 },
    };

    /* ==========================================
       HELPERS / UTILITIES
       ========================================== */
    const qs = (sel, scope = document) => scope.querySelector(sel);
    const qsa = (sel, scope = document) => Array.from(scope.querySelectorAll(sel));

    function debounce(fn, delay = 200) {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), delay);
        };
    }

    function storageGet(key, fallback) {
        try {
            const v = localStorage.getItem(`novaeditor:editor:${key}`);
            return v ? JSON.parse(v) : fallback;
        } catch {
            return fallback;
        }
    }

    function storageSet(key, value) {
        try {
            localStorage.setItem(`novaeditor:editor:${key}`, JSON.stringify(value));
        } catch { }
    }

    function showToast(message, type = "info") {
        if (typeof window.showToast === "function") {
            window.showToast(message, type);
        } else {
            console[type === "error" ? "error" : "log"]("[NovaEditor]", message);
        }
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    function getProjectIdFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get("project") || null;
    }

    function redirectToDashboard() {
        window.location.replace("dashboard.html");
    }

    function getLanguageFromPath(path) {
        if (!path) return "plaintext";
        const lower = path.toLowerCase();
        if (lower.endsWith(".tsx") || lower.endsWith(".ts")) return "typescript";
        if (lower.endsWith(".jsx") || lower.endsWith(".js")) return "javascript";
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
        if (lower.endsWith(".css")) return "css";
        if (lower.endsWith(".json")) return "json";
        if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
        if (lower.endsWith(".py")) return "python";
        return "plaintext";
    }

    function getLanguageLabel(path) {
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

    function getFileIconClass(path) {
        if (!path) return "ri-file-line tab-icon";
        if (path.endsWith(".jsx") || path.endsWith(".tsx")) return "ri-reactjs-line tab-icon jsx";
        if (path.endsWith(".js") || path.endsWith(".ts")) return "ri-javascript-fill tab-icon js";
        if (path.endsWith(".css")) return "ri-css3-fill tab-icon css";
        if (path.endsWith(".html") || path.endsWith(".htm")) return "ri-html5-fill tab-icon html";
        if (path.endsWith(".json")) return "ri-file-code-line tab-icon json";
        if (path.endsWith(".md")) return "ri-markdown-fill tab-icon md";
        if (path.endsWith(".py")) return "ri-code-s-slash-line tab-icon";
        return "ri-file-line tab-icon";
    }

    function hasUnsavedChanges() {
        return STATE.openTabs.some((t) => t.dirty);
    }

    /* ==========================================
       SECURITY: Project Ownership Check
       ------------------------------------------
       A frontend check like this is a UX/defense-
       in-depth layer, not a substitute for
       Firestore security rules — but it stops the
       editor from ever rendering another user's
       project data client-side, and it fails
       closed (denies) whenever ownership can't be
       positively confirmed.

       NOTE: this assumes project documents expose
       the owner's uid as `uid` (the same field
       name used elsewhere in this app, e.g.
       createUser(user.uid, { uid: user.uid, ... })
       in login.js). If firestore.js's project
       schema uses a different field name, update
       OWNER_FIELD_CANDIDATES to match — do not
       remove this check.
       ========================================== */
    const OWNER_FIELD_CANDIDATES = ["uid", "ownerId", "ownerUid", "userId"];

    function projectBelongsToUser(project, user) {
        if (!project || !user) return false;

        for (const field of OWNER_FIELD_CANDIDATES) {
            if (Object.prototype.hasOwnProperty.call(project, field)) {
                return project[field] === user.uid;
            }
        }

        // No recognizable owner field on the project document at all —
        // fail closed rather than silently trusting an unverifiable
        // project.
        console.error(
            "[NovaEditor] Could not find an owner field on the project document; denying access."
        );
        return false;
    }

    /* ==========================================
       MONACO EDITOR
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

    async function initMonaco() {
        const container = qs("#monacoEditorShell") || qs("#editorCodeArea")?.parentElement;
        if (!container) return;

        try {
            const monaco = await loadMonacoScript();
            STATE.monaco = monaco;

            // Clear any previous textarea content area
            const existingTextarea = qs("#editorCodeArea");
            if (existingTextarea) existingTextarea.style.display = "none";

            let editorEl = qs("#monacoContainer");
            if (!editorEl) {
                editorEl = document.createElement("div");
                editorEl.id = "monacoContainer";
                editorEl.style.cssText = "width:100%;height:100%;min-height:200px;";
                container.appendChild(editorEl);
            }

            if (STATE.monacoEditor) {
                STATE.monacoEditor.dispose();
            }

            STATE.monacoEditor = monaco.editor.create(editorEl, {
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
                readOnly: STATE.isReadOnly,
                padding: { top: 8 },
            });

            STATE.monacoEditor.onDidChangeModelContent(() => {
                onEditorContentChange();
            });

            STATE.monacoEditor.onDidChangeCursorPosition((e) => {
                STATE.cursorPosition = {
                    lineNumber: e.position.lineNumber,
                    column: e.position.column,
                };
                updateStatusBar();
            });

            // Restore active file model if any
            if (STATE.activeFile) {
                await setMonacoModel(STATE.activeFile);
            }
        } catch (err) {
            console.error("[NovaEditor] initMonaco failed:", err);
            showToast("Monaco Editor failed to load. Falling back to basic editor.", "error");
        }
    }

    function getOrCreateModel(path, content = "") {
        if (!STATE.monaco) return null;

        if (STATE.monacoModels.has(path)) {
            const model = STATE.monacoModels.get(path);
            if (model.getValue() !== content && content !== undefined) {
                // Only update if external change
            }
            return model;
        }

        const language = getLanguageFromPath(path);
        const uri = STATE.monaco.Uri.parse(`file:///${path}`);
        const model = STATE.monaco.editor.createModel(content || "", language, uri);
        STATE.monacoModels.set(path, model);
        return model;
    }

    async function setMonacoModel(path) {
        if (!STATE.monacoEditor || !path) return;

        let content = STATE.fileContents[path];
        if (content === undefined) {
            const file = STATE.files.find((f) => f.path === path);
            content = file?.content ?? "";
            if (typeof FS.getFile === "function" && file?.id) {
                try {
                    const res = await FS.getFile(STATE.projectId, file.id);
                    if (res?.success && res.data) content = res.data.content ?? content;
                } catch { /* keep empty */ }
            }
            STATE.fileContents[path] = content;
        }

        const model = getOrCreateModel(path, content);
        if (model) {
            STATE.monacoEditor.setModel(model);
            const language = getLanguageFromPath(path);
            STATE.monaco.editor.setModelLanguage(model, language);
        }
        updateStatusBar();
        schedulePreviewUpdate();
    }

    function disposeUnusedModels() {
        if (!STATE.monaco) return;
        const openPaths = new Set(STATE.openTabs.map((t) => t.path));
        for (const [path, model] of STATE.monacoModels) {
            if (!openPaths.has(path)) {
                model.dispose();
                STATE.monacoModels.delete(path);
            }
        }
    }

    function onEditorContentChange() {
        if (!STATE.activeFile || !STATE.monacoEditor) return;
        const value = STATE.monacoEditor.getValue();
        STATE.fileContents[STATE.activeFile] = value;
        setTabDirty(STATE.activeFile, true);
        updateSaveStatus("unsaved");
        updateStatusBar();
        scheduleAutoSave();
        schedulePreviewUpdate();
    }

    /* ==========================================
       AUTO SAVE
       ========================================== */
    function scheduleAutoSave() {
        clearTimeout(STATE.autoSaveTimer);
        STATE.autoSaveTimer = setTimeout(() => {
            if (hasUnsavedChanges() && STATE.activeFile) {
                saveCurrentFile({ silent: true });
            }
        }, 2000);
    }

    /* ==========================================
       LIVE PREVIEW
       ========================================== */
    function schedulePreviewUpdate() {
        clearTimeout(STATE.previewTimer);
        STATE.previewTimer = setTimeout(updateLivePreview, 400);
    }

    function updateLivePreview() {
        const iframe = qs("#previewFrame") || qs("#previewIframe") || qs(".preview-iframe");
        if (!iframe) return;

        try {
            const htmlFile = STATE.files.find((f) => /\.html?$/i.test(f.path));
            const cssFiles = STATE.files.filter((f) => /\.css$/i.test(f.path));
            const jsFiles = STATE.files.filter((f) => /\.jsx?$/i.test(f.path) && !/\.tsx?$/i.test(f.path));

            let html = STATE.fileContents[htmlFile?.path] || htmlFile?.content || "<!DOCTYPE html><html><body><p>No HTML file open.</p></body></html>";
            let css = cssFiles.map((f) => STATE.fileContents[f.path] || f.content || "").join("\n");
            let js = jsFiles.map((f) => STATE.fileContents[f.path] || f.content || "").join("\n");

            // Prefer currently active file content if matching
            if (STATE.activeFile) {
                if (/\.html?$/i.test(STATE.activeFile)) html = STATE.fileContents[STATE.activeFile] || html;
                if (/\.css$/i.test(STATE.activeFile)) css = STATE.fileContents[STATE.activeFile] || css;
                if (/\.jsx?$/i.test(STATE.activeFile)) js = STATE.fileContents[STATE.activeFile] || js;
            }

            const doc = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${css}</style>
</head>
<body>
${html.replace(/<\/?html[^>]*>/gi, "").replace(/<\/?head[^>]*>[\s\S]*?<\/head>/gi, "").replace(/<\/?body[^>]*>/gi, "")}
<script>
try { ${js} } catch(e) { console.error(e); }
<\/script>
</body>
</html>`;

            iframe.srcdoc = doc;
        } catch (err) {
            console.error("[NovaEditor] preview failed:", err);
            showToast("Preview update failed.", "error");
        }
    }

    /* ==========================================
       PROJECT LOADING
       ========================================== */
    async function loadProject() {
        const projectId = getProjectIdFromUrl();

        if (!projectId) {
            redirectToDashboard();
            return false;
        }

        STATE.projectId = projectId;
        STATE.isLoading = true;
        setExplorerSkeleton(true);
        setEditorSkeleton(true);

        try {
            if (typeof FS.getProject !== "function") {
                throw new Error("getProject is not available");
            }

            const projRes = await FS.getProject(projectId);

            if (!projRes || !projRes.success || !projRes.data) {
                const msg = (projRes && (projRes.error || projRes.message)) || "";
                if (String(msg).toLowerCase().includes("permission") || String(msg).toLowerCase().includes("denied")) {
                    showToast("Permission denied.", "error");
                } else {
                    showToast("Project not found or access denied.", "error");
                }
                redirectToDashboard();
                return false;
            }

            // SECURITY: never trust the URL's projectId alone. Confirm the
            // project document actually belongs to the authenticated user
            // (STATE.currentUser, set by initEditorGuard() before this
            // function ever runs) before any project/folder/file data is
            // stored in STATE or rendered.
            if (!projectBelongsToUser(projRes.data, STATE.currentUser)) {
                showToast("You don't have access to this project.", "error");
                redirectToDashboard();
                return false;
            }

            STATE.currentProject = projRes.data;

            const [foldersRes, filesRes] = await Promise.all([
                typeof FS.getFolders === "function" ? FS.getFolders(projectId) : Promise.resolve({ success: true, data: [] }),
                typeof FS.getFiles === "function" ? FS.getFiles(projectId) : Promise.resolve({ success: true, data: [] }),
            ]);

            // SECURITY: a failed Firestore response must never be silently
            // downgraded to an empty array. An empty *successful* result
            // (success: true, data: []) is a legitimate, valid state and
            // must NOT be treated as an error. Only a missing/failed
            // response halts loading — in that case we must not store
            // fallback data, render the explorer, restore the session, or
            // proceed to initMonaco().
            if (
                !foldersRes ||
                !foldersRes.success ||
                !filesRes ||
                !filesRes.success
            ) {
                showToast("Could not load project files.", "error");
                redirectToDashboard();
                return false;
            }

            STATE.folders = foldersRes.data || [];
            STATE.files = filesRes.data || [];

            const savedExpanded = storageGet(`expandedFolders:${projectId}`, []);
            STATE.expandedFolders = new Set(savedExpanded);

            renderExplorer();
            restoreSession();
            updateProjectTitle();
            updateStatusBar();

            return true;
        } catch (err) {
            console.error("[NovaEditor] loadProject failed:", err);
            showToast("Network error. Could not load project.", "error");
            redirectToDashboard();
            return false;
        } finally {
            STATE.isLoading = false;
            setExplorerSkeleton(false);
            setEditorSkeleton(false);
        }
    }

    function setExplorerSkeleton(show) {
        const tree = qs("#explorerTree");
        if (!tree) return;
        if (show) {
            tree.innerHTML = `
        <div class="skeleton-block" style="height:14px;margin:10px 12px;border-radius:4px;width:70%"></div>
        <div class="skeleton-block" style="height:14px;margin:10px 12px;border-radius:4px;width:55%"></div>
        <div class="skeleton-block" style="height:14px;margin:10px 12px;border-radius:4px;width:80%"></div>
        <div class="skeleton-block" style="height:14px;margin:10px 12px;border-radius:4px;width:45%"></div>`;
        }
    }

    function setEditorSkeleton(show) {
        const shell = qs("#monacoEditorShell") || qs("#editorMainArea");
        if (!shell) return;
        shell.classList.toggle("is-loading", show);
    }

    function updateProjectTitle() {
        const name = STATE.currentProject?.name || "Untitled";
        document.title = `${name} — Nova Editor`;
        const titleEl = qs("#editorProjectName") || qs(".editor-project-name");
        if (titleEl) titleEl.textContent = name;
    }

    /* ==========================================
       SESSION (tabs / active file)
       ========================================== */
    function restoreSession() {
        const projectId = STATE.projectId;
        if (!projectId) return;

        const savedTabs = storageGet(`openTabs:${projectId}`, []);
        const savedActive = storageGet(`activeFile:${projectId}`, null);

        STATE.openTabs = [];

        if (Array.isArray(savedTabs) && savedTabs.length) {
            savedTabs.forEach((t) => {
                const file = STATE.files.find((f) => f.path === t.path || f.id === t.id);
                if (file) {
                    STATE.openTabs.push({
                        id: t.id || `tab-${file.id || Date.now()}`,
                        path: file.path,
                        name: file.name || file.path.split("/").pop(),
                        fileId: file.id,
                        dirty: false,
                    });
                }
            });
        }

        renderTabs();

        if (STATE.openTabs.length) {
            const activePath = savedActive && STATE.openTabs.some((t) => t.path === savedActive)
                ? savedActive
                : STATE.openTabs[0].path;
            selectFile(activePath);
            showEmptyState(false);
        } else {
            showEmptyState(true);
        }
    }

    function persistSession() {
        if (!STATE.projectId) return;
        storageSet(`openTabs:${STATE.projectId}`, STATE.openTabs.map((t) => ({
            id: t.id,
            path: t.path,
            name: t.name,
            fileId: t.fileId,
        })));
        storageSet(`activeFile:${STATE.projectId}`, STATE.activeFile);
        storageSet(`expandedFolders:${STATE.projectId}`, [...STATE.expandedFolders]);
    }

    /* ==========================================
       EXPLORER — render from Firestore data
       ========================================== */
    function initExplorer() {
        const tree = qs("#explorerTree");
        if (!tree) return;

        tree.addEventListener("click", (e) => {
            const chevron = e.target.closest(".tree-chevron");
            const row = e.target.closest(".tree-row");
            if (!row) return;

            const item = row.closest(".tree-item");
            if (!item) return;

            if (chevron || (item.classList.contains("tree-folder") && !e.target.closest(".tree-label"))) {
                e.preventDefault();
                e.stopPropagation();
                toggleFolder(item);
                return;
            }

            if (item.classList.contains("tree-file")) {
                const path = item.dataset.path;
                if (path) selectFile(path);
            }
        });

        qsa("[data-explorer-tab]").forEach((btn) => {
            btn.addEventListener("click", () => {
                switchExplorerTab(btn.dataset.explorerTab);
            });
        });

        const searchInput = qs("#explorerSearchInput");
        const clearBtn = qs("#explorerSearchClear");
        if (searchInput) {
            searchInput.addEventListener("input", debounce(() => {
                filterExplorer(searchInput.value.trim());
                if (clearBtn) clearBtn.hidden = !searchInput.value;
            }, 150));
        }
        if (clearBtn) {
            clearBtn.addEventListener("click", () => {
                searchInput.value = "";
                clearBtn.hidden = true;
                filterExplorer("");
                searchInput.focus();
            });
        }

        const collapseBtn = qs("#explorerCollapseBtn");
        if (collapseBtn) {
            collapseBtn.addEventListener("click", () => {
                STATE.expandedFolders.clear();
                applyExpandedFolders();
                persistSession();
            });
        }
    }

    function buildTreeData() {
        const folderMap = new Map();
        const root = { name: "", path: "", children: [], files: [] };

        (STATE.folders || []).forEach((f) => {
            const path = f.path || f.name || "";
            folderMap.set(path, {
                id: f.id,
                name: f.name || path.split("/").pop(),
                path,
                children: [],
                files: [],
            });
        });

        folderMap.forEach((folder) => {
            const parts = folder.path.split("/").filter(Boolean);
            if (parts.length <= 1) {
                root.children.push(folder);
            } else {
                const parentPath = parts.slice(0, -1).join("/");
                const parent = folderMap.get(parentPath) || root;
                parent.children.push(folder);
            }
        });

        (STATE.files || []).forEach((file) => {
            const path = file.path || file.name || "";
            const parts = path.split("/").filter(Boolean);
            const parentPath = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
            const parent = parentPath ? (folderMap.get(parentPath) || root) : root;
            parent.files.push({
                id: file.id,
                name: file.name || parts[parts.length - 1] || path,
                path,
            });
        });

        const sortNode = (node) => {
            node.children.sort((a, b) => a.name.localeCompare(b.name));
            node.files.sort((a, b) => a.name.localeCompare(b.name));
            node.children.forEach(sortNode);
        };
        sortNode(root);
        return root;
    }

    function renderExplorer() {
        const tree = qs("#explorerTree");
        if (!tree) return;

        const root = buildTreeData();

        if ((!STATE.folders || STATE.folders.length === 0) && (!STATE.files || STATE.files.length === 0)) {
            tree.innerHTML = `<div class="panel-empty premium-empty">
        <i class="ri-folder-open-line" style="font-size:28px;opacity:0.4"></i>
        <p>No files yet</p>
        <small>Right-click to create a file or folder</small>
      </div>`;
            return;
        }

        const renderNode = (node, depth = 0) => {
            let html = "";

            node.children.forEach((folder) => {
                const isOpen = STATE.expandedFolders.has(folder.path);
                html += `
          <div class="tree-item tree-folder ${isOpen ? "open" : ""}" data-path="${escapeHtml(folder.path)}" data-id="${escapeHtml(folder.id || "")}" aria-expanded="${isOpen}">
            <div class="tree-row" style="padding-left:${8 + depth * 14}px">
              <button type="button" class="tree-chevron" aria-label="Toggle folder"><i class="ri-arrow-right-s-line"></i></button>
              <i class="ri-folder-3-fill tree-icon folder"></i>
              <span class="tree-label">${escapeHtml(folder.name)}</span>
            </div>
            <div class="tree-children" ${isOpen ? "" : "hidden"}>
              ${renderNode(folder, depth + 1)}
            </div>
          </div>`;
            });

            node.files.forEach((file) => {
                const isActive = STATE.activeFile === file.path;
                html += `
          <div class="tree-item tree-file ${isActive ? "active" : ""}" data-path="${escapeHtml(file.path)}" data-id="${escapeHtml(file.id || "")}">
            <div class="tree-row" style="padding-left:${8 + depth * 14}px">
              <span class="tree-chevron-spacer"></span>
              <i class="${getFileIconClass(file.path)} tree-icon"></i>
              <span class="tree-label">${escapeHtml(file.name)}</span>
            </div>
          </div>`;
            });

            return html;
        };

        tree.innerHTML = renderNode(root);
    }

    function toggleFolder(item) {
        const path = item.dataset.path;
        if (!path) return;

        const isOpen = item.classList.contains("open");
        if (isOpen) {
            item.classList.remove("open");
            item.setAttribute("aria-expanded", "false");
            STATE.expandedFolders.delete(path);
            const children = item.querySelector(":scope > .tree-children");
            if (children) children.hidden = true;
        } else {
            item.classList.add("open");
            item.setAttribute("aria-expanded", "true");
            STATE.expandedFolders.add(path);
            const children = item.querySelector(":scope > .tree-children");
            if (children) children.hidden = false;
        }
        persistSession();
    }

    function applyExpandedFolders() {
        qsa(".tree-folder").forEach((folder) => {
            const path = folder.dataset.path;
            const shouldOpen = STATE.expandedFolders.has(path);
            folder.classList.toggle("open", shouldOpen);
            folder.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
            const children = folder.querySelector(":scope > .tree-children");
            if (children) children.hidden = !shouldOpen;
        });
    }

    async function selectFile(path) {
        if (!path) return;

        STATE.activeFile = path;

        qsa(".tree-file").forEach((el) => {
            el.classList.toggle("active", el.dataset.path === path);
        });

        openOrFocusTab(path);
        updateBreadcrumb(path);
        await setMonacoModel(path);
        updateStatusBar();
        persistSession();
    }

    function switchExplorerTab(tab) {
        STATE.activeExplorerTab = tab;
        qsa("[data-explorer-tab]").forEach((btn) => {
            const isActive = btn.dataset.explorerTab === tab;
            btn.classList.toggle("active", isActive);
            btn.setAttribute("aria-selected", isActive ? "true" : "false");
        });
        qsa(".explorer-view").forEach((view) => {
            const id = view.id.replace("explorerView", "").toLowerCase();
            const match = id === tab || (tab === "files" && id === "files");
            view.classList.toggle("active", match);
            view.hidden = !match;
        });
    }

    function filterExplorer(query) {
        const lower = query.toLowerCase();
        qsa(".tree-item").forEach((item) => {
            if (item.classList.contains("tree-folder")) {
                const label = item.querySelector(".tree-label")?.textContent?.toLowerCase() || "";
                const hasMatch = !query || label.includes(lower) || !!item.querySelector(`.tree-file[data-path*="${lower}"]`);
                item.style.display = hasMatch || !query ? "" : "none";
            } else {
                const path = (item.dataset.path || "").toLowerCase();
                const label = item.querySelector(".tree-label")?.textContent?.toLowerCase() || "";
                item.style.display = !query || path.includes(lower) || label.includes(lower) ? "" : "none";
            }
        });
    }

    /* ==========================================
       TABS
       ========================================== */
    function initTabs() {
        const list = qs("#tabsList");
        if (!list) return;

        list.addEventListener("click", (e) => {
            const closeBtn = e.target.closest(".tab-close");
            const tabEl = e.target.closest(".editor-tab");
            if (!tabEl) return;

            if (closeBtn) {
                e.stopPropagation();
                closeTab(tabEl.dataset.tabId);
                return;
            }
            switchTab(tabEl.dataset.tabId);
        });

        list.addEventListener("auxclick", (e) => {
            if (e.button === 1) {
                const tabEl = e.target.closest(".editor-tab");
                if (tabEl) {
                    e.preventDefault();
                    closeTab(tabEl.dataset.tabId);
                }
            }
        });
    }

    function openOrFocusTab(path) {
        const existing = STATE.openTabs.find((t) => t.path === path);
        if (existing) {
            switchTab(existing.id);
            return;
        }

        const file = STATE.files.find((f) => f.path === path);
        const name = file?.name || path.split("/").pop();
        const id = `tab-${file?.id || Date.now()}`;
        STATE.openTabs.push({
            id,
            path,
            name,
            fileId: file?.id || null,
            dirty: false,
        });
        renderTabs();
        switchTab(id);
        showEmptyState(false);
        persistSession();
    }

    function switchTab(tabId) {
        const tab = STATE.openTabs.find((t) => t.id === tabId);
        if (!tab) return;

        STATE.activeFile = tab.path;

        qsa(".editor-tab").forEach((el) => {
            const isActive = el.dataset.tabId === tabId;
            el.classList.toggle("active", isActive);
            el.setAttribute("aria-selected", isActive ? "true" : "false");
        });

        qsa(".tree-file").forEach((el) => {
            el.classList.toggle("active", el.dataset.path === tab.path);
        });

        updateBreadcrumb(tab.path);
        setMonacoModel(tab.path);
        updateStatusBar();
        persistSession();
    }

    function closeTab(tabId) {
        const idx = STATE.openTabs.findIndex((t) => t.id === tabId);
        if (idx === -1) return;

        const tab = STATE.openTabs[idx];
        if (tab.dirty) {
            if (!confirm(`"${tab.name}" has unsaved changes. Close anyway?`)) return;
        }

        const wasActive = tab.path === STATE.activeFile;
        STATE.openTabs.splice(idx, 1);
        disposeUnusedModels();
        renderTabs();
        persistSession();

        if (wasActive) {
            if (STATE.openTabs.length) {
                const next = STATE.openTabs[Math.min(idx, STATE.openTabs.length - 1)];
                switchTab(next.id);
            } else {
                STATE.activeFile = null;
                if (STATE.monacoEditor) STATE.monacoEditor.setModel(null);
                showEmptyState(true);
            }
        }
    }

    function renderTabs() {
        const list = qs("#tabsList");
        if (!list) return;

        if (STATE.openTabs.length === 0) {
            list.innerHTML = `<div class="panel-empty premium-empty" style="padding:8px 12px;font-size:12px">No open tabs</div>`;
            return;
        }

        list.innerHTML = STATE.openTabs
            .map((t) => {
                const iconClass = getFileIconClass(t.path);
                return `
        <div class="editor-tab ${t.path === STATE.activeFile ? "active" : ""}" role="tab"
             aria-selected="${t.path === STATE.activeFile}" data-tab-id="${t.id}" data-path="${escapeHtml(t.path)}" draggable="true">
          <i class="${iconClass} tab-icon"></i>
          <span class="tab-name">${escapeHtml(t.name)}</span>
          <span class="tab-dirty" title="Unsaved changes" ${t.dirty ? "" : "hidden"}>•</span>
          <button type="button" class="tab-close" aria-label="Close ${escapeHtml(t.name)}" title="Close">
            <i class="ri-close-line"></i>
          </button>
        </div>`;
            })
            .join("");
    }

    function setTabDirty(path, dirty = true) {
        const tab = STATE.openTabs.find((t) => t.path === path);
        if (tab) {
            tab.dirty = dirty;
            const el = qs(`.editor-tab[data-path="${CSS.escape(path)}"] .tab-dirty`);
            if (el) el.hidden = !dirty;
        }
    }

    function showEmptyState(show) {
        const empty = qs("#editorEmptyState");
        const shell = qs("#monacoEditorShell");
        if (empty) {
            empty.hidden = !show;
            if (show) {
                empty.innerHTML = `
          <div class="premium-empty">
            <i class="ri-code-s-slash-line" style="font-size:40px;opacity:0.35"></i>
            <p>No file open</p>
            <small>Select a file from the explorer or create a new one</small>
          </div>`;
            }
        }
        if (shell) shell.style.display = show ? "none" : "flex";
        const monacoEl = qs("#monacoContainer");
        if (monacoEl) monacoEl.style.display = show ? "none" : "block";
    }

    /* ==========================================
       SAVE
       ========================================== */
    function updateSaveStatus(status) {
        const saveStatus = qs("#saveStatus");
        if (!saveStatus) return;
        saveStatus.dataset.status = status;
        const textEl = saveStatus.querySelector(".status-text");
        if (!textEl) return;
        const labels = {
            saving: "Saving...",
            saved: "Saved",
            unsaved: "Unsaved",
            error: "Error",
        };
        textEl.textContent = labels[status] || status;
    }

    async function saveCurrentFile({ silent = false } = {}) {
        if (!STATE.activeFile || !STATE.projectId) {
            if (!silent) showToast("No file open to save.", "error");
            return;
        }

        const file = STATE.files.find((f) => f.path === STATE.activeFile);
        if (!file || !file.id) {
            if (!silent) showToast("File metadata missing.", "error");
            return;
        }

        const content = STATE.monacoEditor
            ? STATE.monacoEditor.getValue()
            : (STATE.fileContents[STATE.activeFile] || "");

        updateSaveStatus("saving");
        STATE.isSaving = true;

        try {
            if (typeof FS.saveFile !== "function") {
                throw new Error("saveFile is not available");
            }

            const res = await FS.saveFile(STATE.projectId, file.id, { content });

            if (!res || !res.success) {
                const msg = (res && (res.error || res.message)) || "Save failed";
                if (String(msg).toLowerCase().includes("permission")) {
                    showToast("Permission denied.", "error");
                } else {
                    showToast("Could not save file.", "error");
                }
                updateSaveStatus("error");
                return;
            }

            STATE.fileContents[STATE.activeFile] = content;
            setTabDirty(STATE.activeFile, false);
            updateSaveStatus("saved");
            updateStatusBar();
        } catch (err) {
            console.error("[NovaEditor] saveCurrentFile:", err);
            if (!silent) showToast("Network error while saving.", "error");
            updateSaveStatus("error");
        } finally {
            STATE.isSaving = false;
        }
    }

    /* ==========================================
       FILE OPERATIONS (context menu)
       ========================================== */
    async function handleNewFile(parentPath = "") {
        const name = prompt("New file name:", "untitled.js");
        if (!name || !name.trim()) return;

        const path = parentPath ? `${parentPath}/${name.trim()}` : name.trim();

        try {
            if (typeof FS.createFile !== "function") {
                showToast("createFile is not available.", "error");
                return;
            }
            const res = await FS.createFile(STATE.projectId, {
                name: name.trim(),
                path,
                content: "",
                parentPath: parentPath || null,
            });
            if (!res || !res.success) {
                showToast("Could not create file.", "error");
                return;
            }
            await refreshProjectFiles();
            selectFile(path);
            showToast("File created.", "success");
        } catch (err) {
            console.error(err);
            showToast("Network error creating file.", "error");
        }
    }

    async function handleNewFolder(parentPath = "") {
        const name = prompt("New folder name:", "new-folder");
        if (!name || !name.trim()) return;

        const path = parentPath ? `${parentPath}/${name.trim()}` : name.trim();

        try {
            if (typeof FS.createFolder !== "function") {
                showToast("createFolder is not available.", "error");
                return;
            }
            const res = await FS.createFolder(STATE.projectId, {
                name: name.trim(),
                path,
                parentPath: parentPath || null,
            });
            if (!res || !res.success) {
                showToast("Could not create folder.", "error");
                return;
            }
            STATE.expandedFolders.add(path);
            await refreshProjectFiles();
            showToast("Folder created.", "success");
        } catch (err) {
            console.error(err);
            showToast("Network error creating folder.", "error");
        }
    }

    async function handleRename(item) {
        if (!item) return;
        const path = item.dataset.path;
        const id = item.dataset.id;
        const isFolder = item.classList.contains("tree-folder");
        const currentName = path.split("/").pop();
        const newName = prompt("Rename to:", currentName);
        if (!newName || !newName.trim() || newName.trim() === currentName) return;

        try {
            const fn = isFolder ? FS.renameFolder : FS.renameFile;
            if (typeof fn !== "function") {
                showToast("Rename is not available.", "error");
                return;
            }
            const res = await fn(STATE.projectId, id, { name: newName.trim() });
            if (!res || !res.success) {
                showToast("Could not rename.", "error");
                return;
            }
            await refreshProjectFiles();
            showToast("Renamed.", "success");
        } catch (err) {
            console.error(err);
            showToast("Network error during rename.", "error");
        }
    }

    async function handleDelete(item) {
        if (!item) return;
        const path = item.dataset.path;
        const id = item.dataset.id;
        const isFolder = item.classList.contains("tree-folder");
        const label = path.split("/").pop();

        if (!confirm(`Delete ${isFolder ? "folder" : "file"} "${label}"?`)) return;

        try {
            const fn = isFolder ? FS.deleteFolder : FS.deleteFile;
            if (typeof fn !== "function") {
                showToast("Delete is not available.", "error");
                return;
            }
            const res = await fn(STATE.projectId, id);
            if (!res || !res.success) {
                showToast("Could not delete.", "error");
                return;
            }

            const tab = STATE.openTabs.find((t) => t.path === path);
            if (tab) closeTab(tab.id);

            await refreshProjectFiles();
            showToast("Deleted.", "success");
        } catch (err) {
            console.error(err);
            showToast("Network error during delete.", "error");
        }
    }

    async function refreshProjectFiles() {
        if (!STATE.projectId) return;
        try {
            const [foldersRes, filesRes] = await Promise.all([
                typeof FS.getFolders === "function" ? FS.getFolders(STATE.projectId) : Promise.resolve({ success: true, data: [] }),
                typeof FS.getFiles === "function" ? FS.getFiles(STATE.projectId) : Promise.resolve({ success: true, data: [] }),
            ]);
            STATE.folders = (foldersRes && foldersRes.success && foldersRes.data) ? foldersRes.data : [];
            STATE.files = (filesRes && filesRes.success && filesRes.data) ? filesRes.data : [];
            renderExplorer();
        } catch (err) {
            console.error("[NovaEditor] refreshProjectFiles:", err);
            showToast("Could not refresh file tree.", "error");
        }
    }

    /* ==========================================
       RIGHT PANEL (AI / Preview / Console)
       ========================================== */
    function initRightPanel() {
        qsa("[data-right-tab]").forEach((btn) => {
            btn.addEventListener("click", () => switchRightTab(btn.dataset.rightTab));
        });

        const closeBtn = qs("#rightPanelCloseBtn");
        if (closeBtn) {
            closeBtn.addEventListener("click", () => toggleRightPanel(false));
        }

        qsa("[data-ai-action]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const action = btn.dataset.aiAction;
                const prompts = {
                    explain: "Explain the selected code in simple terms.",
                    fix: "Find and fix bugs in this code.",
                    refactor: "Refactor this code for better readability and performance.",
                    generate: "Generate code based on the following description:",
                    comments: "Add clear comments to this code.",
                    docs: "Generate documentation for this file.",
                };
                const input = qs("#aiInput");
                if (input) {
                    input.value = prompts[action] || "";
                    input.focus();
                }
            });
        });

        const sendBtn = qs("#aiSendBtn");
        const aiInput = qs("#aiInput");
        if (sendBtn && aiInput) {
            sendBtn.addEventListener("click", sendAIMessage);
            aiInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendAIMessage();
                }
            });
        }

        qsa(".console-filter").forEach((btn) => {
            btn.addEventListener("click", () => {
                qsa(".console-filter").forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
            });
        });

        const clearConsole = qs("#consoleClearBtn");
        if (clearConsole) {
            clearConsole.addEventListener("click", () => {
                const out = qs("#consoleOutput");
                if (out) out.innerHTML = "";
            });
        }
    }

    function switchRightTab(tab) {
        STATE.activeRightTab = tab;
        qsa("[data-right-tab]").forEach((btn) => {
            const isActive = btn.dataset.rightTab === tab;
            btn.classList.toggle("active", isActive);
            btn.setAttribute("aria-selected", isActive ? "true" : "false");
        });
        qsa(".right-view").forEach((view) => {
            const id = view.id.replace("rightView", "").toLowerCase();
            const match = id === tab;
            view.classList.toggle("active", match);
            view.hidden = !match;
        });
        if (tab === "preview") schedulePreviewUpdate();
    }

    async function sendAIMessage() {
        const input = qs("#aiInput");
        const chat = qs("#aiChat");
        if (!input || !chat || !input.value.trim()) return;

        const text = input.value.trim();
        input.value = "";

        const userMsg = document.createElement("div");
        userMsg.className = "ai-message user";
        userMsg.innerHTML = `<div class="ai-bubble">${escapeHtml(text)}</div>`;
        chat.appendChild(userMsg);
        chat.scrollTop = chat.scrollHeight;

        const reply = document.createElement("div");
        reply.className = "ai-message assistant";
        reply.innerHTML = `<div class="ai-bubble">AI is not connected yet. This is a placeholder for a future async AI response.</div>`;
        chat.appendChild(reply);
        chat.scrollTop = chat.scrollHeight;
    }

    function toggleRightPanel(force) {
        const panel = qs("#rightPanel");
        const topRow = qs("#editorTopRow");
        if (!panel || !topRow) return;

        const open = force !== undefined ? force : !STATE.isRightPanelOpen;
        STATE.isRightPanelOpen = open;
        panel.classList.toggle("open", open);
        topRow.classList.toggle("right-hidden", !open);
    }

    /* ==========================================
       TERMINAL (UI only)
       ========================================== */
    function initTerminal() {
        qsa("[data-terminal-tab]").forEach((btn) => {
            btn.addEventListener("click", () => switchTerminalTab(btn.dataset.terminalTab));
        });

        const closeBtn = qs("#terminalCloseBtn");
        if (closeBtn) {
            closeBtn.addEventListener("click", () => toggleTerminal(false));
        }

        const termInput = qs("#terminalInput");
        if (termInput) {
            termInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    const cmd = termInput.value.trim();
                    if (cmd) {
                        appendTerminalLine(cmd, true);
                        termInput.value = "";
                        setTimeout(() => {
                            appendTerminalLine("(terminal backend not connected)", false);
                        }, 200);
                    }
                }
            });
        }
    }

    function switchTerminalTab(tab) {
        STATE.activeTerminalTab = tab;
        qsa("[data-terminal-tab]").forEach((btn) => {
            const isActive = btn.dataset.terminalTab === tab;
            btn.classList.toggle("active", isActive);
            btn.setAttribute("aria-selected", isActive ? "true" : "false");
        });
        qsa(".terminal-view").forEach((view) => {
            const id = view.id.replace("terminalView", "").toLowerCase();
            const match = id === tab;
            view.classList.toggle("active", match);
            view.hidden = !match;
        });
    }

    function appendTerminalLine(text, isCmd) {
        const out = qs("#terminalOutput");
        if (!out) return;
        const line = document.createElement("div");
        line.className = "term-line";
        const projectName = STATE.currentProject?.name || "project";
        if (isCmd) {
            line.innerHTML = `<span class="term-prompt">nova-editor</span><span class="term-path">~/${escapeHtml(projectName)}</span><span class="term-symbol">$</span><span class="term-cmd">${escapeHtml(text)}</span>`;
        } else {
            line.innerHTML = `<span class="term-line muted">${escapeHtml(text)}</span>`;
        }
        out.appendChild(line);
        out.scrollTop = out.scrollHeight;
    }

    function toggleTerminal(force) {
        const panel = qs("#terminalPanel");
        const main = qs("#editorMainArea");
        if (!panel || !main) return;

        const open = force !== undefined ? force : !STATE.isTerminalOpen;
        STATE.isTerminalOpen = open;
        main.classList.toggle("terminal-hidden", !open);
    }

    /* ==========================================
       RESIZABLE PANELS
       ========================================== */
    function initResizers() {
        setupResizer("explorerResizer", "explorerPanel", "horizontal", 180, 420);
        setupResizer("rightPanelResizer", "rightPanel", "horizontal", 260, 520, true);
        setupResizer("terminalResizer", "terminalPanel", "vertical", 100, window.innerHeight * 0.5);
    }

    function setupResizer(resizerId, panelId, direction, min, max, reverse = false) {
        const resizer = qs(`#${resizerId}`);
        const panel = qs(`#${panelId}`);
        if (!resizer || !panel) return;

        let startPos = 0;
        let startSize = 0;

        const onMouseDown = (e) => {
            e.preventDefault();
            resizer.classList.add("active");
            startPos = direction === "horizontal" ? e.clientX : e.clientY;
            startSize = direction === "horizontal" ? panel.offsetWidth : panel.offsetHeight;

            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
        };

        const onMouseMove = (e) => {
            const current = direction === "horizontal" ? e.clientX : e.clientY;
            let delta = current - startPos;
            if (reverse) delta = -delta;

            let newSize = Math.min(max, Math.max(min, startSize + delta));
            if (direction === "horizontal") {
                panel.style.width = `${newSize}px`;
            } else {
                panel.style.height = `${newSize}px`;
            }
        };

        const onMouseUp = () => {
            resizer.classList.remove("active");
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };

        resizer.addEventListener("mousedown", onMouseDown);
    }

    /* ==========================================
       TOOLBAR
       ========================================== */
    function initToolbar() {
        const runBtn = qs("#btnRun");
        if (runBtn) {
            runBtn.addEventListener("click", () => {
                if (STATE.isRunning) return;
                STATE.isRunning = true;
                runBtn.classList.add("loading");
                runBtn.innerHTML = `<i class="ri-loader-4-line"></i><span>Running...</span>`;

                setTimeout(() => {
                    STATE.isRunning = false;
                    runBtn.classList.remove("loading");
                    runBtn.innerHTML = `<i class="ri-play-fill"></i><span>Run</span>`;
                    switchTerminalTab("terminal");
                    switchRightTab("preview");
                    appendTerminalLine("(run backend not connected)", false);
                    schedulePreviewUpdate();
                }, 1200);
            });
        }

        const previewBtn = qs("#btnPreview");
        if (previewBtn) {
            previewBtn.addEventListener("click", () => {
                toggleRightPanel(true);
                switchRightTab("preview");
                schedulePreviewUpdate();
            });
        }

        const aiBtn = qs("#btnAI");
        if (aiBtn) {
            aiBtn.addEventListener("click", () => {
                toggleRightPanel(true);
                switchRightTab("ai");
            });
        }

        const saveBtn = qs("#btnSave") || qs("[data-action='save']");
        if (saveBtn) {
            saveBtn.addEventListener("click", () => saveCurrentFile());
        }
    }

    /* ==========================================
       BREADCRUMB + STATUS BAR
       ========================================== */
    function updateBreadcrumb(path) {
        const nav = qs("#editorBreadcrumb .breadcrumb-list");
        if (!nav || !path) return;

        const parts = path.split("/").filter(Boolean);
        let html = "";
        let current = "";
        parts.forEach((part, i) => {
            current += (i ? "/" : "") + part;
            if (i < parts.length - 1) {
                html += `<li class="breadcrumb-item"><a href="#" class="breadcrumb-link" data-path="${escapeHtml(current)}">${escapeHtml(part)}</a></li>`;
                html += `<li class="breadcrumb-sep" aria-hidden="true"><i class="ri-arrow-right-s-line"></i></li>`;
            } else {
                html += `<li class="breadcrumb-item current"><span class="breadcrumb-current">${escapeHtml(part)}</span></li>`;
            }
        });
        nav.innerHTML = html;
    }

    function updateStatusBar() {
        const langEl = qs("#statusLanguage");
        if (langEl) langEl.textContent = getLanguageLabel(STATE.activeFile);

        const encodingEl = qs("#statusEncoding");
        if (encodingEl) encodingEl.textContent = "UTF-8";

        const eolEl = qs("#statusEol");
        if (eolEl) eolEl.textContent = "LF";

        const cursorEl = qs("#statusCursor");
        if (cursorEl) {
            cursorEl.textContent = `Ln ${STATE.cursorPosition.lineNumber}, Col ${STATE.cursorPosition.column}`;
        }

        const projectEl = qs("#statusProject");
        if (projectEl) projectEl.textContent = STATE.currentProject?.name || "—";

        const autoSaveEl = qs("#statusAutoSave");
        if (autoSaveEl) autoSaveEl.textContent = hasUnsavedChanges() ? "Auto Save pending" : "Auto Save on";

        const readOnlyEl = qs("#statusReadOnly");
        if (readOnlyEl) readOnlyEl.textContent = STATE.isReadOnly ? "Read-only" : "";

        const gitEl = qs("#statusGit");
        if (gitEl) gitEl.textContent = ""; // placeholder for future Git status
    }

    /* ==========================================
       COMMAND PALETTE
       ========================================== */
    function initCommandPalette() {
        if (!qs("#commandPalette")) {
            const el = document.createElement("div");
            el.id = "commandPalette";
            el.className = "command-palette";
            el.hidden = true;
            el.innerHTML = `
        <div class="command-palette-backdrop"></div>
        <div class="command-palette-box">
          <div class="command-palette-input-wrap">
            <i class="ri-search-line"></i>
            <input type="text" id="commandPaletteInput" placeholder="Type a command..." autocomplete="off">
          </div>
          <ul class="command-palette-list" id="commandPaletteList"></ul>
        </div>`;
            document.body.appendChild(el);

            const style = document.createElement("style");
            style.textContent = `
        .command-palette { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: flex-start; justify-content: center; padding-top: 15vh; }
        .command-palette[hidden] { display: none; }
        .command-palette-backdrop { position: absolute; inset: 0; background: rgba(15,23,42,0.45); }
        .command-palette-box { position: relative; width: 520px; max-width: 92vw; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow-xl); overflow: hidden; }
        .command-palette-input-wrap { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
        .command-palette-input-wrap i { color: var(--text-muted); font-size: 18px; }
        .command-palette-input-wrap input { flex: 1; border: none; background: transparent; color: var(--text-primary); font-size: 15px; outline: none; }
        .command-palette-list { list-style: none; margin: 0; padding: 6px; max-height: 320px; overflow-y: auto; }
        .command-palette-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px; cursor: pointer; color: var(--text-secondary); font-size: 13.5px; }
        .command-palette-item:hover, .command-palette-item.active { background: var(--primary-light); color: var(--primary); }
        .command-palette-item kbd { margin-left: auto; font-size: 11px; color: var(--text-muted); }
      `;
            document.head.appendChild(style);
        }

        const palette = qs("#commandPalette");
        const input = qs("#commandPaletteInput");
        const list = qs("#commandPaletteList");

        const commands = [
            { id: "save", label: "File: Save", shortcut: "Ctrl+S", action: () => saveCurrentFile() },
            { id: "run", label: "Run: Start Dev Server", shortcut: "Ctrl+Enter", action: () => qs("#btnRun")?.click() },
            { id: "toggle-explorer", label: "View: Toggle Explorer", shortcut: "Ctrl+B", action: () => toggleExplorer() },
            { id: "toggle-terminal", label: "View: Toggle Terminal", shortcut: "Ctrl+`", action: () => toggleTerminal() },
            { id: "toggle-ai", label: "View: Toggle AI Panel", shortcut: "", action: () => toggleRightPanel() },
            { id: "preview", label: "View: Open Preview", shortcut: "", action: () => { toggleRightPanel(true); switchRightTab("preview"); schedulePreviewUpdate(); } },
            { id: "new-file", label: "File: New File", shortcut: "", action: () => handleNewFile(STATE.selectedFolder || "") },
            { id: "new-folder", label: "File: New Folder", shortcut: "", action: () => handleNewFolder(STATE.selectedFolder || "") },
        ];

        function renderList(filter = "") {
            const q = filter.toLowerCase();
            const filtered = commands.filter((c) => c.label.toLowerCase().includes(q));
            list.innerHTML = filtered
                .map(
                    (c, i) =>
                        `<li class="command-palette-item ${i === 0 ? "active" : ""}" data-cmd="${c.id}">
              <span>${c.label}</span>
              ${c.shortcut ? `<kbd>${c.shortcut}</kbd>` : ""}
            </li>`
                )
                .join("");
        }

        function openPalette() {
            STATE.commandPaletteOpen = true;
            palette.hidden = false;
            input.value = "";
            renderList();
            input.focus();
        }

        function closePalette() {
            STATE.commandPaletteOpen = false;
            palette.hidden = true;
        }

        input.addEventListener("input", () => renderList(input.value));
        input.addEventListener("keydown", (e) => {
            if (e.key === "Escape") closePalette();
            if (e.key === "Enter") {
                const active = qs(".command-palette-item.active");
                if (active) {
                    const cmd = commands.find((c) => c.id === active.dataset.cmd);
                    if (cmd) cmd.action();
                    closePalette();
                }
            }
        });

        list.addEventListener("click", (e) => {
            const item = e.target.closest(".command-palette-item");
            if (!item) return;
            const cmd = commands.find((c) => c.id === item.dataset.cmd);
            if (cmd) cmd.action();
            closePalette();
        });

        qs(".command-palette-backdrop")?.addEventListener("click", closePalette);

        window.NovaEditor = window.NovaEditor || {};
        window.NovaEditor.openCommandPalette = openPalette;
        window.NovaEditor.closeCommandPalette = closePalette;
    }

    /* ==========================================
       CONTEXT MENU
       ========================================== */
    function initContextMenu() {
        const menu = document.createElement("div");
        menu.id = "editorContextMenu";
        menu.className = "editor-context-menu";
        menu.hidden = true;
        menu.innerHTML = `
      <button data-action="new-file"><i class="ri-file-add-line"></i> New File</button>
      <button data-action="new-folder"><i class="ri-folder-add-line"></i> New Folder</button>
      <div class="ctx-divider"></div>
      <button data-action="rename"><i class="ri-edit-line"></i> Rename</button>
      <button data-action="delete" class="danger"><i class="ri-delete-bin-line"></i> Delete</button>
    `;
        document.body.appendChild(menu);

        const style = document.createElement("style");
        style.textContent = `
      .editor-context-menu {
        position: fixed; z-index: 10000; min-width: 180px;
        background: var(--surface); border: 1px solid var(--border);
        border-radius: 10px; box-shadow: var(--shadow-lg);
        padding: 6px; display: flex; flex-direction: column;
      }
      .editor-context-menu[hidden] { display: none; }
      .editor-context-menu button {
        display: flex; align-items: center; gap: 10px;
        padding: 8px 12px; border-radius: 6px; border: none;
        background: transparent; color: var(--text-secondary);
        font-size: 13px; text-align: left; cursor: pointer;
      }
      .editor-context-menu button:hover { background: var(--surface-secondary); color: var(--text-primary); }
      .editor-context-menu button.danger { color: var(--danger); }
      .editor-context-menu button.danger:hover { background: rgba(239,68,68,0.1); }
      .ctx-divider { height: 1px; background: var(--border); margin: 4px 0; }
    `;
        document.head.appendChild(style);

        const tree = qs("#explorerTree");
        if (tree) {
            tree.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                const item = e.target.closest(".tree-item");
                if (!item) return;
                menu.hidden = false;
                menu.style.left = `${e.clientX}px`;
                menu.style.top = `${e.clientY}px`;
                STATE.contextMenu = item;
                STATE.selectedFolder = item.classList.contains("tree-folder")
                    ? item.dataset.path
                    : (item.dataset.path || "").split("/").slice(0, -1).join("/");
            });
        }

        document.addEventListener("click", () => {
            menu.hidden = true;
            STATE.contextMenu = null;
        });

        menu.addEventListener("click", (e) => {
            const btn = e.target.closest("button");
            if (!btn) return;
            const action = btn.dataset.action;
            const item = STATE.contextMenu;
            const parentPath = STATE.selectedFolder || "";

            menu.hidden = true;

            if (action === "new-file") handleNewFile(parentPath);
            else if (action === "new-folder") handleNewFolder(parentPath);
            else if (action === "rename") handleRename(item);
            else if (action === "delete") handleDelete(item);

            STATE.contextMenu = null;
        });
    }

    /* ==========================================
       KEYBOARD SHORTCUTS
       ========================================== */
    function initKeyboard() {
        document.addEventListener("keydown", (e) => {
            const meta = e.ctrlKey || e.metaKey;

            if (meta && e.key === "s") {
                e.preventDefault();
                saveCurrentFile();
            }

            if (meta && e.shiftKey && e.key.toLowerCase() === "p") {
                e.preventDefault();
                window.NovaEditor?.openCommandPalette?.();
            }

            if (meta && !e.shiftKey && e.key.toLowerCase() === "p") {
                e.preventDefault();
                window.NovaEditor?.openCommandPalette?.();
            }

            if (meta && e.key.toLowerCase() === "b") {
                e.preventDefault();
                toggleExplorer();
            }

            if (meta && e.key.toLowerCase() === "f") {
                e.preventDefault();
                const input = qs("#explorerSearchInput");
                if (input) {
                    input.focus();
                    input.select();
                }
            }

            if (meta && e.key === "`") {
                e.preventDefault();
                toggleTerminal();
            }

            if (e.key === "Escape") {
                window.NovaEditor?.closeCommandPalette?.();
                const menu = qs("#editorContextMenu");
                if (menu) menu.hidden = true;
            }
        });
    }

    function toggleExplorer() {
        const panel = qs("#explorerPanel");
        const workspace = qs("#editorWorkspace");
        if (!panel || !workspace) return;

        STATE.isExplorerOpen = !STATE.isExplorerOpen;
        workspace.classList.toggle("explorer-hidden", !STATE.isExplorerOpen);
        panel.classList.toggle("open", STATE.isExplorerOpen);
    }

    /* ==========================================
       UNSAVED CHANGES GUARD
       ========================================== */
    function initUnloadGuard() {
        window.addEventListener("beforeunload", (e) => {
            if (hasUnsavedChanges()) {
                e.preventDefault();
                e.returnValue = "You have unsaved changes.";
                return e.returnValue;
            }
        });
    }

    /* ==========================================
       RESPONSIVE HELPERS
       ========================================== */
    function initResponsive() {
        window.NovaEditor = window.NovaEditor || {};
        window.NovaEditor.toggleExplorer = toggleExplorer;
        window.NovaEditor.toggleRightPanel = toggleRightPanel;
        window.NovaEditor.toggleTerminal = toggleTerminal;
        window.NovaEditor.saveCurrentFile = saveCurrentFile;
    }

    /* ==========================================
       FUTURE PLACEHOLDERS (architecture only)
       ========================================== */
    function initGitPlaceholder() { /* future: Git status, blame, diff */ }
    function initExtensionsPlaceholder() { /* future: extension host */ }
    function initMultiCursorPlaceholder() { /* future: multi-cursor support */ }
    function initSplitEditorPlaceholder() { /* future: split view */ }
    function initCollaborationPlaceholder() { /* future: real-time collab */ }
    function initDebugPlaceholder() { /* future: debugger */ }
    function initBuildPlaceholder() { /* future: build pipeline */ }
    function initDeployPlaceholder() { /* future: deploy targets */ }
    function initAICompletionPlaceholder() { /* future: inline AI completions */ }

    /* ==========================================
       BOOT (protected initialization)
       ========================================== */
    async function init() {
        initExplorer();
        initTabs();
        initRightPanel();
        initTerminal();
        initResizers();
        initToolbar();
        initCommandPalette();
        initContextMenu();
        initKeyboard();
        initResponsive();
        initUnloadGuard();

        const projectLoaded = await loadProject();

        if (!projectLoaded) {
            return;
        }

        await initMonaco();

        // Future architecture hooks (no-op)
        initGitPlaceholder();
        initExtensionsPlaceholder();
        initMultiCursorPlaceholder();
        initSplitEditorPlaceholder();
        initCollaborationPlaceholder();
        initDebugPlaceholder();
        initBuildPlaceholder();
        initDeployPlaceholder();
        initAICompletionPlaceholder();

        console.log("[NovaEditor] Editor ready");
    }

    /* ==========================================
       SECURITY: Route Guard
       ------------------------------------------
       editor.html is a protected page. This runs
       BEFORE init(), so nothing below this point —
       project data, folders, files, Monaco — is
       ever loaded or initialized for an
       unauthenticated visitor.

       editor.js is loaded as a classic (non-module)
       script, so auth.js's guard is pulled in with
       a dynamic import() rather than a static
       `import` statement — the exported functions
       are identical to the ones dashboard.js and
       login.js use.

       requireAuth():
         - waits for Firebase Auth state to finish
           restoring (no redirect flicker, no
           reliance on localStorage/sessionStorage
           or a custom "isLoggedIn" flag),
         - redirects unauthenticated visitors to
           index.html via window.location.replace()
           (so editor.html cannot be reached via
           browser "back"),
         - resolves the confirmed user so it can be
           used for the project-ownership check in
           loadProject().
       ========================================== */
    async function initEditorGuard() {
        let requireAuth;

        try {
            ({ requireAuth } = await import("../firebase/auth.js"));
        } catch (err) {
            console.error("[NovaEditor] Failed to load authentication guard:", err);
            // Fail closed: without a working auth guard we cannot verify
            // the visitor, so do not initialize the editor. editor.html
            // lives in /pages/, so the root landing page must be
            // addressed as "../index.html" (a bare "index.html" would
            // resolve to the non-existent /pages/index.html).
            window.location.replace("../index.html");
            return;
        }

        const user = await requireAuth();

        if (!user) {
            return; // requireAuth() already redirected to index.html
        }

        STATE.currentUser = user;

        await init();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initEditorGuard);
    } else {
        initEditorGuard();
    }
})();