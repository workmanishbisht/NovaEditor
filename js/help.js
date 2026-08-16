/**
 * Nova Editor — Help & Support (single-page UI interactions)
 * Client-side only. No article routes, no fake APIs.
 */

import { showToast } from "../components/toast.js";

/* ==========================================
   Data
========================================== */

const HELP_CATEGORIES = [
    {
        id: "getting-started",
        title: "Getting Started",
        description: "Learn the basics and get started with Nova Editor.",
        icon: "ri-rocket-line",
    },
    {
        id: "projects",
        title: "Projects",
        description: "Create, manage, import, restore, and organize your projects.",
        icon: "ri-folder-line",
    },
    {
        id: "code-editor",
        title: "Code Editor",
        description: "Learn about files, tabs, Monaco Editor, saving, and editor preferences.",
        icon: "ri-code-s-slash-line",
    },
    {
        id: "ai-assistant",
        title: "AI Assistant",
        description: "Learn how to use Nova Editor's AI Assistant.",
        icon: "ri-sparkling-line",
    },
    {
        id: "keyboard-shortcuts",
        title: "Keyboard Shortcuts",
        description: "Discover shortcuts to work faster.",
        icon: "ri-keyboard-line",
    },
    {
        id: "account-settings",
        title: "Account & Settings",
        description: "Manage your profile, preferences, workspace, and account.",
        icon: "ri-settings-3-line",
    },
];

