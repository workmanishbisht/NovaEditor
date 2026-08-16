"use strict";

/* ==========================================
   NOVA EDITOR — SNIPPETS.JS
========================================== */

import { showToast } from "../components/toast.js";
import { db } from "../firebase/firebase-config.js";
import { getCurrentWorkspaceId, getUser } from "../firebase/firestore.js";
import { getCurrentUser, onAuthStateChange } from "../firebase/auth.js";

import {
    collection,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    getDocs,
    query,
    where,
    serverTimestamp,
    arrayUnion,
    arrayRemove,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ==========================================
   CONFIG
========================================== */
const SNIPPETS_COLLECTION = "snippets";
const VIEW_STORAGE_KEY = "novaeditor:snippetsView";
const VALID_CATEGORIES = ["html", "css", "javascript", "react", "nodejs", "utility"];
const VALID_TABS = ["all", "mine", "favorites", "shared"];
const SEARCH_DEBOUNCE_MS = 220;

const CATEGORY_ICONS = {
    html: "ri-html5-line",
    css: "ri-css3-line",
    javascript: "ri-javascript-line",
    react: "ri-reactjs-line",
    nodejs: "ri-node-tree",
    utility: "ri-tools-line",
};

const CATEGORY_LABELS = {
    html: "HTML",
    css: "CSS",
    javascript: "JavaScript",
    react: "React",
    nodejs: "Node.js",
    utility: "Utility",
};

const AVATAR_PALETTE = [
    "#2563eb", "#7c3aed", "#0891b2", "#059669",
    "#d97706", "#dc2626", "#db2777", "#4f46e5",
];

/* ==========================================
   STATE
========================================== */
const STATE = {
    currentUser: null,
    currentWorkspaceId: null,
    snippets: [],           // full accessible set (owned + shared + workspace-public)
    loaded: false,
    loading: false,
    initialized: false,
    activeTab: "all",
    search: "",
    category: "all",
    tags: new Set(),
    collectionFilter: null,
    sort: "updated",
    view: "grid",
    editingSnippetId: null, // set while the modal is editing an existing snippet
    authorCache: new Map(), // uid -> { name, photoURL }
};

/* ==========================================
   DOM REFS (resolved lazily — the page may not
   be mounted yet when this module first parses)
========================================== */
function qs(selector, scope = document) {
    return scope.querySelector(selector);
}
function qsa(selector, scope = document) {
    return Array.from(scope.querySelectorAll(selector));
}

function els() {
    return {
        page: qs("#snippetsPage"),
        searchInput: qs("#snippetsSearchInput"),
        tabs: qsa(".snippets-tab[data-filter-tab]"),
        grid: qs("#snippetsGrid"),
        resultCount: qs("#snippetsResultCount"),
        clearFiltersBtn: qs("#snippetsClearFilters"),
        categoryList: qs("#snippetsCategoryList"),
        tagList: qs("#snippetsTagList"),
        collectionList: qs("#snippetsCollectionList"),
        sortSelect: qs("#snippetsSort"),
        viewGridBtn: qs("#viewGridBtn"),
        viewListBtn: qs("#viewListBtn"),
        emptyState: qs("#snippetsEmpty"),
        importBtn: qs("#importSnippetBtn"),
        newSnippetBtn: qs("[data-new-snippet]"),
    };
}

/* ==========================================
   SAFE HELPERS
========================================== */
function debounce(fn, delay = 300) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value.toDate === "function") return value.toDate();
    return new Date(value);
}

function formatRelativeTime(value) {
    const date = toDate(value);
    if (!date || Number.isNaN(date.getTime())) return "just now";

    const diffMs = Date.now() - date.getTime();
    const diffSec = Math.round(diffMs / 1000);
    if (diffSec < 60) return "just now";

    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return `Updated ${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;

    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `Updated ${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;

    const diffDay = Math.round(diffHr / 24);
    if (diffDay === 1) return "Updated yesterday";
    if (diffDay < 7) return `Updated ${diffDay} days ago`;

    const diffWeek = Math.round(diffDay / 7);
    if (diffWeek < 5) return `Updated ${diffWeek} week${diffWeek === 1 ? "" : "s"} ago`;

    return `Updated on ${date.toLocaleDateString()}`;
}

function lineCount(code) {
    if (!code) return 0;
    return String(code).split("\n").length;
}

function techBadgeClass(category) {
    switch (category) {
        case "html": return "tech-html";
        case "css": return "tech-css";
        case "javascript": return "tech-js";
        case "react": return "tech-react";
        case "nodejs": return "tech-node";
        default: return "tech-js";
    }
}

function langBadgeLabel(snippet) {
    if (snippet.language) return String(snippet.language).toUpperCase();
    return String(snippet.category || "TEXT").toUpperCase();
}

function categoryIcon(cat) {
    return CATEGORY_ICONS[cat] || "ri-price-tag-3-line";
}

function categoryLabel(cat) {
    return CATEGORY_LABELS[cat] || (cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : "Unknown");
}

/* ==========================================
   AVATAR / AUTHOR HELPERS
========================================== */
function getInitials(name) {
    const clean = String(name || "").trim();
    if (!clean) return "U";
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase() || "U";
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
}

function colorForSeed(seed) {
    const str = String(seed || "U");
    let hash = 0;
    for (let i = 0; i < str.length; i += 1) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % AVATAR_PALETTE.length;
    return AVATAR_PALETTE[index];
}

function getAuthorInfo(snippet) {
    const uid = snippet.ownerUid;
    const currentUid = STATE.currentUser?.uid;

    if (uid && uid === currentUid) {
        return {
            uid,
            name: STATE.currentUser?.displayName || STATE.currentUser?.email || "You",
            photoURL: STATE.currentUser?.photoURL || null,
            isOwner: true,
        };
    }

    const cached = uid ? STATE.authorCache.get(uid) : null;
    return {
        uid,
        name: cached?.name || "Workspace member",
        photoURL: cached?.photoURL || null,
        isOwner: false,
    };
}

function renderAvatar(author) {
    const initials = getInitials(author.name);
    const color = colorForSeed(author.uid || author.name || "U");

    if (author.photoURL) {
        return `<img src="${escapeHtml(author.photoURL)}" alt="" class="snippet-avatar" data-fallback-initials="${escapeHtml(initials)}" data-fallback-color="${escapeHtml(color)}">`;
    }

    return `<div class="snippet-avatar avatar-initials" style="background:${color}" aria-hidden="true">${escapeHtml(initials)}</div>`;
}

async function hydrateAuthorCache(snippets) {
    const currentUid = STATE.currentUser?.uid;
    const uniqueOwnerIds = [...new Set(
        (snippets || [])
            .map((s) => s.ownerUid)
            .filter((uid) => uid && uid !== currentUid && !STATE.authorCache.has(uid))
    )];

    if (uniqueOwnerIds.length === 0) return;

    const results = await Promise.all(uniqueOwnerIds.map(async (ownerUid) => {
        try {
            const res = await getUser(ownerUid);
            if (res.success && res.exists && res.data) {
                const data = res.data;
                return [ownerUid, {
                    name: data.displayName || data.name || data.username || "Workspace member",
                    photoURL: data.photoURL || data.photoUrl || data.avatarUrl || null,
                }];
            }
        } catch (error) {
            console.warn("[Snippets] Failed to load author profile:", ownerUid, error);
        }
        return [ownerUid, { name: "Workspace member", photoURL: null }];
    }));

    results.forEach(([ownerUid, info]) => STATE.authorCache.set(ownerUid, info));
}

/* Broken avatar images fall back to an initials badge instead of a broken-image icon.
   Bound once at module load — img "error" events don't bubble, so this listener
   must use the capture phase on the document. */
function handleAvatarImgError(event) {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) return;
    if (!target.classList.contains("snippet-avatar")) return;

    const initials = target.dataset.fallbackInitials || "U";
    const color = target.dataset.fallbackColor || "#2563eb";

    const replacement = document.createElement("div");
    replacement.className = "snippet-avatar avatar-initials";
    replacement.style.background = color;
    replacement.textContent = initials;
    replacement.setAttribute("aria-hidden", "true");

    target.replaceWith(replacement);
}
document.addEventListener("error", handleAvatarImgError, true);

