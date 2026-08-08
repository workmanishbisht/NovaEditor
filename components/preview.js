/* ==========================================
   NOVA EDITOR — components/preview.js
   ========================================== */

/**
 * Normalize a path for lookup (strip leading ./ and /).
 * @param {string} p
 * @returns {string}
 */
function normalizePath(p) {
    if (!p || typeof p !== "string") return "";
    return p.replace(/^\.\//, "").replace(/^\//, "").trim();
}

/**
 * Build a path → content map from editor state.
 * Prefers live fileContents over stored file.content.
 * @param {Array<{path?: string, name?: string, content?: string}>} files
 * @param {Record<string, string>} fileContents
 * @returns {Map<string, string>}
 */
function buildContentMap(files, fileContents) {
    const map = new Map();
    const list = Array.isArray(files) ? files : [];
    const contents = fileContents && typeof fileContents === "object" ? fileContents : {};

    for (const f of list) {
        const path = normalizePath(f.path || f.name || "");
        if (!path) continue;
        const live = contents[f.path] ?? contents[path];
        const value = live !== undefined ? live : (f.content ?? "");
        map.set(path, typeof value === "string" ? value : "");
        // Also index by basename for loose resolution
        const base = path.split("/").pop();
        if (base && !map.has(base)) map.set(base, map.get(path));
    }

    // Include any open-but-not-yet-in-files live buffers
    for (const [path, value] of Object.entries(contents)) {
        const n = normalizePath(path);
        if (n && !map.has(n) && typeof value === "string") {
            map.set(n, value);
            const base = n.split("/").pop();
            if (base && !map.has(base)) map.set(base, value);
        }
    }

    return map;
}

/**
 * Resolve a referenced path against the content map.
 * Tries exact, normalized, basename, and common folder prefixes.
 * @param {string} href
 * @param {Map<string, string>} contentMap
 * @returns {{ path: string, content: string } | null}
 */
function resolveAsset(href, contentMap) {
    if (!href || /^(https?:|data:|blob:|\/\/)/i.test(href)) return null;

    const clean = normalizePath(href.split("?")[0].split("#")[0]);
    if (!clean) return null;

    const candidates = [
        clean,
        clean.replace(/^\.\.\//, ""),
        clean.split("/").pop(),
    ];

    for (const key of candidates) {
        if (key && contentMap.has(key)) {
            return { path: key, content: contentMap.get(key) };
        }
    }

    // Case-insensitive fallback
    const lower = clean.toLowerCase();
    for (const [path, content] of contentMap) {
        if (path.toLowerCase() === lower || path.toLowerCase().endsWith("/" + lower)) {
            return { path, content };
        }
    }

    return null;
}

/**
 * Pick the best HTML entry file for preview.
 * Prefer index.html, then any .html, then activeFile if HTML.
 * @param {Array<{path?: string}>} files
 * @param {string|null} activeFile
 * @param {Map<string, string>} contentMap
 * @returns {{ path: string, content: string } | null}
 */
function pickHtmlEntry(files, activeFile, contentMap) {
    const list = Array.isArray(files) ? files : [];
    const htmlPaths = list
        .map((f) => normalizePath(f.path || f.name || ""))
        .filter((p) => /\.html?$/i.test(p));

    const preferred = [
        "index.html",
        "index.htm",
        activeFile && /\.html?$/i.test(activeFile) ? normalizePath(activeFile) : null,
        ...htmlPaths,
    ].filter(Boolean);

    for (const p of preferred) {
        if (contentMap.has(p)) {
            return { path: p, content: contentMap.get(p) };
        }
        const found = htmlPaths.find((h) => h === p || h.endsWith("/" + p) || h.toLowerCase() === p.toLowerCase());
        if (found && contentMap.has(found)) {
            return { path: found, content: contentMap.get(found) };
        }
    }

    // Active buffer might be HTML even if not in files list yet
    if (activeFile && /\.html?$/i.test(activeFile)) {
        const n = normalizePath(activeFile);
        if (contentMap.has(n)) return { path: n, content: contentMap.get(n) };
    }

    return null;
}

/**
 * Inline <link rel="stylesheet"> and local <script src> into the HTML document.
 * External http(s) assets are left alone.
 * Unreferenced project CSS/JS are appended as a safety net for simple projects.
 * @param {string} html
 * @param {Map<string, string>} contentMap
 * @returns {{ html: string, missing: string[] }}
 */
function inlineLocalAssets(html, contentMap) {
    const missing = [];
    const usedCss = new Set();
    const usedJs = new Set();
    let out = typeof html === "string" ? html : "";

    // Inline stylesheet links
    out = out.replace(
        /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi,
        (full, href) => {
            const isStylesheet =
                /\bstylesheet\b/i.test(full) ||
                /\.css(\?|#|$)/i.test(href) ||
                /rel\s*=\s*["'][^"']*stylesheet[^"']*["']/i.test(full);

            if (!isStylesheet) return full;

            const resolved = resolveAsset(href, contentMap);
            if (!resolved) {
                if (!/^(https?:|data:|blob:|\/\/)/i.test(href)) missing.push(href);
                return full;
            }
            usedCss.add(resolved.path);
            return `<style data-nova-preview-src="${escapeAttr(resolved.path)}">\n${resolved.content}\n</style>`;
        }
    );

    // Inline local script src (keep order)
    out = out.replace(
        /<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi,
        (full, pre, src, post) => {
            if (/^(https?:|data:|blob:|\/\/)/i.test(src)) return full;
            const resolved = resolveAsset(src, contentMap);
            if (!resolved) {
                missing.push(src);
                return full;
            }
            usedJs.add(resolved.path);
            const attrs = `${pre || ""}${post || ""}`.replace(/\bsrc\s*=\s*["'][^"']*["']/gi, "").trim();
            return `<script data-nova-preview-src="${escapeAttr(resolved.path)}"${attrs ? " " + attrs : ""}>\n${resolved.content}\n</script>`;
        }
    );

    // Collect unreferenced CSS/JS from the project
    const extraCss = [];
    const extraJs = [];
    for (const [path, content] of contentMap) {
        if (/\.css$/i.test(path) && !usedCss.has(path) && content.trim()) {
            extraCss.push({ path, content });
        }
        if (/\.jsx?$/i.test(path) && !/\.tsx?$/i.test(path) && !usedJs.has(path) && content.trim()) {
            // Skip obvious module/bundler entry points that aren't plain browser JS
            if (/\b(import|export)\s/.test(content) && !/type\s*=\s*["']module["']/.test(out)) {
                continue;
            }
            extraJs.push({ path, content });
        }
    }

    if (extraCss.length || extraJs.length) {
        let injection = "";
        for (const c of extraCss) {
            injection += `<style data-nova-preview-src="${escapeAttr(c.path)}">\n${c.content}\n</style>\n`;
        }
        for (const j of extraJs) {
            injection += `<script data-nova-preview-src="${escapeAttr(j.path)}">\ntry {\n${j.content}\n} catch (e) { console.error("[Nova Preview]", e); }\n</script>\n`;
        }

        if (/<\/head>/i.test(out)) {
            // CSS before </head>, JS before </body>
            let withCss = out;
            const cssOnly = extraCss
                .map((c) => `<style data-nova-preview-src="${escapeAttr(c.path)}">\n${c.content}\n</style>`)
                .join("\n");
            if (cssOnly) {
                withCss = withCss.replace(/<\/head>/i, `${cssOnly}\n</head>`);
            }
            const jsOnly = extraJs
                .map(
                    (j) =>
                        `<script data-nova-preview-src="${escapeAttr(j.path)}">\ntry {\n${j.content}\n} catch (e) { console.error("[Nova Preview]", e); }\n</script>`
                )
                .join("\n");
            if (jsOnly && /<\/body>/i.test(withCss)) {
                out = withCss.replace(/<\/body>/i, `${jsOnly}\n</body>`);
            } else if (jsOnly) {
                out = withCss + "\n" + jsOnly;
            } else {
                out = withCss;
            }
        } else if (/<\/body>/i.test(out)) {
            out = out.replace(/<\/body>/i, `${injection}</body>`);
        } else {
            out = out + "\n" + injection;
        }
    }

    // Ensure a basic document shell if the file is a fragment
    if (!/<!DOCTYPE/i.test(out) && !/<html[\s>]/i.test(out)) {
        out = `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>\n<body>\n${out}\n</body>\n</html>`;
    } else if (!/<meta[^>]+charset/i.test(out) && /<head[\s>]/i.test(out)) {
        out = out.replace(/<head([^>]*)>/i, '<head$1>\n<meta charset="utf-8">');
    }

    return { html: out, missing };
}

function escapeAttr(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Build an error document to show inside the iframe.
 * @param {string} title
 * @param {string} message
 * @param {string[]} [details]
 * @returns {string}
 */
function buildErrorDocument(title, message, details = []) {
    const list =
        details.length > 0
            ? `<ul style="margin:12px 0 0;padding-left:18px;color:#94a3b8;font-size:13px;">${details
                  .map((d) => `<li><code>${escapeHtml(d)}</code></li>`)
                  .join("")}</ul>`
            : "";
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    background: #0f172a;
    color: #e2e8f0;
  }
  .box {
    max-width: 420px;
    padding: 28px 24px;
    border-radius: 12px;
    border: 1px solid #334155;
    background: #1e293b;
    text-align: center;
  }
  h1 { margin: 0 0 8px; font-size: 16px; color: #f87171; }
  p { margin: 0; font-size: 14px; color: #cbd5e1; line-height: 1.5; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
</style>
</head>
<body>
  <div class="box">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    ${list}
  </div>
</body>
</html>`;
}

/**
 * Locate preview DOM nodes.
 * @returns {{ iframe: HTMLIFrameElement|null, placeholders: HTMLElement[], wrap: HTMLElement|null }}
 */
function getPreviewElements() {
    const iframe =
        document.querySelector("#previewFrame") ||
        document.querySelector("#previewIframe") ||
        document.querySelector(".preview-frame") ||
        document.querySelector(".preview-iframe");

    const wrap =
        document.querySelector("#previewFrameWrap") ||
        document.querySelector(".preview-frame-wrap") ||
        (iframe && iframe.parentElement) ||
        null;

    // Collect every plausible empty-state node (id, class, or known copy)
    const found = new Set();
    const selectors = [
        "#previewPlaceholder",
        ".preview-placeholder",
        ".preview-empty",
        ".preview-empty-state",
        "[data-preview-placeholder]",
        "#previewEmpty",
        ".preview-frame-placeholder",
    ];
    for (const sel of selectors) {
        document.querySelectorAll(sel).forEach((el) => found.add(el));
    }

    // Fallback: any sibling of the iframe that still shows the default copy
    if (wrap) {
        Array.from(wrap.children).forEach((el) => {
            if (el === iframe) return;
            const text = (el.textContent || "").toLowerCase();
            if (
                text.includes("click run") ||
                text.includes("preview will appear") ||
                text.includes("preview your project") ||
                text.includes("development server")
            ) {
                found.add(el);
            }
        });
    }

    return { iframe, placeholders: Array.from(found), wrap };
}

/**
 * One stylesheet that wins over editor.css when the wrap is marked active.
 * Class-based rules survive layout/tab redraws that may clear inline styles.
 */
function ensurePreviewHideStyles() {
    if (document.getElementById("nova-preview-hide-styles")) return;
    const style = document.createElement("style");
    style.id = "nova-preview-hide-styles";
    style.textContent = `
#previewFrameWrap.has-preview #previewPlaceholder,
#previewFrameWrap.has-preview .preview-placeholder,
#previewFrameWrap[data-preview-active="1"] #previewPlaceholder,
#previewFrameWrap[data-preview-active="1"] .preview-placeholder,
.preview-frame-wrap.has-preview #previewPlaceholder,
.preview-frame-wrap.has-preview .preview-placeholder,
#previewPlaceholder.preview-placeholder--hidden,
.preview-placeholder.preview-placeholder--hidden {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
  height: 0 !important;
  max-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  border: 0 !important;
  position: absolute !important;
  inset: auto !important;
  z-index: -1 !important;
}
#previewFrameWrap.has-preview #previewFrame,
#previewFrameWrap[data-preview-active="1"] #previewFrame,
.preview-frame-wrap.has-preview #previewFrame,
.preview-frame-wrap.has-preview .preview-frame {
  display: block !important;
  visibility: visible !important;
  opacity: 1 !important;
  background: #ffffff !important;
  position: relative !important;
  z-index: 1 !important;
  width: 100% !important;
  height: 100% !important;
  flex: 1 1 auto !important;
}
`;
    document.head.appendChild(style);
}

/**
 * Show or hide the preview empty-state / placeholder overlay.
 * When hidden, the node is fully removed from layout (not stacked behind the iframe).
 * @param {boolean} show
 */
function setPlaceholderVisible(show) {
    ensurePreviewHideStyles();
    const { placeholders, iframe, wrap } = getPreviewElements();

    // Always include the known editor.html node
    const known =
        document.getElementById("previewPlaceholder") ||
        document.querySelector(".preview-placeholder");
    const list = placeholders.length ? placeholders : known ? [known] : [];
    if (known && !list.includes(known)) list.push(known);

    for (const placeholder of list) {
        if (!placeholder) continue;
        if (show) {
            placeholder.hidden = false;
            placeholder.removeAttribute("aria-hidden");
            placeholder.classList.remove("is-hidden", "hidden", "preview-placeholder--hidden");
            if (placeholder.dataset.novaPreviewHidden === "1") {
                placeholder.style.display = placeholder.dataset.novaPreviewDisplay || "";
                placeholder.style.visibility = placeholder.dataset.novaPreviewVisibility || "";
                placeholder.style.opacity = placeholder.dataset.novaPreviewOpacity || "";
                placeholder.style.pointerEvents = placeholder.dataset.novaPreviewPointer || "";
                placeholder.style.zIndex = placeholder.dataset.novaPreviewZ || "";
                delete placeholder.dataset.novaPreviewHidden;
            }
            placeholder.style.removeProperty("display");
            placeholder.style.removeProperty("visibility");
            placeholder.style.removeProperty("opacity");
            placeholder.style.removeProperty("pointer-events");
            placeholder.style.removeProperty("height");
            placeholder.style.removeProperty("max-height");
            placeholder.style.removeProperty("margin");
            placeholder.style.removeProperty("padding");
            placeholder.style.removeProperty("overflow");
            placeholder.style.removeProperty("position");
            placeholder.style.removeProperty("z-index");
        } else {
            if (placeholder.dataset.novaPreviewHidden !== "1") {
                placeholder.dataset.novaPreviewDisplay = placeholder.style.display || "";
                placeholder.dataset.novaPreviewVisibility = placeholder.style.visibility || "";
                placeholder.dataset.novaPreviewOpacity = placeholder.style.opacity || "";
                placeholder.dataset.novaPreviewPointer = placeholder.style.pointerEvents || "";
                placeholder.dataset.novaPreviewZ = placeholder.style.zIndex || "";
                placeholder.dataset.novaPreviewHidden = "1";
            }
            placeholder.hidden = true;
            placeholder.setAttribute("aria-hidden", "true");
            placeholder.classList.add("is-hidden", "hidden", "preview-placeholder--hidden");
            placeholder.style.setProperty("display", "none", "important");
            placeholder.style.setProperty("visibility", "hidden", "important");
            placeholder.style.setProperty("opacity", "0", "important");
            placeholder.style.setProperty("pointer-events", "none", "important");
            placeholder.style.setProperty("height", "0", "important");
            placeholder.style.setProperty("max-height", "0", "important");
            placeholder.style.setProperty("margin", "0", "important");
            placeholder.style.setProperty("padding", "0", "important");
            placeholder.style.setProperty("overflow", "hidden", "important");
            placeholder.style.setProperty("position", "absolute", "important");
            placeholder.style.setProperty("z-index", "-1", "important");
        }
    }

    // Hard target the known editor.html node (id="previewPlaceholder")
    const hard = document.getElementById("previewPlaceholder");
    if (hard) {
        if (show) {
            hard.hidden = false;
            hard.classList.remove("preview-placeholder--hidden");
        } else {
            hard.hidden = true;
            hard.classList.add("preview-placeholder--hidden");
            hard.style.setProperty("display", "none", "important");
            hard.style.setProperty("height", "0", "important");
            hard.style.setProperty("overflow", "hidden", "important");
        }
    }

    if (iframe) {
        if (show) {
            iframe.style.visibility = "hidden";
            iframe.style.opacity = "0";
            iframe.style.pointerEvents = "none";
            iframe.style.background = "";
        } else {
            iframe.style.visibility = "visible";
            iframe.style.opacity = "1";
            iframe.style.pointerEvents = "auto";
            iframe.style.background = "#ffffff";
            iframe.style.position = iframe.style.position || "relative";
            iframe.style.zIndex = "1";
        }
    }

    // Class on the wrap is the durable signal for CSS (survives style resets)
    if (wrap) {
        wrap.classList.toggle("has-preview", !show);
        wrap.classList.toggle("preview-empty", !!show);
        wrap.dataset.previewActive = show ? "0" : "1";
    }
}

/**
 * Render the current project into the preview iframe.
 *
 * @param {object} options
 * @param {Array}  options.files          - STATE.files from editor
 * @param {Record<string,string>} options.fileContents - live buffers
 * @param {string|null} [options.activeFile]
 * @param {boolean} [options.showPlaceholderOnEmpty=true]
 * @returns {{ success: boolean, entry: string|null, missing: string[], error: string|null }}
 */
export function renderPreview(options = {}) {
    const {
        files = [],
        fileContents = {},
        activeFile = null,
        showPlaceholderOnEmpty = true,
    } = options;

    const { iframe } = getPreviewElements();
    if (!iframe) {
        return {
            success: false,
            entry: null,
            missing: [],
            error: "Preview iframe not found in the DOM.",
        };
    }

    try {
        const contentMap = buildContentMap(files, fileContents);
        const entry = pickHtmlEntry(files, activeFile, contentMap);

        if (!entry || !entry.content.trim()) {
            const doc = buildErrorDocument(
                "No HTML entry file",
                "Add an index.html (or any .html file) to this project, then click Run / Preview.",
                files.length === 0 ? ["Project has no files loaded."] : []
            );
            iframe.srcdoc = doc;
            setPlaceholderVisible(false);
            return {
                success: false,
                entry: null,
                missing: [],
                error: "No HTML entry file found.",
            };
        }

        const { html, missing } = inlineLocalAssets(entry.content, contentMap);
        iframe.srcdoc = html;
        setPlaceholderVisible(false);

        return {
            success: true,
            entry: entry.path,
            missing,
            error: missing.length
                ? `Missing assets: ${missing.join(", ")}`
                : null,
        };
    } catch (err) {
        console.error("[NovaPreview] render failed:", err);
        const message = err && err.message ? err.message : String(err);
        iframe.srcdoc = buildErrorDocument("Preview failed", message);
        setPlaceholderVisible(false);
        return {
            success: false,
            entry: null,
            missing: [],
            error: message,
        };
    }
}

/**
 * Clear the preview and restore the placeholder.
 */
export function clearPreview() {
    const { iframe } = getPreviewElements();
    if (iframe) {
        iframe.srcdoc = "";
        try {
            iframe.removeAttribute("srcdoc");
        } catch { /* ignore */ }
    }
    setPlaceholderVisible(true);
}

/**
 * Hide placeholder without changing iframe content (e.g. after a successful run).
 */
export function hidePreviewPlaceholder() {
    setPlaceholderVisible(false);
}

export function showPreviewPlaceholder() {
    setPlaceholderVisible(true);
}

// Optional global for non-module consumers
if (typeof window !== "undefined") {
    window.NovaPreview = {
        renderPreview,
        clearPreview,
        hidePreviewPlaceholder,
        showPreviewPlaceholder,
    };
}