const HELP_ARTICLES = [
    {
        id: "getting-started",
        categoryId: "getting-started",
        category: "Getting Started",
        title: "Getting started with Nova Editor",
        description: "Onboarding · Basics",
        icon: "ri-book-open-line",
        keywords: ["start", "onboarding", "basics", "intro", "begin"],
        content: `
      <p>Nova Editor is a browser-based workspace for writing, organizing, and shipping code. This guide walks you through the essentials.</p>
      <ol class="help-step-list">
        <li><strong>Create a project</strong> — From the Dashboard or Projects page, click <strong>New Project</strong>, enter a name, and confirm.</li>
        <li><strong>Open the project</strong> — Select it from your projects list to enter the editor workspace.</li>
        <li><strong>Add files and folders</strong> — Use the file tree controls to create files and folders for your work.</li>
        <li><strong>Edit code</strong> — Open a file in the Monaco-powered editor. Changes appear in the active tab.</li>
        <li><strong>Save your work</strong> — Use Save or enable Auto Save in Editor Preferences.</li>
        <li><strong>Organize</strong> — Star projects as Favorites and manage Trash when you need to restore something later.</li>
      </ol>
      <p>When you’re ready for more, explore Projects, the Code Editor, AI Assistant, and Settings from the sidebar.</p>
    `,
    },
    {
        id: "first-project",
        categoryId: "projects",
        category: "Projects",
        title: "Creating your first project",
        description: "Projects · Setup",
        icon: "ri-folder-add-line",
        keywords: ["create", "new project", "setup"],
        content: `
      <p>Projects are the main containers for your code in Nova Editor.</p>
      <ol class="help-step-list">
        <li>Open <strong>Projects</strong> from the sidebar (or use <strong>New Project</strong> on the Dashboard).</li>
        <li>Click <strong>New Project</strong>.</li>
        <li>Enter a clear project name.</li>
        <li>Optionally choose a default language if the dialog provides one.</li>
        <li>Confirm to create the project, then open it to start editing.</li>
      </ol>
      <p>Your new project appears in the projects list and can be opened anytime from the Dashboard or Projects page.</p>
    `,
    },
    {
        id: "manage-files",
        categoryId: "projects",
        category: "Projects",
        title: "Managing project files and folders",
        description: "Projects · Files",
        icon: "ri-folder-3-line",
        keywords: ["files", "folders", "tree", "file tree"],
        content: `
      <p>Inside a project, the file tree is where you create and organize files and folders.</p>
      <ol class="help-step-list">
        <li>Open a project so the editor workspace loads.</li>
        <li>Use the file tree actions to add a <strong>new file</strong> or <strong>new folder</strong>.</li>
        <li>Name the item and confirm. Nested folders help keep larger projects tidy.</li>
        <li>Click a file to open it in a tab. Multiple tabs can stay open while you work.</li>
        <li>Rename or remove items carefully — deleted project items may go to Trash depending on the action.</li>
      </ol>
      <p>Keep related files in folders (for example <code>src</code>, <code>styles</code>) so navigation stays simple as the project grows.</p>
    `,
    },
    {
        id: "code-editor",
        categoryId: "code-editor",
        category: "Code Editor",
        title: "Using the code editor",
        description: "Editor · Monaco",
        icon: "ri-code-s-slash-line",
        keywords: ["monaco", "editor", "tabs", "syntax"],
        content: `
      <p>Nova Editor uses a Monaco-based code editor with tabs, syntax highlighting, and familiar editing shortcuts.</p>
      <ol class="help-step-list">
        <li>Open a project and select a file from the tree to load it in the editor.</li>
        <li>Edit in the active tab. Unsaved changes are indicated according to your Auto Save preference.</li>
        <li>Switch between open files using the tab bar.</li>
        <li>Adjust defaults under <strong>Settings → Editor Preferences</strong> (font size, tab size, word wrap, minimap, line numbers).</li>
        <li>Save with the editor Save action or your OS shortcut (typically ⌘S / Ctrl+S).</li>
      </ol>
      <p>Preferences apply as defaults when you open the editor; change them anytime from Settings.</p>
    `,
    },
    {
        id: "favorites",
        categoryId: "projects",
        category: "Projects",
        title: "Working with Favorites",
        description: "Projects · Organization",
        icon: "ri-star-line",
        keywords: ["favorites", "star", "organize"],
        content: `
      <p>Favorites help you jump back to the projects you use most.</p>
      <ol class="help-step-list">
        <li>From the Projects list, mark a project as a Favorite (star action).</li>
        <li>Favorited projects surface in filtered or highlighted views so they’re easier to find.</li>
        <li>Remove a Favorite the same way when you no longer need quick access.</li>
      </ol>
      <p>Favorites don’t change project ownership or permissions — they’re a personal organization tool.</p>
    `,
    },
    {
        id: "ai-assistant",
        categoryId: "ai-assistant",
        category: "AI Assistant",
        title: "Using the AI Assistant",
        description: "AI · Productivity",
        icon: "ri-sparkling-2-line",
        keywords: ["ai", "assistant", "chat", "spark"],
        content: `
      <p>The AI Assistant helps with explanations, suggestions, and coding tasks inside Nova Editor.</p>
      <ol class="help-step-list">
        <li>Open <strong>AI Assistant</strong> from the sidebar.</li>
        <li>Describe what you need — for example, explain a snippet, suggest a refactor, or outline a feature.</li>
        <li>Review the response and apply useful ideas in your project files.</li>
        <li>Keep context specific (language, file purpose, constraints) for better results.</li>
      </ol>
      <p>Treat AI output as a starting point: verify correctness in the editor before relying on it in production code.</p>
    `,
    },
    {
        id: "workspace",
        categoryId: "account-settings",
        category: "Account & Settings",
        title: "Managing your workspace",
        description: "Workspace · Settings",
        icon: "ri-stack-line",
        keywords: ["workspace", "name", "settings"],
        content: `
      <p>Workspace settings control how your Nova Editor environment is labeled and configured.</p>
      <ol class="help-step-list">
        <li>Open <strong>Settings</strong> from the sidebar.</li>
        <li>Go to the <strong>Workspace</strong> section.</li>
        <li>Update workspace name, default project name, or coding experience level as needed.</li>
        <li>Save changes so they apply to your session and future visits.</li>
      </ol>
      <p>Other Settings tabs cover appearance, notifications, security, and data preferences.</p>
    `,
    },
    {
        id: "editor-preferences",
        categoryId: "code-editor",
        category: "Code Editor",
        title: "Understanding Editor Preferences",
        description: "Settings · Editor",
        icon: "ri-equalizer-line",
        keywords: ["preferences", "font", "tab", "wrap", "minimap"],
        content: `
      <p>Editor Preferences set defaults used when you open the code editor.</p>
      <ol class="help-step-list">
        <li>Open <strong>Settings → Editor Preferences</strong>.</li>
        <li>Choose a default language, font size, and tab size.</li>
        <li>Toggle Word Wrap, Auto Save, Minimap, and Line Numbers.</li>
        <li>Click <strong>Save Changes</strong> to persist your choices.</li>
      </ol>
      <p>These options affect comfort and productivity; adjust them whenever your workflow changes.</p>
    `,
    },
    {
        id: "keyboard-shortcuts",
        categoryId: "keyboard-shortcuts",
        category: "Keyboard Shortcuts",
        title: "Keyboard shortcuts overview",
        description: "Productivity · Shortcuts",
        icon: "ri-keyboard-line",
        keywords: ["shortcut", "hotkey", "keyboard"],
        content: `
      <p>Keyboard shortcuts speed up navigation and editing in Nova Editor.</p>
      <ol class="help-step-list">
        <li>Use common editor shortcuts such as Save (⌘S / Ctrl+S) while coding.</li>
        <li>Check the in-app shortcuts reference from Help or the shortcuts entry in the product when available.</li>
        <li>Global search and Help search may use ⌘K / Ctrl+K depending on your layout configuration.</li>
      </ol>
      <p>Shortcut availability can depend on focus (editor vs. app chrome). Prefer the documented list for the exact binding on your device.</p>
    `,
    },
    {
        id: "restore-trash",
        categoryId: "projects",
        category: "Projects",
        title: "Restoring projects from Trash",
        description: "Projects · Trash",
        icon: "ri-delete-bin-line",
        keywords: ["trash", "restore", "delete", "recover"],
        content: `
      <p>Projects moved to Trash can usually be restored before permanent deletion.</p>
      <ol class="help-step-list">
        <li>Open <strong>Projects</strong>.</li>
        <li>Switch to the <strong>Trash</strong> view.</li>
        <li>Select the project you want to recover.</li>
        <li>Choose <strong>Restore</strong>. The project returns to your active list.</li>
      </ol>
      <p>If an item is permanently removed, it cannot be restored from Trash.</p>
    `,
    },
];