/* ==========================================
   FIRESTORE — SNIPPETS DATA LAYER
   (self-contained; see header note)
========================================== */
function snippetsCollectionRef() {
    return collection(db, SNIPPETS_COLLECTION);
}
function snippetDocRef(id) {
    return doc(db, SNIPPETS_COLLECTION, id);
}

async function fetchAccessibleSnippets(uid, workspaceId) {
    const queries = [
        getDocs(query(snippetsCollectionRef(), where("ownerUid", "==", uid))),
        getDocs(query(snippetsCollectionRef(), where("sharedWith", "array-contains", uid))),
    ];

    if (workspaceId) {
        queries.push(
            getDocs(
                query(
                    snippetsCollectionRef(),
                    where("workspaceId", "==", workspaceId),
                    where("visibility", "==", "workspace")
                )
            )
        );
    }

    const snapshots = await Promise.all(queries);
    const merged = new Map();

    snapshots.forEach((snapshot) => {
        snapshot.forEach((docSnap) => {
            merged.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
        });
    });

    return Array.from(merged.values());
}

async function createSnippetDoc(payload) {
    const data = {
        title: payload.title.trim(),
        description: payload.description?.trim() || "",
        code: payload.code || "",
        language: payload.language?.trim() || "plaintext",
        category: VALID_CATEGORIES.includes(payload.category) ? payload.category : "utility",
        tags: Array.isArray(payload.tags) ? payload.tags.filter(Boolean) : [],
        collection: payload.collection || null,
        visibility: payload.visibility === "workspace" ? "workspace" : "private",
        ownerUid: payload.ownerUid,
        workspaceId: payload.workspaceId || null,
        sharedWith: Array.isArray(payload.sharedWith) ? payload.sharedWith : [],
        favoritedBy: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    };
    const reference = await addDoc(snippetsCollectionRef(), data);
    return { id: reference.id, ...data, createdAt: new Date(), updatedAt: new Date() };
}

async function updateSnippetDoc(id, payload) {
    const data = { updatedAt: serverTimestamp() };
    if (payload.title !== undefined) data.title = payload.title.trim();
    if (payload.description !== undefined) data.description = payload.description.trim();
    if (payload.code !== undefined) data.code = payload.code;
    if (payload.language !== undefined) data.language = payload.language.trim();
    if (payload.category !== undefined && VALID_CATEGORIES.includes(payload.category)) data.category = payload.category;
    if (payload.tags !== undefined) data.tags = payload.tags.filter(Boolean);
    if (payload.collection !== undefined) data.collection = payload.collection || null;
    if (payload.visibility !== undefined) data.visibility = payload.visibility === "workspace" ? "workspace" : "private";

    await updateDoc(snippetDocRef(id), data);
    return { ...data, updatedAt: new Date() };
}

async function deleteSnippetDoc(id) {
    await deleteDoc(snippetDocRef(id));
}

async function setFavoriteState(id, uid, shouldFavorite) {
    await updateDoc(snippetDocRef(id), {
        favoritedBy: shouldFavorite ? arrayUnion(uid) : arrayRemove(uid),
        updatedAt: serverTimestamp(),
    });
}

/* ==========================================
   LOAD SNIPPETS
========================================== */
async function loadSnippets({ silent = false } = {}) {
    if (!STATE.currentUser) {
        STATE.snippets = [];
        STATE.loaded = true;
        render();
        return;
    }
    if (STATE.loading) return;
    STATE.loading = true;

    try {
        STATE.snippets = await fetchAccessibleSnippets(STATE.currentUser.uid, STATE.currentWorkspaceId);
        await hydrateAuthorCache(STATE.snippets);
        STATE.loaded = true;
    } catch (error) {
        console.error("[Snippets] Failed to load snippets:", error);
        if (!silent) {
            showToast("Unable to load snippets. Please try again.", "error");
        }
        STATE.snippets = STATE.snippets || [];
        STATE.loaded = true;
    } finally {
        STATE.loading = false;
        render();
    }
}

