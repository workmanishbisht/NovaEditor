/* ==========================================
   NOVA EDITOR — editor.js
   Production-ready • Pure ES6
   Compatible with editor.html + editor.css
   ========================================== */

(() => {
    "use strict";

    /* ==========================================
       STATE
       ========================================== */
    const STATE = {
        activeFile: "src/components/App.jsx",
        openTabs: [
            { id: "tab-app", path: "src/components/App.jsx", name: "App.jsx", dirty: false },
            { id: "tab-navbar", path: "src/components/Navbar.jsx", name: "Navbar.jsx", dirty: false },
            { id: "tab-styles", path: "src/styles.css", name: "styles.css", dirty: false },
            { id: "tab-utils", path: "src/utils.js", name: "utils.js", dirty: false },
        ],
        expandedFolders: new Set(["src", "src/components"]),
        activeExplorerTab: "files",
        activeRightTab: "ai",
        activeTerminalTab: "terminal",
        isExplorerOpen: true,
        isRightPanelOpen: true,
        isTerminalOpen: true,
        isSaving: false,
        isRunning: false,
        commandPaletteOpen: false,
        contextMenu: null,
    };

    /* ==========================================
       HELPERS
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

    /* ==========================================
       EXPLORER
       ========================================== */
    function initExplorer() {
        const tree = qs("#explorerTree");
        if (!tree) return;

        // Restore expanded folders
        const saved = storageGet("expandedFolders", ["src", "src/components"]);
        STATE.expandedFolders = new Set(saved);
        applyExpandedFolders();

        // Folder toggle (event delegation)
        tree.addEventListener("click", (e) => {
            const chevron = e.target.closest(".tree-chevron");
            const row = e.target.closest(".tree-row");
            if (!row) return;

            const item = row.closest(".tree-item");
            if (!item) return;

            // Toggle folder
            if (chevron || (item.classList.contains("tree-folder") && !e.target.closest(".tree-label"))) {
                e.preventDefault();
                e.stopPropagation();
                toggleFolder(item);
                return;
            }

            // Select file
            if (item.classList.contains("tree-file")) {
                const path = item.dataset.path;
                if (path) selectFile(path);
            }
        });

        // Explorer tabs
        qsa("[data-explorer-tab]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const tab = btn.dataset.explorerTab;
                switchExplorerTab(tab);
            });
        });

        // Search filter
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

        // Collapse all
        const collapseBtn = qs("#explorerCollapseBtn");
        if (collapseBtn) {
            collapseBtn.addEventListener("click", () => {
                STATE.expandedFolders.clear();
                applyExpandedFolders();
                storageSet("expandedFolders", []);
            });
        }
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
        storageSet("expandedFolders", [...STATE.expandedFolders]);
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

    function selectFile(path) {
        STATE.activeFile = path;

        // Update tree active state
        qsa(".tree-file").forEach((el) => {
            el.classList.toggle("active", el.dataset.path === path);
        });

        // Open or switch tab
        openOrFocusTab(path);

        // Update breadcrumb
        updateBreadcrumb(path);

        // Update status bar language
        updateStatusLanguage(path);
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
                // Keep folders visible if any child matches
                const label = item.querySelector(".tree-label")?.textContent?.toLowerCase() || "";
                const hasMatch = !query || label.includes(lower) || item.querySelector(`.tree-file[data-path*="${lower}"]`);
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

        // Middle-click close
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

        const name = path.split("/").pop();
        const id = `tab-${Date.now()}`;
        STATE.openTabs.push({ id, path, name, dirty: false });
        renderTabs();
        switchTab(id);
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

        // Sync explorer
        qsa(".tree-file").forEach((el) => {
            el.classList.toggle("active", el.dataset.path === tab.path);
        });

        updateBreadcrumb(tab.path);
        updateStatusLanguage(tab.path);
    }

    function closeTab(tabId) {
        const idx = STATE.openTabs.findIndex((t) => t.id === tabId);
        if (idx === -1) return;

        const wasActive = STATE.openTabs[idx].path === STATE.activeFile;
        STATE.openTabs.splice(idx, 1);
        renderTabs();

        if (wasActive) {
            if (STATE.openTabs.length) {
                const next = STATE.openTabs[Math.min(idx, STATE.openTabs.length - 1)];
                switchTab(next.id);
            } else {
                showEmptyState(true);
            }
        }
    }

    function renderTabs() {
        const list = qs("#tabsList");
        if (!list) return;

        list.innerHTML = STATE.openTabs
            .map((t) => {
                const iconClass = getFileIconClass(t.path);
                return `
        <div class="editor-tab ${t.path === STATE.activeFile ? "active" : ""}" role="tab"
             aria-selected="${t.path === STATE.activeFile}" data-tab-id="${t.id}" data-path="${t.path}" draggable="true">
          <i class="${iconClass} tab-icon"></i>
          <span class="tab-name">${t.name}</span>
          <span class="tab-dirty" title="Unsaved changes" ${t.dirty ? "" : "hidden"}>•</span>
          <button type="button" class="tab-close" aria-label="Close ${t.name}" title="Close">
            <i class="ri-close-line"></i>
          </button>
        </div>`;
            })
            .join("");
    }

    function getFileIconClass(path) {
        if (path.endsWith(".jsx") || path.endsWith(".tsx")) return "ri-reactjs-line tab-icon jsx";
        if (path.endsWith(".js") || path.endsWith(".ts")) return "ri-javascript-fill tab-icon js";
        if (path.endsWith(".css")) return "ri-css3-fill tab-icon css";
        if (path.endsWith(".json")) return "ri-file-code-line tab-icon json";
        if (path.endsWith(".md")) return "ri-markdown-fill tab-icon md";
        return "ri-file-line tab-icon";
    }

    function setTabDirty(path, dirty = true) {
        const tab = STATE.openTabs.find((t) => t.path === path);
        if (tab) {
            tab.dirty = dirty;
            const el = qs(`.editor-tab[data-path="${path}"] .tab-dirty`);
            if (el) el.hidden = !dirty;
        }
    }

    function showEmptyState(show) {
        const empty = qs("#editorEmptyState");
        const shell = qs("#monacoEditorShell");
        if (empty) empty.hidden = !show;
        if (shell) shell.style.display = show ? "none" : "flex";
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

        // AI quick actions
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

        // AI send
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

        // Console filters
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
    }

    function sendAIMessage() {
        const input = qs("#aiInput");
        const chat = qs("#aiChat");
        if (!input || !chat || !input.value.trim()) return;

        const text = input.value.trim();
        input.value = "";

        // User message
        const userMsg = document.createElement("div");
        userMsg.className = "ai-message user";
        userMsg.innerHTML = `<div class="ai-bubble">${escapeHtml(text)}</div>`;
        chat.appendChild(userMsg);

        // Fake assistant reply (no backend)
        setTimeout(() => {
            const reply = document.createElement("div");
            reply.className = "ai-message assistant";
            reply.innerHTML = `<div class="ai-bubble">I've analyzed your request. (This is a frontend-only demo — connect your AI backend to get real responses.)</div>`;
            chat.appendChild(reply);
            chat.scrollTop = chat.scrollHeight;
        }, 600);

        chat.scrollTop = chat.scrollHeight;
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
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
       TERMINAL
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
                        // Fake response
                        setTimeout(() => {
                            appendTerminalLine(`Command executed: ${cmd}`, false);
                        }, 300);
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
        if (isCmd) {
            line.innerHTML = `<span class="term-prompt">nova-editor</span><span class="term-path">~/my-project</span><span class="term-symbol">$</span><span class="term-cmd">${escapeHtml(text)}</span>`;
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
                    // Switch to terminal + preview
                    switchTerminalTab("terminal");
                    switchRightTab("preview");
                }, 1800);
            });
        }

        const previewBtn = qs("#btnPreview");
        if (previewBtn) {
            previewBtn.addEventListener("click", () => {
                toggleRightPanel(true);
                switchRightTab("preview");
            });
        }

        const aiBtn = qs("#btnAI");
        if (aiBtn) {
            aiBtn.addEventListener("click", () => {
                toggleRightPanel(true);
                switchRightTab("ai");
            });
        }

        // Save simulation
        const saveStatus = qs("#saveStatus");
        if (saveStatus) {
            // Demo: mark dirty on any key in editor
            const codeArea = qs("#editorCodeArea");
            if (codeArea) {
                codeArea.addEventListener("input", () => {
                    setTabDirty(STATE.activeFile, true);
                    saveStatus.dataset.status = "unsaved";
                    saveStatus.querySelector(".status-text").textContent = "Unsaved";
                });
            }
        }
    }

    function simulateSave() {
        const saveStatus = qs("#saveStatus");
        if (!saveStatus) return;

        saveStatus.dataset.status = "saving";
        saveStatus.querySelector(".status-text").textContent = "Saving...";

        setTimeout(() => {
            saveStatus.dataset.status = "saved";
            saveStatus.querySelector(".status-text").textContent = "Saved";
            setTabDirty(STATE.activeFile, false);
        }, 700);
    }

    /* ==========================================
       BREADCRUMB + STATUS
       ========================================== */
    function updateBreadcrumb(path) {
        const nav = qs("#editorBreadcrumb .breadcrumb-list");
        if (!nav) return;

        const parts = path.split("/");
        let html = "";
        let current = "";
        parts.forEach((part, i) => {
            current += (i ? "/" : "") + part;
            if (i < parts.length - 1) {
                html += `<li class="breadcrumb-item"><a href="#" class="breadcrumb-link" data-path="${current}">${part}</a></li>`;
                html += `<li class="breadcrumb-sep" aria-hidden="true"><i class="ri-arrow-right-s-line"></i></li>`;
            } else {
                html += `<li class="breadcrumb-item current"><span class="breadcrumb-current">${part}</span></li>`;
            }
        });
        nav.innerHTML = html;
    }

    function updateStatusLanguage(path) {
        const el = qs("#statusLanguage");
        if (!el) return;
        if (path.endsWith(".jsx") || path.endsWith(".tsx")) el.textContent = "JavaScript JSX";
        else if (path.endsWith(".js") || path.endsWith(".ts")) el.textContent = "JavaScript";
        else if (path.endsWith(".css")) el.textContent = "CSS";
        else if (path.endsWith(".json")) el.textContent = "JSON";
        else if (path.endsWith(".md")) el.textContent = "Markdown";
        else el.textContent = "Plain Text";
    }

    /* ==========================================
       COMMAND PALETTE
       ========================================== */
    function initCommandPalette() {
        // Create palette DOM if not present
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

            // Minimal styles (inline to avoid CSS dependency)
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
            { id: "save", label: "File: Save", shortcut: "Ctrl+S", action: simulateSave },
            { id: "run", label: "Run: Start Dev Server", shortcut: "Ctrl+Enter", action: () => qs("#btnRun")?.click() },
            { id: "toggle-explorer", label: "View: Toggle Explorer", shortcut: "Ctrl+B", action: () => toggleExplorer() },
            { id: "toggle-terminal", label: "View: Toggle Terminal", shortcut: "Ctrl+`", action: () => toggleTerminal() },
            { id: "toggle-ai", label: "View: Toggle AI Panel", shortcut: "", action: () => toggleRightPanel() },
            { id: "preview", label: "View: Open Preview", shortcut: "", action: () => { toggleRightPanel(true); switchRightTab("preview"); } },
            { id: "command", label: "Help: Show All Commands", shortcut: "Ctrl+Shift+P", action: () => { } },
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

        // Expose
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
            });
        }

        document.addEventListener("click", () => {
            menu.hidden = true;
            STATE.contextMenu = null;
        });

        menu.addEventListener("click", (e) => {
            const btn = e.target.closest("button");
            if (!btn) return;
            // Frontend-only actions
            console.log("[NovaEditor] Context action:", btn.dataset.action, STATE.contextMenu?.dataset.path);
            menu.hidden = true;
        });
    }

    /* ==========================================
       KEYBOARD SHORTCUTS
       ========================================== */
    function initKeyboard() {
        document.addEventListener("keydown", (e) => {
            const meta = e.ctrlKey || e.metaKey;

            // Ctrl+S → Save
            if (meta && e.key === "s") {
                e.preventDefault();
                simulateSave();
            }

            // Ctrl+Shift+P → Command Palette
            if (meta && e.shiftKey && e.key.toLowerCase() === "p") {
                e.preventDefault();
                window.NovaEditor?.openCommandPalette?.();
            }

            // Ctrl+P → Quick open (reuse palette for now)
            if (meta && !e.shiftKey && e.key.toLowerCase() === "p") {
                e.preventDefault();
                window.NovaEditor?.openCommandPalette?.();
            }

            // Ctrl+B → Toggle Explorer
            if (meta && e.key.toLowerCase() === "b") {
                e.preventDefault();
                toggleExplorer();
            }

            // Ctrl+F → Focus explorer search
            if (meta && e.key.toLowerCase() === "f") {
                e.preventDefault();
                const input = qs("#explorerSearchInput");
                if (input) {
                    input.focus();
                    input.select();
                }
            }

            // Ctrl+` → Toggle Terminal
            if (meta && e.key === "`") {
                e.preventDefault();
                toggleTerminal();
            }

            // Escape
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
       RESPONSIVE HELPERS
       ========================================== */
    function initResponsive() {
        // On mobile the explorer/right panels use .open class (already in CSS)
        // We just expose toggles
        window.NovaEditor = window.NovaEditor || {};
        window.NovaEditor.toggleExplorer = toggleExplorer;
        window.NovaEditor.toggleRightPanel = toggleRightPanel;
        window.NovaEditor.toggleTerminal = toggleTerminal;
    }

    /* ==========================================
       BOOT
       ========================================== */
    function init() {
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

        // Initial state
        selectFile(STATE.activeFile);
        showEmptyState(false);

        console.log("[NovaEditor] Editor ready");
    }

    // Wait for DOM
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();