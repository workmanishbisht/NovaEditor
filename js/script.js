"use strict";

(() => {
  /* ---------------------------------------------------------
     1. UTILITIES
  --------------------------------------------------------- */
  const Utils = {
    throttle(fn, wait) {
      let last = 0;
      let timeout = null;
      return (...args) => {
        const now = Date.now();
        const remaining = wait - (now - last);
        if (remaining <= 0) {
          clearTimeout(timeout);
          timeout = null;
          last = now;
          fn(...args);
        } else if (!timeout) {
          timeout = setTimeout(() => {
            last = Date.now();
            timeout = null;
            fn(...args);
          }, remaining);
        }
      };
    },

    debounce(fn, wait) {
      let timeout = null;
      return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), wait);
      };
    },

    prefersReducedMotion() {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    },

    isDesktopPointer() {
      return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    },

    clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    },

    easeOutQuad(t) {
      return t * (2 - t);
    },
  };

  /* ---------------------------------------------------------
     2. RUNTIME STYLE INJECTION
  --------------------------------------------------------- */
  const injectRuntimeStyles = () => {
    if (document.getElementById("js-runtime-styles")) return;

    const css = `
      .header.scrolled {
        box-shadow: 0 4px 20px rgba(15, 23, 42, 0.08);
      }

      .mobile-menu {
        display: flex !important;
        overflow: hidden;
        max-height: 0;
        opacity: 0;
        pointer-events: none;
        transition: max-height 0.4s ease, opacity 0.3s ease;
      }
      .mobile-menu.is-open {
        opacity: 1;
        pointer-events: auto;
      }

      .menu-toggle .menu-icon,
      .menu-toggle .close-icon {
        transition: transform 0.25s ease, opacity 0.25s ease;
      }

      .faq-answer {
        overflow: hidden;
        max-height: 0;
        transition: max-height 0.35s ease;
      }
      .faq-question i {
        transition: transform 0.3s ease;
      }
      .faq-item.active .faq-question i {
        transform: rotate(45deg);
      }

      .js-reveal {
        opacity: 0;
        will-change: transform, opacity;
        transition: opacity 0.7s ease, transform 0.7s ease;
      }
      .js-reveal.fade-up { transform: translateY(40px); }
      .js-reveal.fade-left { transform: translateX(-40px); }
      .js-reveal.fade-right { transform: translateX(40px); }
      .js-reveal.zoom-in { transform: scale(0.92); }
      .js-reveal.is-visible {
        opacity: 1;
        transform: translate(0, 0) scale(1);
      }

      .btn-primary,
      .btn-secondary {
        position: relative;
        overflow: hidden;
      }
      .js-ripple {
        position: absolute;
        border-radius: 50%;
        transform: scale(0);
        pointer-events: none;
        animation: js-ripple-anim 600ms ease-out;
      }
      @keyframes js-ripple-anim {
        to {
          transform: scale(1);
          opacity: 0;
        }
      }

      .hero-image img,
      .editor-preview-image img {
        transition: transform 0.2s ease-out;
      }

      .js-back-to-top {
        position: fixed;
        right: 24px;
        bottom: 24px;
        width: 48px;
        height: 48px;
        border: none;
        border-radius: 50%;
        background: var(--primary);
        color: #fff;
        font-size: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: 0 8px 20px rgba(37, 99, 235, 0.3);
        opacity: 0;
        visibility: hidden;
        transform: translateY(16px);
        transition: opacity 0.3s ease, transform 0.3s ease, visibility 0.3s;
        z-index: 999;
      }
      .js-back-to-top.is-visible {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }

      @media (max-width: 576px) {
        .js-back-to-top {
          right: 16px;
          bottom: 16px;
          width: 42px;
          height: 42px;
          font-size: 18px;
        }
      }
    `;

    const style = document.createElement("style");
    style.id = "js-runtime-styles";
    style.textContent = css;
    document.head.appendChild(style);
  };

  /* ---------------------------------------------------------
     3. DOM ELEMENTS
  --------------------------------------------------------- */
  const DOM = {
    header: document.querySelector(".header"),
    menuToggle: document.querySelector(".menu-toggle"),
    menuIcon: document.querySelector(".menu-toggle .menu-icon"),
    closeIcon: document.querySelector(".menu-toggle .close-icon"),
    mobileMenu: document.querySelector(".mobile-menu"),
    mobileMenuLinks: document.querySelectorAll(".mobile-menu a"),
    navLinks: document.querySelectorAll(".nav-link"),
    allAnchorLinks: document.querySelectorAll('a[href^="#"]'),
    sections: document.querySelectorAll("main section[id], footer[id]"),
    faqItems: document.querySelectorAll(".faq-item"),
    rippleTargets: document.querySelectorAll(".btn-primary, .btn-secondary"),
    heroImage: document.querySelector(".hero-image"),
    editorPreviewImage: document.querySelector(".editor-preview-image"),
    body: document.body,
  };

  /* ---------------------------------------------------------
     4. STATE
  --------------------------------------------------------- */
  const State = {
    isMenuOpen: false,
    activeSectionId: null,
  };

  /* ---------------------------------------------------------
     5. HEADER — sticky scroll shadow
  --------------------------------------------------------- */
  const Header = {
    init() {
      if (!DOM.header) return;
      window.addEventListener(
        "scroll",
        Utils.throttle(() => this.onScroll(), 100),
        {
          passive: true,
        },
      );
      this.onScroll();
    },

    onScroll() {
      const scrolled = window.scrollY > 10;
      DOM.header.classList.toggle("scrolled", scrolled);
    },
  };

  /* ---------------------------------------------------------
     6. MOBILE NAVIGATION
  --------------------------------------------------------- */
  const MobileNav = {
    init() {
      if (!DOM.menuToggle || !DOM.mobileMenu) return;

      if (!DOM.mobileMenu.id) {
        DOM.mobileMenu.id = "mobile-menu";
      }
      DOM.menuToggle.setAttribute("aria-controls", DOM.mobileMenu.id);
      DOM.menuToggle.setAttribute("aria-expanded", "false");

      DOM.menuToggle.addEventListener("click", () => this.toggle());

      DOM.mobileMenuLinks.forEach((link) => {
        link.addEventListener("click", () => this.close());
      });

      document.addEventListener("click", (e) => this.handleOutsideClick(e));
      document.addEventListener("keydown", (e) => this.handleKeydown(e));

      window.addEventListener(
        "resize",
        Utils.debounce(() => {
          if (window.innerWidth > 992 && State.isMenuOpen) this.close();
        }, 150),
      );
    },

    toggle() {
      State.isMenuOpen ? this.close() : this.open();
    },

    open() {
      State.isMenuOpen = true;
      DOM.mobileMenu.classList.add("is-open");
      DOM.mobileMenu.style.maxHeight = `${DOM.mobileMenu.scrollHeight}px`;
      DOM.menuToggle.setAttribute("aria-expanded", "true");
      DOM.body.style.overflow = "hidden";

      if (DOM.menuIcon && DOM.closeIcon) {
        DOM.menuIcon.style.display = "none";
        DOM.closeIcon.style.display = "flex";
      }
    },

    close() {
      if (!State.isMenuOpen) return;
      State.isMenuOpen = false;
      DOM.mobileMenu.classList.remove("is-open");
      DOM.mobileMenu.style.maxHeight = "0px";
      DOM.menuToggle.setAttribute("aria-expanded", "false");
      DOM.body.style.overflow = "";

      if (DOM.menuIcon && DOM.closeIcon) {
        DOM.menuIcon.style.display = "";
        DOM.closeIcon.style.display = "none";
      }
    },

    handleOutsideClick(e) {
      if (!State.isMenuOpen) return;
      const clickedInsideMenu = DOM.mobileMenu.contains(e.target);
      const clickedToggle = DOM.menuToggle.contains(e.target);
      if (!clickedInsideMenu && !clickedToggle) this.close();
    },

    handleKeydown(e) {
      if (e.key === "Escape" && State.isMenuOpen) this.close();
    },
  };

  /* ---------------------------------------------------------
     7. SMOOTH SCROLL
  --------------------------------------------------------- */
  const SmoothScroll = {
    init() {
      DOM.allAnchorLinks.forEach((link) => {
        link.addEventListener("click", (e) => this.handleClick(e, link));
      });
    },

    handleClick(e, link) {
      const href = link.getAttribute("href");
      if (!href || href === "#" || href.length < 2) return;

      const target = document.querySelector(href);
      if (!target) return;

      e.preventDefault();

      const headerHeight = DOM.header ? DOM.header.offsetHeight : 0;
      const targetTop =
        target.getBoundingClientRect().top +
        window.pageYOffset -
        headerHeight -
        12;

      window.scrollTo({
        top: targetTop,
        behavior: Utils.prefersReducedMotion() ? "auto" : "smooth",
      });

      if (State.isMenuOpen) MobileNav.close();
    },
  };

  /* ---------------------------------------------------------
     8. ACTIVE NAVIGATION
  --------------------------------------------------------- */
  const ActiveNav = {
    observer: null,

    init() {
      if (
        !DOM.sections.length ||
        !DOM.navLinks.length ||
        !("IntersectionObserver" in window)
      ) {
        return;
      }

      this.createObserver();

      window.addEventListener(
        "resize",
        Utils.debounce(() => this.createObserver(), 300),
      );
    },

    createObserver() {
      if (this.observer) this.observer.disconnect();

      const headerHeight = DOM.header ? DOM.header.offsetHeight : 0;

      this.observer = new IntersectionObserver(
        (entries) => this.handleIntersect(entries),
        {
          rootMargin: `-${headerHeight + 20}px 0px -60% 0px`,
          threshold: 0,
        },
      );

      DOM.sections.forEach((section) => this.observer.observe(section));
    },

    handleIntersect(entries) {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          this.setActive(entry.target.id);
        }
      });
    },

    setActive(id) {
      if (!id || id === State.activeSectionId) return;
      State.activeSectionId = id;

      DOM.navLinks.forEach((link) => {
        const linkId = (link.getAttribute("href") || "").replace("#", "");
        link.classList.toggle("active", linkId === id);
      });
    },
  };

  /* ---------------------------------------------------------
     9. SCROLL REVEAL
  --------------------------------------------------------- */
  const ScrollReveal = {
    observer: null,

    config: [
      { selector: ".hero-left", animation: "fade-up" },
      { selector: ".hero-right", animation: "zoom-in" },
      { selector: ".companies .section-heading", animation: "fade-up" },
      {
        selector: ".companies-grid .company-item",
        animation: "fade-up",
        stagger: true,
      },
      { selector: ".features .section-title", animation: "fade-up" },
      {
        selector: ".features-grid .feature-card",
        animation: "fade-up",
        stagger: true,
      },
      { selector: ".templates .section-title", animation: "fade-up" },
      {
        selector: ".templates-grid .template-card",
        animation: "fade-up",
        stagger: true,
      },
      { selector: ".ai-image", animation: "fade-right" },
      { selector: ".ai-details", animation: "fade-left" },
      { selector: ".why-editor .section-title", animation: "fade-up" },
      {
        selector: ".editor-grid .editor-card",
        animation: "fade-up",
        stagger: true,
      },
      { selector: ".editor-preview .section-title", animation: "fade-up" },
      { selector: ".editor-preview-image", animation: "zoom-in" },
      { selector: ".faq .section-title", animation: "fade-up" },
      { selector: ".faq-list .faq-item", animation: "fade-up", stagger: true },
      { selector: ".footer-info", animation: "fade-up" },
      { selector: ".footer-links", animation: "fade-up" },
    ],

    init() {
      if (Utils.prefersReducedMotion() || !("IntersectionObserver" in window)) {
        return;
      }

      this.observer = new IntersectionObserver(
        (entries) => this.handleIntersect(entries),
        { threshold: 0.15, rootMargin: "0px 0px -60px 0px" },
      );

      this.config.forEach(({ selector, animation, stagger }) => {
        const elements = document.querySelectorAll(selector);
        elements.forEach((el, index) => {
          el.classList.add("js-reveal", animation);
          if (stagger) {
            el.style.transitionDelay = `${index * 90}ms`;
          }
          this.observer.observe(el);
        });
      });
    },

    handleIntersect(entries) {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          this.observer.unobserve(entry.target);
        }
      });
    },
  };

  /* ---------------------------------------------------------
     10. COUNTER ANIMATION (reusable — for counters added later)
     Usage: <span data-counter-target="500" data-counter-duration="1500">0</span>
  --------------------------------------------------------- */
  const Counter = {
    observer: null,

    init() {
      const counters = document.querySelectorAll("[data-counter-target]");
      if (!counters.length || !("IntersectionObserver" in window)) return;

      this.observer = new IntersectionObserver(
        (entries) => this.handleIntersect(entries),
        { threshold: 0.4 },
      );

      counters.forEach((counter) => this.observer.observe(counter));
    },

    handleIntersect(entries) {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          this.animate(entry.target);
          this.observer.unobserve(entry.target);
        }
      });
    },

    animate(el) {
      const target = parseFloat(el.getAttribute("data-counter-target")) || 0;
      const duration =
        parseInt(el.getAttribute("data-counter-duration"), 10) || 1500;
      const start = performance.now();

      const step = (now) => {
        const elapsed = now - start;
        const progress = Utils.clamp(elapsed / duration, 0, 1);
        const eased = Utils.easeOutQuad(progress);
        el.textContent = Math.round(eased * target).toLocaleString();

        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          el.textContent = target.toLocaleString();
        }
      };

      requestAnimationFrame(step);
    },
  };

  /* ---------------------------------------------------------
     11. BUTTON RIPPLE EFFECT
  --------------------------------------------------------- */
  const Ripple = {
    init() {
      DOM.rippleTargets.forEach((btn) => {
        btn.addEventListener("click", (e) => this.create(e, btn));
      });
    },

    create(e, btn) {
      const existing = btn.querySelector(".js-ripple");
      if (existing) existing.remove();

      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 2;
      const x = e.clientX - rect.left - size / 2;
      const y = e.clientY - rect.top - size / 2;
      const isPrimary = btn.classList.contains("btn-primary");

      const ripple = document.createElement("span");
      ripple.className = "js-ripple";
      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      ripple.style.background = isPrimary
        ? "rgba(255, 255, 255, 0.5)"
        : "rgba(37, 99, 235, 0.15)";

      btn.appendChild(ripple);
      ripple.addEventListener("animationend", () => ripple.remove());
    },
  };

  /* ---------------------------------------------------------
     12. IMAGE HOVER TILT (desktop only, subtle)
  --------------------------------------------------------- */
  const ImageTilt = {
    init() {
      if (!Utils.isDesktopPointer()) return;

      [DOM.heroImage, DOM.editorPreviewImage].forEach((wrapper) => {
        if (wrapper) this.bind(wrapper);
      });
    },

    bind(wrapper) {
      const img = wrapper.querySelector("img");
      if (!img) return;

      const maxTilt = 4;
      const maxShift = 6;

      const onMove = Utils.throttle((e) => {
        const rect = wrapper.getBoundingClientRect();
        const relX = (e.clientX - rect.left) / rect.width - 0.5;
        const relY = (e.clientY - rect.top) / rect.height - 0.5;

        const rotateX = (-relY * maxTilt).toFixed(2);
        const rotateY = (relX * maxTilt).toFixed(2);
        const shiftX = (relX * maxShift).toFixed(2);
        const shiftY = (relY * maxShift).toFixed(2);

        img.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translate(${shiftX}px, ${shiftY}px)`;
      }, 16);

      const onLeave = () => {
        img.style.transform =
          "perspective(800px) rotateX(0deg) rotateY(0deg) translate(0, 0)";
      };

      wrapper.addEventListener("mousemove", onMove, { passive: true });
      wrapper.addEventListener("mouseleave", onLeave, { passive: true });
    },
  };

  /* ---------------------------------------------------------
     13. FAQ ACCORDION
  --------------------------------------------------------- */
  const FAQAccordion = {
    init() {
      if (!DOM.faqItems.length) return;

      DOM.faqItems.forEach((item) => {
        const question = item.querySelector(".faq-question");
        const answer = item.querySelector(".faq-answer");
        if (!question || !answer) return;

        question.setAttribute("aria-expanded", "false");
        answer.style.maxHeight = "0px";

        question.addEventListener("click", () => this.toggle(item));
      });
    },

    toggle(item) {
      const isActive = item.classList.contains("active");

      DOM.faqItems.forEach((otherItem) => {
        if (otherItem !== item) this.close(otherItem);
      });

      isActive ? this.close(item) : this.open(item);
    },

    open(item) {
      const question = item.querySelector(".faq-question");
      const answer = item.querySelector(".faq-answer");
      if (!question || !answer) return;

      item.classList.add("active");
      question.setAttribute("aria-expanded", "true");
      answer.style.maxHeight = `${answer.scrollHeight}px`;
    },

    close(item) {
      const question = item.querySelector(".faq-question");
      const answer = item.querySelector(".faq-answer");
      if (!question || !answer) return;

      item.classList.remove("active");
      question.setAttribute("aria-expanded", "false");
      answer.style.maxHeight = "0px";
    },
  };

  /* ---------------------------------------------------------
     14. BACK TO TOP BUTTON
  --------------------------------------------------------- */
  const BackToTop = {
    button: null,

    init() {
      this.button = document.createElement("button");
      this.button.className = "js-back-to-top";
      this.button.type = "button";
      this.button.setAttribute("aria-label", "Back to top");
      this.button.innerHTML = '<i class="ri-arrow-up-line"></i>';

      document.body.appendChild(this.button);

      this.button.addEventListener("click", () => this.scrollToTop());
      window.addEventListener(
        "scroll",
        Utils.throttle(() => this.onScroll(), 150),
        {
          passive: true,
        },
      );
    },

    onScroll() {
      const visible = window.scrollY > 500;
      this.button.classList.toggle("is-visible", visible);
    },

    scrollToTop() {
      window.scrollTo({
        top: 0,
        behavior: Utils.prefersReducedMotion() ? "auto" : "smooth",
      });
    },
  };

  /* ---------------------------------------------------------
     15. INITIALIZATION
  --------------------------------------------------------- */
  const App = {
    init() {
      injectRuntimeStyles();
      Header.init();
      MobileNav.init();
      SmoothScroll.init();
      ActiveNav.init();
      ScrollReveal.init();
      Counter.init();
      Ripple.init();
      ImageTilt.init();
      FAQAccordion.init();
      BackToTop.init();
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => App.init());
  } else {
    App.init();
  }
})();