/* ==========================================
   FILTER PIPELINE
========================================== */
function matchesSearch(snippet, term) {
    if (!term) return true;
    const haystack = [
        snippet.title,
        snippet.description,
        snippet.code,
        snippet.language,
        snippet.category,
        ...(snippet.tags || []),
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    return haystack.includes(term);
}

function getTabFiltered() {
    const uid = STATE.currentUser?.uid;
    switch (STATE.activeTab) {
        case "mine":
            return STATE.snippets.filter((s) => s.ownerUid === uid);
        case "favorites":
            return STATE.snippets.filter((s) => (s.favoritedBy || []).includes(uid));
        case "shared":
            return STATE.snippets.filter((s) => (s.sharedWith || []).includes(uid) && s.ownerUid !== uid);
        case "all":
        default:
            return STATE.snippets;
    }
}

function getSearchFiltered() {
    const term = STATE.search.trim().toLowerCase();
    return getTabFiltered().filter((s) => matchesSearch(s, term));
}

/* Base dataset used to compute which filter values are worth showing —
   tab + search applied, but NOT the active category/tag/collection
   selection itself (so the sidebar always reflects what's selectable). */
function getFilterBaseList() {
    return getSearchFiltered();
}

function getVisibleSnippets() {
    let list = getSearchFiltered();

    if (STATE.category && STATE.category !== "all") {
        list = list.filter((s) => s.category === STATE.category);
    }
    if (STATE.tags.size > 0) {
        list = list.filter((s) => (s.tags || []).some((t) => STATE.tags.has(t)));
    }
    if (STATE.collectionFilter) {
        list = list.filter((s) => s.collection === STATE.collectionFilter);
    }

    return sortSnippets(list, STATE.sort);
}

function sortSnippets(list, sortValue) {
    const copy = [...list];
    switch (sortValue) {
        case "name":
            return copy.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
        case "created":
            return copy.sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
        case "updated":
        default:
            return copy.sort((a, b) => (toDate(b.updatedAt)?.getTime() || 0) - (toDate(a.updatedAt)?.getTime() || 0));
    }
}

function computeFilterOptions() {
    const base = getFilterBaseList();
    const categoryCounts = new Map();
    const tagCounts = new Map();
    const collectionCounts = new Map();

    base.forEach((s) => {
        if (s.category) categoryCounts.set(s.category, (categoryCounts.get(s.category) || 0) + 1);
        (s.tags || []).forEach((t) => tagCounts.set(t, (tagCounts.get(t) || 0) + 1));
        if (s.collection) collectionCounts.set(s.collection, (collectionCounts.get(s.collection) || 0) + 1);
    });

    return { categoryCounts, tagCounts, collectionCounts, total: base.length };
}

/* ==========================================
   RENDER — CARD MARKUP
   (mirrors the static markup shipped in snippets.html
   exactly, so snippets.css needs no changes)
========================================== */
function renderCard(snippet) {
    const uid = STATE.currentUser?.uid;
    const isFavorited = (snippet.favoritedBy || []).includes(uid);
    const isOwner = snippet.ownerUid === uid;
    const author = getAuthorInfo(snippet);
    const tags = (snippet.tags || []).join(",");

    return `
        <article class="snippet-card" data-snippet-id="${escapeHtml(snippet.id)}" data-category="${escapeHtml(snippet.category || "")}" data-tags="${escapeHtml(tags)}">
            <div class="snippet-card-header">
                <div class="snippet-card-title-row">
                    <h3 class="snippet-card-title">${escapeHtml(snippet.title || "Untitled snippet")}</h3>
                    <button type="button" class="snippet-fav-btn${isFavorited ? " is-favorited" : ""}" data-favorite
                        aria-label="${isFavorited ? "Remove from favorites" : "Add to favorites"}" title="${isFavorited ? "Favorited" : "Favorite"}">
                        <i class="${isFavorited ? "ri-star-fill" : "ri-star-line"}"></i>
                    </button>
                </div>
                <p class="snippet-card-desc">${escapeHtml(snippet.description || "No description provided.")}</p>
            </div>

            <div class="snippet-card-meta">
                <div class="snippet-badges">
                    <span class="tech-badge ${techBadgeClass(snippet.category)}">${escapeHtml((snippet.category || "utility").toUpperCase())}</span>
                </div>
                <div class="snippet-meta-right">
                    <span class="lang-badge">${escapeHtml(langBadgeLabel(snippet))}</span>
                    <span class="line-count">${lineCount(snippet.code)} lines</span>
                </div>
            </div>

            <div class="snippet-code-preview" aria-hidden="true">
                <pre><code>${escapeHtml(snippet.code || "")}</code></pre>
            </div>

            <div class="snippet-card-footer">
                <div class="snippet-author">
                    ${renderAvatar(author)}
                    <div class="snippet-author-info">
                        <span class="snippet-author-name">${escapeHtml(isOwner ? "You" : author.name)}</span>
                        <span class="snippet-updated">${escapeHtml(formatRelativeTime(snippet.updatedAt))}</span>
                    </div>
                </div>
                <div class="snippet-actions">
                    <button type="button" class="snippet-action-btn" data-copy-snippet title="Copy code" aria-label="Copy snippet">
                        <i class="ri-file-copy-line"></i>
                    </button>
                    <button type="button" class="snippet-action-btn" data-edit-snippet title="${isOwner ? "Edit" : "View"}" aria-label="${isOwner ? "Edit snippet" : "View snippet"}">
                        <i class="${isOwner ? "ri-pencil-line" : "ri-eye-line"}"></i>
                    </button>
                    <button type="button" class="snippet-action-btn snippet-more-btn" data-snippet-menu title="More actions" aria-label="More actions" aria-haspopup="true">
                        <i class="ri-more-2-fill"></i>
                    </button>
                </div>
            </div>
        </article>
    `;
}

function render() {
    const { grid, resultCount, emptyState } = els();
    if (!grid) return;

    if (!STATE.loaded) {
        grid.innerHTML = `<p class="panel-empty">Loading snippets...</p>`;
        renderFilters();
        renderClearFiltersState();
        return;
    }

    const visible = getVisibleSnippets();

    if (resultCount) {
        resultCount.innerHTML = `Showing <strong>${visible.length}</strong> snippet${visible.length === 1 ? "" : "s"}`;
    }

    if (visible.length === 0) {
        grid.innerHTML = "";
        grid.hidden = true;
        if (emptyState) emptyState.classList.remove("hidden");
    } else {
        if (emptyState) emptyState.classList.add("hidden");
        grid.hidden = false;
        grid.innerHTML = visible.map(renderCard).join("");
    }

    renderFilters();
    renderClearFiltersState();
}

/* ==========================================
   SIDEBAR FILTERS (Categories / Tags / Collections)
========================================== */
function renderFilters() {
    const { categoryList, tagList, collectionList } = els();
    if (!categoryList && !tagList && !collectionList) return;

    const { categoryCounts, tagCounts, collectionCounts, total } = computeFilterOptions();

    if (categoryList) {
        const items = [`
            <li>
                <button type="button" class="filter-item${STATE.category === "all" ? " is-active" : ""}" data-category="all">
                    <i class="ri-apps-2-line"></i>
                    <span class="filter-item-label">All Categories</span>
                    <span class="filter-count">${total}</span>
                </button>
            </li>
        `];

        VALID_CATEGORIES.forEach((cat) => {
            const count = categoryCounts.get(cat) || 0;
            if (count === 0) return;
            items.push(`
                <li>
                    <button type="button" class="filter-item${STATE.category === cat ? " is-active" : ""}" data-category="${cat}">
                        <i class="${categoryIcon(cat)}"></i>
                        <span class="filter-item-label">${escapeHtml(categoryLabel(cat))}</span>
                        <span class="filter-count">${count}</span>
                    </button>
                </li>
            `);
        });

        categoryList.innerHTML = items.join("");
    }

    if (tagList) {
        const tagEntries = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]);
        if (tagEntries.length === 0) {
            tagList.innerHTML = `<p class="filter-empty">No tags yet</p>`;
        } else {
            tagList.innerHTML = tagEntries.map(([tag, count]) => `
                <button type="button" class="tag-chip${STATE.tags.has(tag) ? " is-active" : ""}" data-tag="${escapeHtml(tag)}">
                    ${escapeHtml(tag)}<span class="tag-chip-count">${count}</span>
                </button>
            `).join("");
        }
    }

    if (collectionList) {
        const collectionEntries = Array.from(collectionCounts.entries()).sort((a, b) => b[1] - a[1]);
        if (collectionEntries.length === 0) {
            collectionList.innerHTML = `<p class="filter-empty">No collections yet</p>`;
        } else {
            collectionList.innerHTML = collectionEntries.map(([col, count]) => `
                <li>
                    <button type="button" class="filter-item${STATE.collectionFilter === col ? " is-active" : ""}" data-collection="${escapeHtml(col)}">
                        <i class="ri-folder-3-line"></i>
                        <span class="filter-item-label">${escapeHtml(col)}</span>
                        <span class="filter-count">${count}</span>
                    </button>
                </li>
            `);
        }
    }
}

