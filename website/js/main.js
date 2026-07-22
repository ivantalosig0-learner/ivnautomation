/**
 * KQuality — site behavior
 * Lenis smooth scroll, GSAP scroll storytelling, hero "clean sweep" + dust
 * dissipation (canvas, lazy, mobile/reduced-motion fallback), nav, reveals.
 * All effects degrade gracefully if a CDN library fails to load.
 */

(function () {
  const mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const isMobile = window.matchMedia("(max-width: 760px)").matches;

  document.addEventListener("DOMContentLoaded", () => {
    const reduced = mqReduce.matches;

    /* ---------------- Lenis smooth scroll ---------------- */
    const lenis = null;

    /* ---------------- Navbar ---------------- */
    const navbar = document.querySelector(".navbar");
    const onScroll = () => navbar && navbar.classList.toggle("scrolled", window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const navToggle = document.querySelector(".nav-toggle");
    const navLinks = document.querySelector(".nav-links");
    navToggle?.addEventListener("click", () => {
      const open = navLinks.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", String(open));
    });

    /* ---------------- Anchor scrolling ---------------- */
    /* Sections below use content-visibility:auto with an estimated 800px
       placeholder height (perf optimization) until they're scrolled near.
       scrollIntoView()/getBoundingClientRect() computed BEFORE that content
       renders for real will target the wrong pixel offset -- on mobile,
       right after page load, this made nav links look like they "did
       nothing". Fix: force the real layout to render, refresh GSAP's
       measurements, then measure position on the next frame before scrolling. */
    const cvSections = document.querySelectorAll(
      ".industries, .services, .why, .process, .coverage, .testimonials, .funnel-section, .faq, .human"
    );
    function revealForScroll() {
      cvSections.forEach((el) => { el.style.contentVisibility = "visible"; });
    }

    /* Mobile note: a JS/CSS "smooth" scroll animation can get cut short
       almost immediately by residual touch/gesture state right after a tap
       (a known mobile Safari/Chrome quirk) -- it looked like "scrolls a tiny
       bit and stops". Instant scrollTo() is atomic and isn't subject to
       that interruption, so anchor nav always uses behavior:"auto". A short
       follow-up correction re-measures and re-jumps in case late-loading
       content (images, fonts) shifted the target after the first jump. */
    function jumpTo(target) {
      const top = target.getBoundingClientRect().top + window.scrollY - 72;
      window.scrollTo({ top, behavior: "auto" });
    }

    document.querySelectorAll('a[href^="#"]').forEach((a) => {
      a.addEventListener("click", (e) => {
        const id = a.getAttribute("href");
        if (id.length < 2) return;
        const target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        navLinks?.classList.remove("open");

        revealForScroll();
        if (typeof ScrollTrigger !== "undefined") ScrollTrigger.refresh();

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            jumpTo(target);
            setTimeout(() => {
              if (typeof ScrollTrigger !== "undefined") ScrollTrigger.refresh();
              jumpTo(target);
            }, 350);
          });
        });
      });
    });

    /* ---------------- Progressive reveals ---------------- */
    const reveals = document.querySelectorAll(".reveal");
    if (reduced || !("IntersectionObserver" in window)) {
      reveals.forEach((el) => el.classList.add("is-in"));
    } else {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en, i) => {
          if (en.isIntersecting) {
            en.target.style.transitionDelay = `${Math.min(i * 60, 240)}ms`;
            en.target.classList.add("is-in");
            io.unobserve(en.target);
          }
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
      reveals.forEach((el) => io.observe(el));
    }

    /* ---------------- GSAP: hero clean-sweep + parallax ---------------- */
    const hasGsap = typeof gsap !== "undefined" && typeof ScrollTrigger !== "undefined";
    if (hasGsap && !reduced) {
      gsap.registerPlugin(ScrollTrigger);

      gsap.to(".hero-inner", {
        yPercent: -8, opacity: 0.55, ease: "none",
        scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true }
      });
    }

    /* ---------------- Hero dust canvas (lazy, fallback-safe) ------------ */
    const canvas = document.querySelector(".hero-canvas");
    if (canvas) canvas.remove();

    function initDust(cv) {
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      let w, h, parts = [], scrollFade = 1, running = true;

      function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        w = cv.clientWidth; h = cv.clientHeight;
        cv.width = w * dpr; cv.height = h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      resize();
      window.addEventListener("resize", resize, { passive: true });

      const COUNT = 55;
      for (let i = 0; i < COUNT; i++) {
        parts.push({
          x: Math.random() * 100, y: Math.random() * 100,
          z: 0.3 + Math.random() * 0.7,
          r: 0.6 + Math.random() * 1.8,
          vx: (Math.random() - 0.5) * 0.02,
          vy: -(0.008 + Math.random() * 0.02),
          o: 0.15 + Math.random() * 0.35
        });
      }

      // Dust dissipates as you scroll — the page "gets cleaner".
      window.addEventListener("scroll", () => {
        const hh = document.querySelector(".hero")?.offsetHeight || window.innerHeight;
        scrollFade = Math.max(0, 1 - window.scrollY / (hh * 0.7));
      }, { passive: true });

      function frame() {
        if (!running) return;
        ctx.clearRect(0, 0, w, h);
        if (scrollFade > 0.01) {
          for (const p of parts) {
            p.x += p.vx * p.z; p.y += p.vy * p.z;
            if (p.y < -2) { p.y = 102; p.x = Math.random() * 100; }
            if (p.x < -2) p.x = 102; if (p.x > 102) p.x = -2;
            const px = (p.x / 100) * w, py = (p.y / 100) * h;
            ctx.beginPath();
            ctx.arc(px, py, p.r * p.z * 1.6, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(25, 118, 210, ${p.o * p.z * scrollFade * 0.5})`;
            ctx.fill();
          }
        }
        requestAnimationFrame(frame);
      }
      frame();

      document.addEventListener("visibilitychange", () => {
        running = document.visibilityState === "visible";
        if (running) frame();
      });
    }

    /* ---------------- FAQ: close others on open ---------------- */
    const faqItems = document.querySelectorAll(".faq-item");
    faqItems.forEach((item) => {
      item.addEventListener("toggle", () => {
        if (item.open) faqItems.forEach((o) => { if (o !== item) o.open = false; });
      });
    });
  });
})();

/* ==========================================================================
 * V2 CINEMATIC LAYER
 * Scene 1  — Arrival: particle field, logo materialization, camera push
 * Scenes 2–5 — Photographic transformation: graded wipe, glints, settle
 * Scene 4  — Craft band parallax
 * All scenes degrade to static content on mobile / reduced motion / no GSAP.
 * ======================================================================== */
(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const reduced = false; /* animations always on — owner decision */
    const small = window.matchMedia("(max-width: 760px)").matches;
    const hasGsap = typeof gsap !== "undefined" && typeof ScrollTrigger !== "undefined";
    if (hasGsap) gsap.registerPlugin(ScrollTrigger);

    /* ---------- Scene 1: Arrival particles ---------- */
    const arrival = document.querySelector(".arrival");
    const aCanvas = document.querySelector(".arrival-canvas");
    if (arrival && aCanvas && !reduced) {
      const ctx = aCanvas.getContext("2d");
      let w, h, parts = [], t0 = performance.now(), running = true;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      function resize() {
        w = aCanvas.clientWidth; h = aCanvas.clientHeight;
        aCanvas.width = w * dpr; aCanvas.height = h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      resize();
      window.addEventListener("resize", resize, { passive: true });
      const N = 90;
      for (let i = 0; i < N; i++) {
        const a = Math.random() * Math.PI * 2;
        parts.push({
          a, ar: 0.0006 + Math.random() * 0.0014,
          rad: 90 + Math.random() * Math.min(w, h) * 0.42,
          r: 0.5 + Math.random() * 1.7,
          o: 0.12 + Math.random() * 0.5,
          drift: Math.random() * 100
        });
      }
      let scrollP = 0;
      window.addEventListener("scroll", () => {
        const prev = scrollP;
        scrollP = Math.min(1, window.scrollY / (arrival.offsetHeight * 0.9));
        if (prev >= 0.999 && scrollP < 0.999) requestAnimationFrame(frame);
      }, { passive: true });
      function frame(now) {
        if (!running) return;
        if (scrollP >= 0.999) { return; }
        const t = (now - t0) / 1000;
        const appear = Math.min(1, t / 2.2);
        ctx.clearRect(0, 0, w, h);
        const cx = w / 2, cy = h * 0.42;
        for (const p of parts) {
          p.a += p.ar;
          const spread = 1 + scrollP * 2.6;               // camera flies through
          const rad = p.rad * spread;
          const x = cx + Math.cos(p.a + p.drift) * rad;
          const y = cy + Math.sin(p.a * 0.9 + p.drift) * rad * 0.62;
          const o = p.o * appear * (1 - scrollP * 0.85);
          if (o <= 0.01) continue;
          ctx.beginPath();
          ctx.arc(x, y, p.r * (1 + scrollP * 1.4), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(143, 196, 242, ${o})`;
          ctx.fill();
        }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
      document.addEventListener("visibilitychange", () => {
        running = document.visibilityState === "visible";
        if (running) requestAnimationFrame(frame);
      });

      if (hasGsap) {
        gsap.to(".arrival-inner", {
          scale: 1.35, opacity: 0, ease: "none",
          scrollTrigger: { trigger: arrival, start: "top top", end: "bottom 30%", scrub: 0.6 }
        });
      }
    }

    /* ---------- Scenes 2–5: photographic transformation ---------- */
    const story = document.querySelector(".story");
    if (story) {
      if (reduced || !hasGsap) {
        story.classList.add("story-static");
      } else {
        const scene = story.querySelector(".story-scene");
        const dirty = story.querySelector(".st-dirty");
        const edge = story.querySelector(".st-wipe-edge");
        const glints = story.querySelectorAll(".st-glint");
        const caps = [1, 2, 3].map((n) => story.querySelector(".cap-" + n));

gsap.set(dirty, { opacity: 1 });

        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: story, start: "top top", end: "bottom bottom",
            scrub: 0.6
          },
          defaults: { ease: "none" }
        });

        /* Scene 1 — the tired room, camera drifts in (transform-only) */
        tl.fromTo(scene,
          { rotateX: 8, rotateY: -6, scale: 0.88 },
          { rotateX: 4, rotateY: -2, scale: 0.95, duration: 0.9 }, 0);
        tl.fromTo(caps[0], { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.3 }, 0.05);
        tl.to(caps[0], { opacity: 0, y: -16, duration: 0.25 }, 0.75);

        /* Scene 2 — the wipe + light returns */
        tl.fromTo(caps[1], { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.3 }, 1.0);
        tl.to(edge, { opacity: 1, duration: 0.1 }, 1.0);
        tl.fromTo(edge, { x: 0 }, { x: () => scene.offsetWidth + 240, duration: 1.1 }, 1.05);
        tl.to(dirty, { opacity: 0, duration: 1.1 }, 1.05);
        tl.to(scene, { rotateX: 0, rotateY: 0, scale: 1, duration: 1.1 }, 1.05);
        tl.to(edge, { opacity: 0, duration: 0.15 }, 2.1);
        glints.forEach((g, idx) => {
          tl.fromTo(g, { opacity: 0, scale: 0.3 },
            { opacity: 1, scale: 1, duration: 0.25 }, 2.05 + idx * 0.1);
        });
        /* Scene 3 — spotless, guaranteed (new beat) */
        tl.to(caps[1], { opacity: 0, y: -16, duration: 0.25 }, 2.5);
        tl.fromTo(caps[2], { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.3 }, 2.7);
        tl.to(caps[2], { opacity: 0, y: -16, duration: 0.25 }, 3.4);
        tl.to({}, { duration: 0.4 });
      }
    }

    /* ---------- Scene 3.5: real results reveal ---------- */
    if (hasGsap && !reduced) {
      const resultsSection = document.querySelector(".results");
      if (resultsSection) {
        const head = resultsSection.querySelectorAll(".section-head > *");
        gsap.fromTo(head, { opacity: 0, y: 22 }, {
          opacity: 1, y: 0, duration: 0.7, ease: "power2.out", stagger: 0.08,
          scrollTrigger: { trigger: resultsSection, start: "top 78%" }
        });

        const cards = resultsSection.querySelectorAll(".result-card");
        gsap.fromTo(cards, { opacity: 0, y: 46, scale: 0.96 }, {
          opacity: 1, y: 0, scale: 1, duration: 0.8, ease: "power3.out", stagger: 0.14,
          scrollTrigger: { trigger: ".results-grid", start: "top 85%" }
        });

        cards.forEach((card) => {
          const ba = card.querySelector(".ba");
          if (!ba || !ba.classList.contains("ba--compare")) return;
          gsap.fromTo(ba, { "--pos": "18%" }, {
            "--pos": "62%", ease: "none",
            scrollTrigger: { trigger: card, start: "top 80%", end: "top 30%", scrub: 0.5 }
          });
        });
      }
    }

    /* ---------- Scene 4: craft band parallax ---------- */
    if (hasGsap && !reduced) {
      document.querySelectorAll(".craft-item").forEach((item) => {
        const depth = parseFloat(item.getAttribute("data-depth") || "0.15");
        gsap.fromTo(item, { y: depth * 160 }, {
          y: depth * -160, ease: "none",
          scrollTrigger: { trigger: ".craft-band", start: "top bottom", end: "bottom top", scrub: 0.6 }
        });
      });
    }
  });
})();