const FAQ_ITEMS = [
    {
        id: "faq-new-project",
        categoryId: "projects",
        question: "How do I create a new project?",
        answer:
            "From the Dashboard or Projects page, click <strong>New Project</strong>. Enter a name, optionally choose a default language, then open the project to start adding files.",
        keywords: ["create", "new project"],
    },
    {
        id: "faq-files-folders",
        categoryId: "projects",
        question: "How do I create files and folders?",
        answer:
            "Open a project, then use the file tree actions to add a new file or folder. You can also use the New File / New Folder controls in the editor toolbar where available.",
        keywords: ["files", "folders", "tree"],
    },
    {
        id: "faq-save",
        categoryId: "code-editor",
        question: "How do I save my changes?",
        answer:
            "Use the save action in the editor or the keyboard shortcut (typically ⌘S / Ctrl+S). If Auto Save is enabled in Editor Preferences, changes are saved automatically as you work.",
        keywords: ["save", "auto save"],
    },
    {
        id: "faq-restore",
        categoryId: "projects",
        question: "How do I restore a project from Trash?",
        answer:
            "Go to Projects, open the Trash view, select the project you want to recover, and choose Restore. The project will return to your active projects list.",
        keywords: ["trash", "restore", "recover"],
    },
    {
        id: "faq-preferences",
        categoryId: "code-editor",
        question: "How do I change my editor preferences?",
        answer:
            "Open Settings → Editor Preferences. Adjust default language, font size, tab size, word wrap, minimap, line numbers, and auto save, then save your changes.",
        keywords: ["preferences", "settings", "editor"],
    },
];