function renderClearFiltersState() {
    const { clearFiltersBtn } = els();
    if (!clearFiltersBtn) return;
    const hasActiveFilter = STATE.category !== "all" || STATE.tags.size > 0 || !!STATE.collectionFilter;
    clearFiltersBtn.classList.toggle("hidden", !hasActiveFilter);
}

/* ==========================================
   TAB UI SYNC
========================================== */
function syncTabsUI() {
    els().tabs.forEach((tab) => {
        const isActive = tab.dataset.filterTab === STATE.activeTab;
        tab.classList.toggle("is-active", isActive);
        tab.setAttribute("aria-selected", isActive ? "true" : "false");
    });
}

function syncViewUI() {
    const { grid, viewGridBtn, viewListBtn } = els();
    if (!grid) return;
    const isGrid = STATE.view === "grid";
    grid.classList.toggle("is-grid", isGrid);
    grid.classList.toggle("is-list", !isGrid);
    grid.dataset.viewMode = STATE.view;

    if (viewGridBtn) {
        viewGridBtn.classList.toggle("is-active", isGrid);
        viewGridBtn.setAttribute("aria-pressed", isGrid ? "true" : "false");
    }
    if (viewListBtn) {
        viewListBtn.classList.toggle("is-active", !isGrid);
        viewListBtn.setAttribute("aria-pressed", !isGrid ? "true" : "false");
    }
}

/* ==========================================
   EVENT HANDLERS
========================================== */
function handleSearchInput(event) {
    STATE.search = event.target.value || "";
    render();
}

function handleTabClick(event) {
    const tab = event.currentTarget;
    const value = tab.dataset.filterTab;
    if (!VALID_TABS.includes(value) || value === STATE.activeTab) return;
    STATE.activeTab = value;
    syncTabsUI();
    render();
}

function handleFilterListClick(event) {
    const categoryBtn = event.target.closest("[data-category]");
    if (!categoryBtn) return;
    const value = categoryBtn.dataset.category;
    STATE.category = STATE.category === value ? "all" : value;
    render();
}

function handleTagListClick(event) {
    const tagBtn = event.target.closest("[data-tag]");
    if (!tagBtn) return;
    const value = tagBtn.dataset.tag;
    if (STATE.tags.has(value)) {
        STATE.tags.delete(value);
    } else {
        STATE.tags.add(value);
    }
    render();
}

function handleCollectionListClick(event) {
    const collectionBtn = event.target.closest("[data-collection]");
    if (!collectionBtn) return;
    const value = collectionBtn.dataset.collection;
    STATE.collectionFilter = STATE.collectionFilter === value ? null : value;
    render();
}

function handleClearFilters() {
    STATE.category = "all";
    STATE.tags.clear();
    STATE.collectionFilter = null;
    render();
}

function handleSortChange(event) {
    STATE.sort = event.target.value || "updated";
    render();
}

function handleViewToggle(view) {
    if (view === STATE.view) return;
    STATE.view = view === "list" ? "list" : "grid";
    try {
        localStorage.setItem(VIEW_STORAGE_KEY, STATE.view);
    } catch (error) {
        console.warn("[Snippets] Could not persist view mode:", error);
    }
    syncViewUI();
}

/* ---------- Delegated card actions ---------- */
async function handleGridClick(event) {
    const card = event.target.closest(".snippet-card");
    if (!card) return;
    const snippetId = card.dataset.snippetId;
    const snippet = STATE.snippets.find((s) => s.id === snippetId);
    if (!snippet) return;

    if (event.target.closest("[data-favorite]")) {
        await toggleFavorite(snippet);
        return;
    }
    if (event.target.closest("[data-copy-snippet]")) {
        await copySnippetCode(snippet);
        return;
    }
    if (event.target.closest("[data-edit-snippet]")) {
        if (snippet.ownerUid === STATE.currentUser?.uid) {
            openSnippetModal(snippet);
        } else {
            openViewModal(snippet);
        }
        return;
    }
    const menuBtn = event.target.closest("[data-snippet-menu]");
    if (menuBtn) {
        openActionMenu(menuBtn, snippet);
        return;
    }
}

async function toggleFavorite(snippet) {
    const uid = STATE.currentUser?.uid;
    if (!uid) return;
    const currentlyFavorited = (snippet.favoritedBy || []).includes(uid);
    const nextFavorited = !currentlyFavorited;

    // Optimistic UI update
    snippet.favoritedBy = nextFavorited
        ? [...new Set([...(snippet.favoritedBy || []), uid])]
        : (snippet.favoritedBy || []).filter((id) => id !== uid);
    render();

    try {
        await setFavoriteState(snippet.id, uid, nextFavorited);
        showToast(nextFavorited ? "Added to Favorites." : "Removed from Favorites.", "success");
    } catch (error) {
        console.error("[Snippets] Favorite toggle failed:", error);
        // revert on failure
        snippet.favoritedBy = currentlyFavorited
            ? [...new Set([...(snippet.favoritedBy || []), uid])]
            : (snippet.favoritedBy || []).filter((id) => id !== uid);
        render();
        showToast("Couldn't update favorite. Please try again.", "error");
    }
}

async function copySnippetCode(snippet) {
    try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) {
            throw new Error("Clipboard API unavailable");
        }
        await navigator.clipboard.writeText(snippet.code || "");
        showToast("Code copied to clipboard.", "success");
    } catch (error) {
        console.error("[Snippets] Copy failed:", error);
        showToast("Couldn't copy snippet. Please copy it manually.", "error");
    }
}

async function duplicateSnippet(snippet) {
    const uid = STATE.currentUser?.uid;
    if (!uid) {
        showToast("You must be signed in to duplicate a snippet.", "error");
        return;
    }

    try {
        const created = await createSnippetDoc({
            title: `${snippet.title || "Untitled snippet"} Copy`,
            description: snippet.description,
            code: snippet.code,
            language: snippet.language,
            category: snippet.category,
            tags: snippet.tags,
            collection: snippet.collection,
            visibility: snippet.visibility,
            ownerUid: uid,
            workspaceId: STATE.currentWorkspaceId,
        });
        STATE.snippets.push(created);
        render();
        showToast("Snippet duplicated successfully.", "success");
    } catch (error) {
        console.error("[Snippets] Duplicate failed:", error);
        showToast("Couldn't duplicate snippet. Please try again.", "error");
    }
}

async function deleteSnippet(snippet) {
    const uid = STATE.currentUser?.uid;
    if (!uid || snippet.ownerUid !== uid) {
        showToast("You can only delete snippets you own.", "warning");
        return;
    }

    try {
        await deleteSnippetDoc(snippet.id);
        STATE.snippets = STATE.snippets.filter((s) => s.id !== snippet.id);
        render();
        showToast("Snippet deleted successfully.", "success");
    } catch (error) {
        console.error("[Snippets] Delete failed:", error);
        showToast("Couldn't delete snippet. Please try again.", "error");
    }
}