/* ==========================================================================
 * V2.1 — Scenes 6, 10: commercial parallax, floating cards
 * ======================================================================== */
(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const reduced = false; /* animations always on — owner decision */
    const hasGsap = typeof gsap !== "undefined" && typeof ScrollTrigger !== "undefined";
    if (!hasGsap || reduced) return;
    gsap.registerPlugin(ScrollTrigger);

    /* Scene 6: slow background drift */
    const commBg = document.querySelector(".comm-bg img");
    if (commBg) {
      gsap.fromTo(commBg, { yPercent: -8 }, {
        yPercent: 8, ease: "none",
        scrollTrigger: { trigger: ".commercial", start: "top bottom", end: "bottom top", scrub: 0.6 }
      });
    }

    /* Scene 10: gentle float on testimonial cards */
    document.querySelectorAll(".t-card").forEach((card, i) => {
      gsap.to(card, {
        y: i % 2 === 0 ? -10 : 10,
        duration: 3.2 + i * 0.4,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
        delay: i * 0.35
      });
    });
  });
})();

/* ==========================================================================
 * Reliability fix: content-visibility:auto sections (.industries, .services,
 * .why, .process, .coverage, .testimonials, .funnel-section, .faq, .human)
 * render with an estimated 800px placeholder height until they're scrolled
 * near, which can desync any ScrollTrigger positioned below them from its
 * true pixel position. Refresh once everything (incl. images/fonts) has
 * settled, and again as the user scrolls, so trigger start/end stay accurate.
 * ======================================================================== */