/* ==========================================
   State
========================================== */

const state = {
    searchQuery: "",
    activeCategoryId: null,
    openFaqId: null,
    activeModal: null,
};

/* ==========================================
   DOM refs
========================================== */

const els = {};

function cacheDom() {
    els.centerView = document.getElementById("helpCenterView");
    els.articleView = document.getElementById("helpArticleView");
    els.articleBack = document.getElementById("helpArticleBack");
    els.articleCategory = document.getElementById("helpArticleCategory");
    els.articleTitle = document.getElementById("helpArticleTitle");
    els.articleBody = document.getElementById("helpArticleBody");

    els.searchInput = document.getElementById("helpSearchInput");
    els.searchClear = document.getElementById("helpSearchClear");

    els.filterBanner = document.getElementById("helpFilterBanner");
    els.filterLabel = document.getElementById("helpFilterLabel");
    els.filterClear = document.getElementById("helpFilterClear");

    els.emptyState = document.getElementById("helpEmptyState");
    els.emptyClear = document.getElementById("helpEmptyClear");

    els.categoryGrid = document.getElementById("helpCategoryGrid");
    els.articlesList = document.getElementById("helpArticlesList");
    els.faqList = document.getElementById("helpFaqList");

    els.categoriesSection = document.getElementById("helpCategoriesSection");
    els.articlesSection = document.getElementById("helpArticlesSection");
    els.onboardingSection = document.getElementById("helpOnboardingSection");
    els.faqSection = document.getElementById("helpFaqSection");
    els.contactSection = document.getElementById("helpContactSection");
    els.statusSection = document.getElementById("helpStatusSection");

    els.getStartedBtn = document.getElementById("helpGetStartedBtn");
    els.viewGuideBtn = document.getElementById("helpViewGuideBtn");
    els.contactBtn = document.getElementById("helpContactBtn");
    els.communityBtn = document.getElementById("helpCommunityBtn");

    els.contactOverlay = document.getElementById("helpContactOverlay");
    els.contactForm = document.getElementById("helpContactForm");
    els.contactClose = document.getElementById("helpContactClose");
    els.contactCancel = document.getElementById("helpContactCancel");
    els.contactError = document.getElementById("helpContactError");
    els.contactName = document.getElementById("helpContactName");
    els.contactEmail = document.getElementById("helpContactEmail");
    els.contactSubject = document.getElementById("helpContactSubject");
    els.contactMessage = document.getElementById("helpContactMessage");

    els.communityOverlay = document.getElementById("helpCommunityOverlay");
    els.communityClose = document.getElementById("helpCommunityClose");
    els.communityGotIt = document.getElementById("helpCommunityGotIt");
}

/* ==========================================
   Helpers
========================================== */

function normalize(str) {
    return (str || "").toLowerCase().trim();
}

function matchesQuery(text, query) {
    if (!query) return true;
    return normalize(text).includes(query);
}

function articleMatches(article, query, categoryId) {
    if (categoryId && article.categoryId !== categoryId) return false;
    if (!query) return true;
    const haystack = [
        article.title,
        article.description,
        article.category,
        ...(article.keywords || []),
        article.content.replace(/<[^>]+>/g, " "),
    ].join(" ");
    return matchesQuery(haystack, query);
}

function faqMatches(item, query, categoryId) {
    if (categoryId && item.categoryId !== categoryId) return false;
    if (!query) return true;
    const haystack = [item.question, item.answer.replace(/<[^>]+>/g, " "), ...(item.keywords || [])].join(" ");
    return matchesQuery(haystack, query);
}

function categoryMatches(cat, query) {
    if (!query) return true;
    return matchesQuery([cat.title, cat.description].join(" "), query);
}

function safeToast(message, type = "success") {
    try {
        if (typeof showToast === "function") {
            showToast(message, type);
            return;
        }
    } catch (_) {
        /* fall through */
    }
    // Fallback: no alert()
    console.info(`[Help] ${message}`);
}