/* ==========================================
   ACTION MENU (built at runtime — see header note)
   Dynamically generated per snippet based on
   ownership + favorite state.
========================================== */
let activeMenuEl = null;

function closeActionMenu() {
    if (activeMenuEl) {
        activeMenuEl.remove();
        activeMenuEl = null;
    }
    document.removeEventListener("keydown", onEscCloseMenu);
}

function positionMenu(menu, anchorBtn) {
    const rect = anchorBtn.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;

    let left = rect.right + window.scrollX - menuRect.width;
    let top = rect.bottom + window.scrollY + 6;

    // Clamp horizontally so the menu never overflows the viewport
    const minLeft = window.scrollX + 8;
    const maxLeft = window.scrollX + viewportWidth - menuRect.width - 8;
    if (left < minLeft) left = minLeft;
    if (left > maxLeft) left = Math.max(minLeft, maxLeft);

    // If there isn't room below, flip the menu above the button instead
    if (rect.bottom + menuRect.height + 12 > viewportHeight) {
        const flippedTop = rect.top + window.scrollY - menuRect.height - 6;
        if (flippedTop > window.scrollY) {
            top = flippedTop;
        }
    }

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
}

function openActionMenu(anchorBtn, snippet) {
    closeActionMenu();
    ensureRuntimeStyles();

    const uid = STATE.currentUser?.uid;
    const isOwner = snippet.ownerUid === uid;
    const isFavorited = (snippet.favoritedBy || []).includes(uid);

    const items = [];
    if (isOwner) {
        items.push({ action: "edit", icon: "ri-pencil-line", label: "Edit" });
    } else {
        items.push({ action: "view", icon: "ri-eye-line", label: "View" });
    }
    items.push({ action: "duplicate", icon: "ri-file-copy-2-line", label: "Duplicate" });
    items.push({
        action: "favorite",
        icon: isFavorited ? "ri-star-fill" : "ri-star-line",
        label: isFavorited ? "Remove from Favorites" : "Add to Favorites",
    });
    items.push({ action: "copy", icon: "ri-clipboard-line", label: "Copy Code" });
    if (isOwner) {
        items.push({ action: "delete", icon: "ri-delete-bin-line", label: "Delete", danger: true });
    }

    const menu = document.createElement("div");
    menu.className = "snippet-inline-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = items.map((item) => `
        <button type="button" role="menuitem" data-action="${item.action}"${item.danger ? ' class="is-danger"' : ""}>
            <i class="${item.icon}"></i> ${escapeHtml(item.label)}
        </button>
    `).join("");

    document.body.appendChild(menu);
    positionMenu(menu, anchorBtn);

    menu.addEventListener("click", async (event) => {
        const actionBtn = event.target.closest("[data-action]");
        if (!actionBtn) return;
        const action = actionBtn.dataset.action;
        closeActionMenu();

        if (action === "edit") openSnippetModal(snippet);
        else if (action === "view") openViewModal(snippet);
        else if (action === "duplicate") await duplicateSnippet(snippet);
        else if (action === "copy") await copySnippetCode(snippet);
        else if (action === "favorite") await toggleFavorite(snippet);
        else if (action === "delete") openDeleteConfirm(snippet);
    });

    activeMenuEl = menu;

    setTimeout(() => {
        document.addEventListener("click", onDocClickCloseMenu, { once: true });
        document.addEventListener("keydown", onEscCloseMenu);
    }, 0);
}

function onDocClickCloseMenu(event) {
    if (activeMenuEl && !activeMenuEl.contains(event.target)) {
        closeActionMenu();
    }
}
function onEscCloseMenu(event) {
    if (event.key === "Escape") {
        closeActionMenu();
    }
}

/* ==========================================
   RUNTIME STYLES
   (menu / modals are appended to <body>, outside
   .snippets-page, so their CSS lives here rather
   than in the scoped snippets.css file)
========================================== */
function ensureRuntimeStyles() {
    if (qs("#snippetsRuntimeStyles")) return;
    const style = document.createElement("style");
    style.id = "snippetsRuntimeStyles";
    style.textContent = `
        .snippet-inline-menu {
            position: absolute;
            z-index: 1050;
            min-width: 190px;
            max-width: calc(100vw - 16px);
            background: var(--surface, #fff);
            border: 1px solid var(--border, #e2e8f0);
            border-radius: var(--radius-md, 12px);
            box-shadow: var(--shadow-md, 0 10px 30px rgba(15,23,42,0.12));
            padding: 6px;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .snippet-inline-menu button {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            padding: 9px 10px;
            border: none;
            background: transparent;
            border-radius: var(--radius-sm, 6px);
            font-size: 13px;
            color: var(--text-secondary, #475569);
            cursor: pointer;
            text-align: left;
        }
        .snippet-inline-menu button:hover {
            background: var(--surface-secondary, #f1f5f9);
            color: var(--text-primary, #0f172a);
        }
        .snippet-inline-menu button.is-danger {
            color: var(--danger, #ef4444);
        }
        .snippet-inline-menu button.is-danger:hover {
            background: rgba(239, 68, 68, 0.1);
            color: var(--danger, #ef4444);
        }
        .snippet-editor-overlay {
            position: fixed;
            inset: 0;
            background: rgba(15, 23, 42, 0.5);
            z-index: 1060;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .snippet-editor-modal {
            width: 100%;
            max-width: 560px;
            max-height: 90vh;
            overflow-y: auto;
            background: var(--surface, #fff);
            border-radius: var(--radius-lg, 16px);
            box-shadow: var(--shadow-xl, 0 30px 60px rgba(15,23,42,0.16));
            padding: 24px;
        }
        .snippet-editor-modal h2 {
            margin: 0 0 16px;
            font-size: 18px;
            color: var(--text-primary, #0f172a);
        }
        .snippet-editor-field {
            margin-bottom: 14px;
        }
        .snippet-editor-field label {
            display: block;
            margin-bottom: 6px;
            font-size: 12.5px;
            font-weight: 600;
            color: var(--text-secondary, #475569);
        }
        .snippet-editor-field input,
        .snippet-editor-field select,
        .snippet-editor-field textarea {
            width: 100%;
            padding: 9px 12px;
            border: 1px solid var(--border, #e2e8f0);
            border-radius: var(--radius-sm, 6px);
            font-size: 13.5px;
            font-family: inherit;
            color: var(--text-primary, #0f172a);
            background: var(--surface, #fff);
        }
        .snippet-editor-field textarea {
            font-family: var(--code-font, monospace);
            min-height: 140px;
            resize: vertical;
        }
        .snippet-editor-row {
            display: flex;
            gap: 12px;
        }
        .snippet-editor-row > .snippet-editor-field {
            flex: 1;
            min-width: 0;
        }
        .snippet-editor-actions {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 18px;
        }
        .snippet-editor-actions button {
            height: 40px;
            padding: 0 18px;
            border-radius: var(--radius-sm, 6px);
            font-size: 13.5px;
            font-weight: 600;
            cursor: pointer;
        }
        .snippet-editor-cancel {
            background: transparent;
            border: 1px solid var(--border, #e2e8f0);
            color: var(--text-secondary, #475569);
        }
        .snippet-editor-save {
            background: var(--primary, #2563eb);
            border: 1px solid var(--primary, #2563eb);
            color: #fff;
        }

        /* Delete confirmation modal */
        .snippet-confirm-modal {
            width: 100%;
            max-width: 420px;
            background: var(--surface, #fff);
            border-radius: var(--radius-lg, 16px);
            box-shadow: var(--shadow-xl, 0 30px 60px rgba(15,23,42,0.16));
            padding: 24px;
        }
        .snippet-confirm-modal h2 {
            margin: 0 0 10px;
            font-size: 17px;
            color: var(--text-primary, #0f172a);
        }
        .snippet-confirm-desc {
            margin: 0;
            font-size: 13.5px;
            line-height: 1.6;
            color: var(--text-secondary, #475569);
        }
        .snippet-editor-delete-confirm {
            height: 40px;
            padding: 0 18px;
            border-radius: var(--radius-sm, 6px);
            font-size: 13.5px;
            font-weight: 600;
            cursor: pointer;
            background: var(--danger, #ef4444);
            border: 1px solid var(--danger, #ef4444);
            color: #fff;
        }
        .snippet-editor-delete-confirm:hover {
            background: #dc2626;
            border-color: #dc2626;
        }
        .snippet-editor-delete-confirm:disabled {
            opacity: 0.65;
            cursor: not-allowed;
        }

        /* Read-only view modal */
        .snippet-view-modal h2 {
            margin-bottom: 6px;
        }
        .snippet-view-desc {
            margin: 0 0 16px;
            font-size: 13.5px;
            color: var(--text-secondary, #475569);
            line-height: 1.5;
        }
        .snippet-view-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 16px;
        }
        .snippet-view-field {
            margin-bottom: 16px;
        }
        .snippet-view-field label {
            display: block;
            margin-bottom: 8px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--text-muted, #94a3b8);
        }
        .snippet-view-empty {
            font-size: 12.5px;
            color: var(--text-muted, #94a3b8);
        }
        .snippet-view-code {
            margin: 0;
            max-height: 260px;
        }
        .snippet-view-code code {
            white-space: pre-wrap;
            word-break: break-word;
        }
        .snippet-view-author {
            display: flex;
            align-items: center;
            gap: 10px;
            padding-top: 12px;
            border-top: 1px solid var(--border-subtle, #e2e8f0);
            font-size: 13px;
            font-weight: 600;
            color: var(--text-primary, #0f172a);
        }

        @media (max-width: 480px) {
            .snippet-editor-modal,
            .snippet-confirm-modal {
                padding: 18px;
            }
        }
    `;
    document.head.appendChild(style);
}

/* ==========================================
   DELETE CONFIRMATION MODAL
========================================== */
let confirmModalEl = null;

function closeConfirmModal() {
    if (confirmModalEl) {
        confirmModalEl.remove();
        confirmModalEl = null;
    }
    document.removeEventListener("keydown", onEscCloseConfirm);
}
function onEscCloseConfirm(event) {
    if (event.key === "Escape") closeConfirmModal();
}

function openDeleteConfirm(snippet) {
    ensureRuntimeStyles();
    closeConfirmModal();
    closeActionMenu();

    const overlay = document.createElement("div");
    overlay.className = "snippet-editor-overlay";
    overlay.innerHTML = `
        <div class="snippet-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="snippetConfirmTitle">
            <h2 id="snippetConfirmTitle">Delete snippet?</h2>
            <p class="snippet-confirm-desc">Are you sure you want to delete "${escapeHtml(snippet.title || "this snippet")}"? This action cannot be undone.</p>
            <div class="snippet-editor-actions">
                <button type="button" class="snippet-editor-cancel" data-confirm-cancel>Cancel</button>
                <button type="button" class="snippet-editor-delete-confirm" data-confirm-delete>Delete</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    confirmModalEl = overlay;

    overlay.addEventListener("click", (event) => {
        if (event.target === overlay) closeConfirmModal();
    });
    qs("[data-confirm-cancel]", overlay).addEventListener("click", closeConfirmModal);
    qs("[data-confirm-delete]", overlay).addEventListener("click", async (event) => {
        const btn = event.currentTarget;
        btn.disabled = true;
        await deleteSnippet(snippet);
        closeConfirmModal();
    });

    document.addEventListener("keydown", onEscCloseConfirm);
}

/* ==========================================
   READ-ONLY VIEW MODAL (for snippets you don't own)
========================================== */
let viewModalEl = null;

function closeViewModal() {
    if (viewModalEl) {
        viewModalEl.remove();
        viewModalEl = null;
    }
    document.removeEventListener("keydown", onEscCloseView);
}
function onEscCloseView(event) {
    if (event.key === "Escape") closeViewModal();
}

function openViewModal(snippet) {
    ensureRuntimeStyles();
    closeViewModal();
    closeActionMenu();

    const author = getAuthorInfo(snippet);
    const tagsHtml = (snippet.tags || []).length
        ? (snippet.tags || []).map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("")
        : `<span class="snippet-view-empty">No tags</span>`;

    const overlay = document.createElement("div");
    overlay.className = "snippet-editor-overlay";
    overlay.innerHTML = `
        <div class="snippet-editor-modal snippet-view-modal" role="dialog" aria-modal="true" aria-label="View snippet">
            <h2>${escapeHtml(snippet.title || "Untitled snippet")}</h2>
            <p class="snippet-view-desc">${escapeHtml(snippet.description || "No description provided.")}</p>
            <div class="snippet-view-meta">
                <span class="tech-badge ${techBadgeClass(snippet.category)}">${escapeHtml((snippet.category || "utility").toUpperCase())}</span>
                <span class="lang-badge">${escapeHtml(langBadgeLabel(snippet))}</span>
                ${snippet.collection ? `<span class="lang-badge">${escapeHtml(snippet.collection)}</span>` : ""}
            </div>
            <div class="snippet-view-field">
                <label>Tags</label>
                <div class="filter-tags">${tagsHtml}</div>
            </div>
            <div class="snippet-view-field">
                <label>Code</label>
                <div class="snippet-code-preview snippet-view-code"><pre><code>${escapeHtml(snippet.code || "")}</code></pre></div>
            </div>
            <div class="snippet-view-author">
                ${renderAvatar(author)}
                <span>${escapeHtml(author.name)}</span>
            </div>
            <div class="snippet-editor-actions">
                <button type="button" class="snippet-editor-cancel" data-view-close>Close</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    viewModalEl = overlay;

    overlay.addEventListener("click", (event) => {
        if (event.target === overlay) closeViewModal();
    });
    qs("[data-view-close]", overlay).addEventListener("click", closeViewModal);

    document.addEventListener("keydown", onEscCloseView);
}

/* ==========================================
   SNIPPET EDITOR MODAL (built at runtime — see header note)
   Shared by Create and Edit — only the payload
   target (new doc vs existing doc) changes.
========================================== */
let modalEl = null;

function closeSnippetModal() {
    if (modalEl) {
        modalEl.remove();
        modalEl = null;
    }
    STATE.editingSnippetId = null;
    document.removeEventListener("keydown", onEscCloseModal);
}
function onEscCloseModal(event) {
    if (event.key === "Escape") closeSnippetModal();
}

function openSnippetModal(snippet = null) {
    ensureRuntimeStyles();
    closeSnippetModal();
    closeActionMenu();

    STATE.editingSnippetId = snippet?.id || null;
    const isEdit = !!snippet;

    const overlay = document.createElement("div");
    overlay.className = "snippet-editor-overlay";
    overlay.innerHTML = `
        <div class="snippet-editor-modal" role="dialog" aria-modal="true" aria-label="${isEdit ? "Edit snippet" : "New snippet"}">
            <h2>${isEdit ? "Edit Snippet" : "New Snippet"}</h2>
            <form data-snippet-form>
                <div class="snippet-editor-field">
                    <label for="snippetTitleInput">Title</label>
                    <input type="text" id="snippetTitleInput" required maxlength="80" value="${escapeHtml(snippet?.title || "")}">
                </div>
                <div class="snippet-editor-field">
                    <label for="snippetDescInput">Description</label>
                    <input type="text" id="snippetDescInput" maxlength="200" value="${escapeHtml(snippet?.description || "")}">
                </div>
                <div class="snippet-editor-row">
                    <div class="snippet-editor-field">
                        <label for="snippetCategoryInput">Category</label>
                        <select id="snippetCategoryInput">
                            ${VALID_CATEGORIES.map((cat) => `<option value="${cat}" ${snippet?.category === cat ? "selected" : ""}>${cat.charAt(0).toUpperCase() + cat.slice(1)}</option>`).join("")}
                        </select>
                    </div>
                    <div class="snippet-editor-field">
                        <label for="snippetLanguageInput">Language</label>
                        <input type="text" id="snippetLanguageInput" placeholder="e.g. javascript" value="${escapeHtml(snippet?.language || "")}">
                    </div>
                </div>
                <div class="snippet-editor-row">
                    <div class="snippet-editor-field">
                        <label for="snippetTagsInput">Tags (comma separated)</label>
                        <input type="text" id="snippetTagsInput" placeholder="button, form" value="${escapeHtml((snippet?.tags || []).join(", "))}">
                    </div>
                    <div class="snippet-editor-field">
                        <label for="snippetCollectionInput">Collection</label>
                        <select id="snippetCollectionInput">
                            <option value="">None</option>
                            <option value="landing-page" ${snippet?.collection === "landing-page" ? "selected" : ""}>Landing Page</option>
                            <option value="dashboard-ui" ${snippet?.collection === "dashboard-ui" ? "selected" : ""}>Dashboard UI</option>
                            <option value="ecommerce" ${snippet?.collection === "ecommerce" ? "selected" : ""}>E-Commerce</option>
                            <option value="auth" ${snippet?.collection === "auth" ? "selected" : ""}>Auth</option>
                        </select>
                    </div>
                </div>
                <div class="snippet-editor-field">
                    <label for="snippetVisibilityInput">Visibility</label>
                    <select id="snippetVisibilityInput">
                        <option value="private" ${(!snippet || snippet.visibility === "private") ? "selected" : ""}>Private (only me)</option>
                        <option value="workspace" ${snippet?.visibility === "workspace" ? "selected" : ""}>Shared with workspace</option>
                    </select>
                </div>
                <div class="snippet-editor-field">
                    <label for="snippetCodeInput">Code</label>
                    <textarea id="snippetCodeInput" spellcheck="false" required>${escapeHtml(snippet?.code || "")}</textarea>
                </div>
                <div class="snippet-editor-actions">
                    <button type="button" class="snippet-editor-cancel" data-modal-cancel>Cancel</button>
                    <button type="submit" class="snippet-editor-save">${isEdit ? "Save Changes" : "Create Snippet"}</button>
                </div>
            </form>
        </div>
    `;

    document.body.appendChild(overlay);
    modalEl = overlay;

    overlay.addEventListener("click", (event) => {
        if (event.target === overlay) closeSnippetModal();
    });
    qs("[data-modal-cancel]", overlay).addEventListener("click", closeSnippetModal);
    qs("[data-snippet-form]", overlay).addEventListener("submit", (event) => handleSnippetFormSubmit(event, snippet));
    document.addEventListener("keydown", onEscCloseModal);

    qs("#snippetTitleInput", overlay)?.focus();
}

async function handleSnippetFormSubmit(event, existingSnippet) {
    event.preventDefault();
    const form = event.currentTarget;
    const uid = STATE.currentUser?.uid;
    if (!uid) {
        showToast("You must be signed in to save a snippet.", "error");
        return;
    }

    const title = qs("#snippetTitleInput", form).value.trim();
    const code = qs("#snippetCodeInput", form).value;
    if (!title || !code.trim()) {
        showToast("Title and code are required.", "warning");
        return;
    }

    const payload = {
        title,
        description: qs("#snippetDescInput", form).value,
        category: qs("#snippetCategoryInput", form).value,
        language: qs("#snippetLanguageInput", form).value,
        tags: qs("#snippetTagsInput", form).value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
        collection: qs("#snippetCollectionInput", form).value || null,
        visibility: qs("#snippetVisibilityInput", form).value,
        code,
    };

    const submitBtn = qs(".snippet-editor-save", form);
    submitBtn?.setAttribute("disabled", "true");

    try {
        // Editing must only be permitted for the snippet's own owner —
        // the pencil icon / "Edit" menu item are already hidden for
        // other users' snippets, but this is a last-line safeguard.
        if (existingSnippet && existingSnippet.ownerUid !== uid) {
            showToast("You can only edit snippets you own.", "warning");
            return;
        }

        if (existingSnippet) {
            const updated = await updateSnippetDoc(existingSnippet.id, payload);
            Object.assign(existingSnippet, updated, payload);
            showToast("Snippet updated successfully.", "success");
        } else {
            const created = await createSnippetDoc({
                ...payload,
                ownerUid: uid,
                workspaceId: STATE.currentWorkspaceId,
            });
            STATE.snippets.push(created);
            showToast("Snippet created successfully.", "success");
        }
        closeSnippetModal();
        render();
    } catch (error) {
        console.error("[Snippets] Save failed:", error);
        showToast("Couldn't save snippet. Please try again.", "error");
    } finally {
        submitBtn?.removeAttribute("disabled");
    }
}

/* ==========================================
   IMPORT
========================================== */
let importInputEl = null;

function ensureImportInput() {
    if (importInputEl) return importInputEl;
    importInputEl = document.createElement("input");
    importInputEl.type = "file";
    importInputEl.accept = "application/json,.json";
    importInputEl.style.display = "none";
    importInputEl.addEventListener("change", handleImportFileSelected);
    document.body.appendChild(importInputEl);
    return importInputEl;
}

function triggerImport() {
    if (!STATE.currentUser) {
        showToast("You must be signed in to import snippets.", "error");
        return;
    }
    ensureImportInput().click();
}

async function handleImportFileSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const items = Array.isArray(parsed) ? parsed : [parsed];

        const uid = STATE.currentUser.uid;
        let importedCount = 0;
        let skippedCount = 0;

        for (const item of items) {
            if (!item || !item.title || !item.code) {
                skippedCount += 1;
                continue;
            }
            const created = await createSnippetDoc({
                title: item.title,
                description: item.description,
                code: item.code,
                language: item.language,
                category: item.category,
                tags: item.tags,
                collection: item.collection,
                visibility: item.visibility,
                ownerUid: uid,
                workspaceId: STATE.currentWorkspaceId,
            });
            STATE.snippets.push(created);
            importedCount += 1;
        }

        render();

        if (importedCount > 0) {
            showToast(
                `Imported ${importedCount} snippet${importedCount === 1 ? "" : "s"}${skippedCount ? ` (${skippedCount} skipped)` : ""}.`,
                "success"
            );
        } else {
            showToast("No valid snippets found in that file.", "warning");
        }
    } catch (error) {
        console.error("[Snippets] Import failed:", error);
        showToast("Couldn't import that file. Make sure it's valid JSON.", "error");
    }
}

/* ==========================================
   KEYBOARD SHORTCUT — Ctrl/Cmd+K
========================================== */
function handleGlobalKeydown(event) {
    const isShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
    if (!isShortcut) return;
    const { searchInput, page } = els();
    if (!searchInput || !page) return;
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
}

/* ==========================================
   EVENT BINDING (idempotent — guards against
   duplicate listeners if init() ever re-runs)
========================================== */
function bindEventsOnce() {
    const {
        searchInput, tabs, grid, sortSelect, viewGridBtn, viewListBtn,
        importBtn, newSnippetBtn, page,
        categoryList, tagList, collectionList, clearFiltersBtn,
    } = els();

    if (searchInput && searchInput.dataset.bound !== "true") {
        searchInput.addEventListener("input", debounce(handleSearchInput, SEARCH_DEBOUNCE_MS));
        searchInput.dataset.bound = "true";
    }

    tabs.forEach((tab) => {
        if (tab.dataset.bound === "true") return;
        tab.addEventListener("click", handleTabClick);
        tab.dataset.bound = "true";
    });

    // Filter lists are re-rendered on every render(), so we bind a single
    // delegated listener to each container instead of per-item listeners.
    if (categoryList && categoryList.dataset.delegateBound !== "true") {
        categoryList.addEventListener("click", handleFilterListClick);
        categoryList.dataset.delegateBound = "true";
    }
    if (tagList && tagList.dataset.delegateBound !== "true") {
        tagList.addEventListener("click", handleTagListClick);
        tagList.dataset.delegateBound = "true";
    }
    if (collectionList && collectionList.dataset.delegateBound !== "true") {
        collectionList.addEventListener("click", handleCollectionListClick);
        collectionList.dataset.delegateBound = "true";
    }
    if (clearFiltersBtn && clearFiltersBtn.dataset.bound !== "true") {
        clearFiltersBtn.addEventListener("click", handleClearFilters);
        clearFiltersBtn.dataset.bound = "true";
    }

    if (sortSelect && sortSelect.dataset.bound !== "true") {
        sortSelect.addEventListener("change", handleSortChange);
        sortSelect.dataset.bound = "true";
    }

    if (viewGridBtn && viewGridBtn.dataset.bound !== "true") {
        viewGridBtn.addEventListener("click", () => handleViewToggle("grid"));
        viewGridBtn.dataset.bound = "true";
    }
    if (viewListBtn && viewListBtn.dataset.bound !== "true") {
        viewListBtn.addEventListener("click", () => handleViewToggle("list"));
        viewListBtn.dataset.bound = "true";
    }

    // Delegated — safe for dynamically rendered cards, bound once on the container
    if (grid && grid.dataset.delegateBound !== "true") {
        grid.addEventListener("click", handleGridClick);
        grid.dataset.delegateBound = "true";
    }

    if (importBtn && importBtn.dataset.bound !== "true") {
        importBtn.addEventListener("click", triggerImport);
        importBtn.dataset.bound = "true";
    }

    if (newSnippetBtn && newSnippetBtn.dataset.bound !== "true") {
        newSnippetBtn.addEventListener("click", () => openSnippetModal(null));
        newSnippetBtn.dataset.bound = "true";
    }

    if (page && page.dataset.keydownBound !== "true") {
        document.addEventListener("keydown", handleGlobalKeydown);
        page.dataset.keydownBound = "true";
    }
}

/* ==========================================
   VIEW PERSISTENCE
========================================== */
function restoreViewPreference() {
    try {
        const saved = localStorage.getItem(VIEW_STORAGE_KEY);
        if (saved === "grid" || saved === "list") {
            STATE.view = saved;
        }
    } catch (error) {
        console.warn("[Snippets] Could not read saved view mode:", error);
    }
}

/* ==========================================
   AUTH / WORKSPACE CONTEXT
   Reuses layout.js's already-established state
   instead of duplicating auth/workspace logic.
========================================== */
function applyLayoutState(layoutState) {
    STATE.currentUser = layoutState?.currentUser || getCurrentUser();
    STATE.currentWorkspaceId = layoutState?.currentWorkspace?.id || getCurrentWorkspaceId();
}

async function bootstrapContext() {
    if (window.NovaLayout && typeof window.NovaLayout.isReady === "function" && window.NovaLayout.isReady()) {
        applyLayoutState(window.NovaLayout.getState());
        return;
    }

    // Fall back to auth.js directly if layout.js hasn't announced readiness yet.
    STATE.currentUser = getCurrentUser();
    STATE.currentWorkspaceId = getCurrentWorkspaceId();
}

function attachContextListeners() {
    document.addEventListener("novaeditor:layout-ready", (event) => {
        applyLayoutState(event.detail);
        loadSnippets();
    });

    document.addEventListener("novaeditor:workspace-changed", (event) => {
        STATE.currentWorkspaceId = event.detail?.id || null;
        loadSnippets();
    });

    document.addEventListener("novaeditor:unauthenticated", () => {
        STATE.currentUser = null;
        STATE.snippets = [];
        STATE.loaded = true;
        render();
    });

    onAuthStateChange((user) => {
        const uidChanged = (user?.uid || null) !== (STATE.currentUser?.uid || null);
        STATE.currentUser = user;
        if (uidChanged) {
            loadSnippets();
        }
    });
}

/* ==========================================
   INIT
========================================== */
async function init() {
    if (STATE.initialized) return;
    STATE.initialized = true;

    if (!els().page) {
        // Not on the Snippets page — nothing to do.
        return;
    }

    restoreViewPreference();
    syncViewUI();
    syncTabsUI();
    bindEventsOnce();
    attachContextListeners();

    await bootstrapContext();
    await loadSnippets();
}

document.addEventListener("DOMContentLoaded", () => {
    init().catch((error) => {
        console.error("[Snippets] Unhandled error during init():", error);
    });
});