(function () {
  if (typeof ScrollTrigger === "undefined") return;
  window.addEventListener("load", () => ScrollTrigger.refresh());
  let refreshed = false;
  window.addEventListener("scroll", () => {
    if (refreshed) return;
    refreshed = true;
    requestAnimationFrame(() => ScrollTrigger.refresh());
    setTimeout(() => { refreshed = false; }, 400);
  }, { passive: true });
})();

/* ==========================================================================
 * REAL RESULTS — before/after comparison slider
 * Drag / touch / click / keyboard. Falls back to a single "after" image
 * when a card has no before photo yet (empty .ba-before src).
 * ======================================================================== */
(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const cards = document.querySelectorAll(".results .ba");
    if (!cards.length) return;

    cards.forEach((ba) => {
      const before = ba.querySelector(".ba-before");
      const divider = ba.querySelector(".ba-divider");
      const hasBefore = before && before.getAttribute("src") && before.getAttribute("src").trim() !== "";

      if (!hasBefore) { ba.classList.add("ba--single"); return; }
      ba.classList.add("ba--compare");

      const setPos = (pct) => {
        pct = Math.max(0, Math.min(100, pct));
        ba.style.setProperty("--pos", pct + "%");
        if (divider) divider.setAttribute("aria-valuenow", Math.round(pct));
      };

      const posFromEvent = (clientX) => {
        const r = ba.getBoundingClientRect();
        return ((clientX - r.left) / r.width) * 100;
      };

      let dragging = false;
      const start = (e) => { dragging = true; ba.classList.add("is-dragging"); move(e); };
      const end = () => { dragging = false; ba.classList.remove("is-dragging"); };
      const move = (e) => {
        if (!dragging) return;
        const x = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
        if (x == null) return;
        setPos(posFromEvent(x));
        if (e.cancelable) e.preventDefault();
      };

      ba.addEventListener("mousedown", start);
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", end);
      ba.addEventListener("touchstart", start, { passive: true });
      window.addEventListener("touchmove", move, { passive: false });
      window.addEventListener("touchend", end);

      if (divider) {
        divider.addEventListener("keydown", (e) => {
          const cur = parseFloat(ba.style.getPropertyValue("--pos")) || 50;
          if (e.key === "ArrowLeft") { setPos(cur - 4); e.preventDefault(); }
          else if (e.key === "ArrowRight") { setPos(cur + 4); e.preventDefault(); }
          else if (e.key === "Home") { setPos(0); e.preventDefault(); }
          else if (e.key === "End") { setPos(100); e.preventDefault(); }
        });
      }

      /* One-time reveal hint: sweep the divider so users notice it's draggable */
      let hinted = false;
      const hint = () => {
        if (hinted) return; hinted = true;
        const seq = [62, 40, 50]; let i = 0;
        const step = () => { if (i < seq.length) { setPos(seq[i++]); setTimeout(step, 380); } };
        setTimeout(step, 250);
      };
      if ("IntersectionObserver" in window) {
        const io = new IntersectionObserver((entries) => {
          entries.forEach((en) => { if (en.isIntersecting) { hint(); io.disconnect(); } });
        }, { threshold: 0.4 });
        io.observe(ba);
      } else { hint(); }

      setPos(50);
    });
  });
})();