/* ==========================================
   Render
========================================== */

function renderCategories() {
    const q = normalize(state.searchQuery);
    const html = HELP_CATEGORIES.map((cat) => {
        const visible = categoryMatches(cat, q) && (!state.activeCategoryId || state.activeCategoryId === cat.id);
        const active = state.activeCategoryId === cat.id;
        return `
      <button type="button"
        class="help-category-card${active ? " is-active" : ""}"
        data-category-id="${cat.id}"
        ${visible ? "" : "hidden"}>
        <span class="help-category-icon"><i class="${cat.icon}" aria-hidden="true"></i></span>
        <span class="help-category-body">
          <strong>${cat.title}</strong>
          <span>${cat.description}</span>
        </span>
        <i class="ri-arrow-right-s-line help-category-arrow" aria-hidden="true"></i>
      </button>
    `;
    }).join("");
    els.categoryGrid.innerHTML = html;
}

function renderArticles() {
    const q = normalize(state.searchQuery);
    const html = HELP_ARTICLES.map((article) => {
        const visible = articleMatches(article, q, state.activeCategoryId);
        return `
      <button type="button" class="help-article" data-article-id="${article.id}" ${visible ? "" : "hidden"}>
        <span class="help-article-icon"><i class="${article.icon}" aria-hidden="true"></i></span>
        <span class="help-article-body">
          <strong>${article.title}</strong>
          <span>${article.description}</span>
        </span>
        <i class="ri-arrow-right-s-line help-article-arrow" aria-hidden="true"></i>
      </button>
    `;
    }).join("");
    els.articlesList.innerHTML = html;
}

function renderFaqs() {
    const q = normalize(state.searchQuery);
    const html = FAQ_ITEMS.map((item) => {
        const visible = faqMatches(item, q, state.activeCategoryId);
        const expanded = state.openFaqId === item.id;
        return `
      <div class="help-faq-item" data-faq-id="${item.id}" ${visible ? "" : "hidden"}>
        <button type="button" class="help-faq-trigger"
          aria-expanded="${expanded ? "true" : "false"}"
          aria-controls="faq-panel-${item.id}"
          id="faq-trigger-${item.id}"
          data-faq-id="${item.id}">
          <span>${item.question}</span>
          <i class="ri-arrow-down-s-line" aria-hidden="true"></i>
        </button>
        <div class="help-faq-panel${expanded ? " is-open" : ""}"
          id="faq-panel-${item.id}"
          role="region"
          aria-labelledby="faq-trigger-${item.id}">
          <p>${item.answer}</p>
        </div>
      </div>
    `;
    }).join("");
    els.faqList.innerHTML = html;
}

function updateFilterBanner() {
    if (state.activeCategoryId) {
        const cat = HELP_CATEGORIES.find((c) => c.id === state.activeCategoryId);
        els.filterLabel.textContent = cat ? cat.title : state.activeCategoryId;
        els.filterBanner.hidden = false;
    } else {
        els.filterBanner.hidden = true;
    }
}

function updateSearchClear() {
    const hasQuery = state.searchQuery.length > 0;
    els.searchClear.hidden = !hasQuery;
}

function updateEmptyAndSections() {
    const q = normalize(state.searchQuery);
    const catId = state.activeCategoryId;

    const visibleCategories = HELP_CATEGORIES.filter(
        (c) => categoryMatches(c, q) && (!catId || catId === c.id)
    ).length;
    const visibleArticles = HELP_ARTICLES.filter((a) => articleMatches(a, q, catId)).length;
    const visibleFaqs = FAQ_ITEMS.filter((f) => faqMatches(f, q, catId)).length;

    const searchingOrFiltering = Boolean(q || catId);
    const noResults = searchingOrFiltering && visibleArticles === 0 && visibleFaqs === 0 && visibleCategories === 0;

    els.emptyState.hidden = !noResults;

    // When searching/filtering, keep categories useful only if they still match
    els.categoriesSection.hidden = noResults || (searchingOrFiltering && visibleCategories === 0);
    els.articlesSection.hidden = noResults || visibleArticles === 0;
    els.faqSection.hidden = noResults || visibleFaqs === 0;

    // Hide promotional / contact blocks while searching or filtering to reduce noise
    const hideExtras = searchingOrFiltering;
    els.onboardingSection.hidden = hideExtras || noResults;
    els.contactSection.hidden = hideExtras || noResults;
    els.statusSection.hidden = hideExtras || noResults;
}

function renderAll() {
    renderCategories();
    renderArticles();
    renderFaqs();
    updateFilterBanner();
    updateSearchClear();
    updateEmptyAndSections();
}

/* ==========================================
   Article viewer
========================================== */

function openArticle(articleId) {
    const article = HELP_ARTICLES.find((a) => a.id === articleId);
    if (!article) return;

    els.articleCategory.textContent = article.category;
    els.articleTitle.textContent = article.title;
    els.articleBody.innerHTML = article.content;

    els.centerView.hidden = true;
    els.articleView.hidden = false;

    window.scrollTo({ top: 0, behavior: "smooth" });
    els.articleBack.focus();
}

function closeArticle() {
    els.articleView.hidden = true;
    els.centerView.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ==========================================
   Search / filter
========================================== */

function setSearchQuery(value) {
    state.searchQuery = value;
    if (els.searchInput.value !== value) {
        els.searchInput.value = value;
    }
    renderAll();
}

function clearSearch() {
    setSearchQuery("");
    els.searchInput.focus();
}

function setCategoryFilter(categoryId) {
    state.activeCategoryId = categoryId;
    state.openFaqId = null;
    renderAll();
    els.articlesSection?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearCategoryFilter() {
    state.activeCategoryId = null;
    state.openFaqId = null;
    renderAll();
}

function clearAllFilters() {
    state.activeCategoryId = null;
    state.searchQuery = "";
    state.openFaqId = null;
    if (els.searchInput) els.searchInput.value = "";
    renderAll();
}

/* ==========================================
   FAQ
========================================== */

function toggleFaq(faqId) {
    state.openFaqId = state.openFaqId === faqId ? null : faqId;
    renderFaqs();
}

/* ==========================================
   Modals
========================================== */

function openModal(overlay) {
    if (!overlay) return;
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add("is-open"));
    state.activeModal = overlay;
    document.body.style.overflow = "hidden";
}

function closeModal(overlay) {
    if (!overlay) return;
    overlay.classList.remove("is-open");
    const finish = () => {
        overlay.hidden = true;
        if (state.activeModal === overlay) state.activeModal = null;
        document.body.style.overflow = "";
    };
    overlay.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, 220);
}

function closeActiveModal() {
    if (state.activeModal) closeModal(state.activeModal);
}

function openContactModal() {
    els.contactForm.reset();
    els.contactError.hidden = true;
    [els.contactName, els.contactEmail, els.contactSubject, els.contactMessage].forEach((el) => {
        el.classList.remove("is-invalid");
    });
    openModal(els.contactOverlay);
    setTimeout(() => els.contactName.focus(), 50);
}

function openCommunityModal() {
    openModal(els.communityOverlay);
    setTimeout(() => els.communityGotIt.focus(), 50);
}

function validateContactForm() {
    const name = els.contactName.value.trim();
    const email = els.contactEmail.value.trim();
    const subject = els.contactSubject.value.trim();
    const message = els.contactMessage.value.trim();

    const fields = [
        { el: els.contactName, ok: name.length >= 2 },
        { el: els.contactEmail, ok: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) },
        { el: els.contactSubject, ok: subject.length >= 3 },
        { el: els.contactMessage, ok: message.length >= 10 },
    ];

    let valid = true;
    fields.forEach(({ el, ok }) => {
        el.classList.toggle("is-invalid", !ok);
        if (!ok) valid = false;
    });

    if (!valid) {
        els.contactError.textContent = "Please fill in all fields correctly (message at least 10 characters).";
        els.contactError.hidden = false;
        return false;
    }

    els.contactError.hidden = true;
    return true;
}

function handleContactSubmit(event) {
    event.preventDefault();
    if (!validateContactForm()) return;

    // Frontend-only: no support backend
    closeModal(els.contactOverlay);
    els.contactForm.reset();
    safeToast("Support request submitted successfully.", "success");
}

/* ==========================================
   Events
========================================== */

function bindEvents() {
    // Search
    els.searchInput.addEventListener("input", (e) => {
        setSearchQuery(e.target.value);
    });

    els.searchClear.addEventListener("click", () => clearSearch());
    els.emptyClear.addEventListener("click", () => clearAllFilters());
    els.filterClear.addEventListener("click", () => clearCategoryFilter());

    // Categories (delegation)
    els.categoryGrid.addEventListener("click", (e) => {
        const card = e.target.closest("[data-category-id]");
        if (!card) return;
        const id = card.getAttribute("data-category-id");
        if (state.activeCategoryId === id) {
            clearCategoryFilter();
        } else {
            setCategoryFilter(id);
        }
    });

    // Articles (delegation)
    els.articlesList.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-article-id]");
        if (!btn) return;
        openArticle(btn.getAttribute("data-article-id"));
    });

    // FAQ (delegation)
    els.faqList.addEventListener("click", (e) => {
        const trigger = e.target.closest("[data-faq-id].help-faq-trigger");
        if (!trigger) return;
        toggleFaq(trigger.getAttribute("data-faq-id"));
    });

    // Article back
    els.articleBack.addEventListener("click", () => closeArticle());

    // Getting started
    els.getStartedBtn.addEventListener("click", () => openArticle("getting-started"));
    els.viewGuideBtn.addEventListener("click", () => openArticle("getting-started"));

    // Contact / Community
    els.contactBtn.addEventListener("click", () => openContactModal());
    els.communityBtn.addEventListener("click", () => openCommunityModal());

    els.contactClose.addEventListener("click", () => closeModal(els.contactOverlay));
    els.contactCancel.addEventListener("click", () => closeModal(els.contactOverlay));
    els.contactForm.addEventListener("submit", handleContactSubmit);

    els.communityClose.addEventListener("click", () => closeModal(els.communityOverlay));
    els.communityGotIt.addEventListener("click", () => closeModal(els.communityOverlay));

    // Overlay click
    els.contactOverlay.addEventListener("click", (e) => {
        if (e.target === els.contactOverlay) closeModal(els.contactOverlay);
    });
    els.communityOverlay.addEventListener("click", (e) => {
        if (e.target === els.communityOverlay) closeModal(els.communityOverlay);
    });

    // Escape
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (state.activeModal) {
            e.preventDefault();
            closeActiveModal();
            return;
        }
        if (!els.articleView.hidden) {
            e.preventDefault();
            closeArticle();
        }
    });

    // Help search focus: only if no global handler already owns Cmd/Ctrl+K on this page.
    // We listen in capture phase and stop only when Help is the active page target.
    document.addEventListener(
        "keydown",
        (e) => {
            const isK = e.key === "k" || e.key === "K";
            if (!isK || !(e.metaKey || e.ctrlKey)) return;
            // If focus is already in a contenteditable / Monaco / global search, don’t fight it
            const tag = (document.activeElement && document.activeElement.tagName) || "";
            if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) {
                return;
            }
            // Prefer focusing Help search when on Help page and center view is visible
            if (document.body.dataset.page === "help" && els.centerView && !els.centerView.hidden) {
                e.preventDefault();
                els.searchInput.focus();
                els.searchInput.select();
            }
        },
        true
    );
}

/* ==========================================
   Init
========================================== */

function init() {
    cacheDom();
    if (!els.centerView || !els.searchInput) {
        console.warn("[Help] Required DOM nodes missing.");
        return;
    }
    renderAll();
    bindEvents();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}