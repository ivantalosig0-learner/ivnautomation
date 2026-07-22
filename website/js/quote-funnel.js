(function () {
  const state = {
    step: 0,
    name: "",
    phone: "",
    email: "",
    cleaningType: "",
    propertyType: "",
    bedrooms: 2,
    bathrooms: 1,
    propertySizeSqm: 100,
    preferredDate: "",
    extras: [],
    notes: "",
  };

  const STEP_COUNT = 8;

  const BASE_RATES = {
    Residential: 45,
    Commercial: 55,
    Office: 50,
    "End of Lease": 60,
    Builders: 70,
  };

  function estimateQuote() {
    const base = BASE_RATES[state.cleaningType] || 50;
    const roomFactor = (state.bedrooms * 0.6 + state.bathrooms * 0.4) * 15;
    const sizeFactor = (state.propertySizeSqm || 100) * 0.35;
    const extrasFactor = state.extras.length * 25;
    const total = base + roomFactor + sizeFactor + extrasFactor;
    return Math.max(89, Math.round(total / 5) * 5);
  }

  function getUTMParams() {
    const params = new URLSearchParams(window.location.search);
    return {
      source: params.get("utm_source") || "",
      medium: params.get("utm_medium") || "",
      campaign: params.get("utm_campaign") || "",
      term: params.get("utm_term") || "",
      content: params.get("utm_content") || "",
    };
  }

  function init() {
    const root = document.querySelector("[data-quote-funnel]");
    if (!root) return;

    const steps = [...root.querySelectorAll(".funnel-step")];
    const progressBars = root.querySelectorAll(".funnel-progress .bar span");
    const successPanel = root.querySelector(".funnel-success");

    function render() {
      steps.forEach((s, i) => s.classList.toggle("active", i === state.step));
      progressBars.forEach((bar, i) => {
        bar.style.width = i <= state.step ? "100%" : "0%";
      });
      updatePreview();
      updateReview();
    }

    function updatePreview() {
      const preview = root.querySelector("[data-quote-preview]");
      if (!preview) return;
      if (state.cleaningType) {
        preview.textContent = `Estimated quote: $${estimateQuote()} AUD (final quote confirmed after review)`;
        preview.style.display = "block";
      } else {
        preview.style.display = "none";
      }
    }

    function updateReview() {
      const map = {
        "review-name": state.name || "—",
        "review-contact": [state.phone, state.email].filter(Boolean).join(" · ") || "—",
        "review-type": state.cleaningType || "—",
        "review-property": state.propertyType || "—",
        "review-rooms": `${state.bedrooms} bed · ${state.bathrooms} bath · ${state.propertySizeSqm} m²`,
        "review-date": state.preferredDate || "Flexible",
        "review-extras": state.extras.length ? state.extras.join(", ") : "None",
        "review-quote": state.cleaningType ? `$${estimateQuote()} AUD (estimate)` : "—",
      };
      Object.entries(map).forEach(([key, val]) => {
        const el = root.querySelector(`[data-${key}]`);
        if (el) el.textContent = val;
      });
    }

    root.querySelectorAll("[data-field]").forEach((card) => {
      card.addEventListener("click", () => {
        const field = card.getAttribute("data-field");
        const value = card.getAttribute("data-value");
        const group = card.closest("[data-option-group]");
        group?.querySelectorAll(".option-card").forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
        state[field] = value;
        updatePreview();
      });
    });

    root.querySelectorAll("[data-extra]").forEach((card) => {
      card.addEventListener("click", () => {
        const value = card.getAttribute("data-extra");
        card.classList.toggle("selected");
        if (state.extras.includes(value)) {
          state.extras = state.extras.filter((e) => e !== value);
        } else {
          state.extras.push(value);
        }
        updatePreview();
      });
    });

    root.querySelectorAll("[data-stepper]").forEach((stepper) => {
      const field = stepper.getAttribute("data-stepper");
      const display = stepper.querySelector("span");
      const stepAmount = parseFloat(stepper.getAttribute("data-step-amount") || "1");
      const min = parseFloat(stepper.getAttribute("data-min") || "0");
      stepper.querySelector("[data-minus]").addEventListener("click", () => {
        state[field] = Math.max(min, state[field] - stepAmount);
        display.textContent = state[field];
        updatePreview();
      });
      stepper.querySelector("[data-plus]").addEventListener("click", () => {
        state[field] = state[field] + stepAmount;
        display.textContent = state[field];
        updatePreview();
      });
    });

    root.querySelectorAll("[data-bind]").forEach((input) => {
      const field = input.getAttribute("data-bind");
      input.addEventListener("input", () => {
        state[field] = input.value;
      });
    });

    root.querySelectorAll("[data-next]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!validateStep(state.step)) return;
        state.step = Math.min(state.step + 1, STEP_COUNT - 1);
        render();
        trackEvent("quote_funnel_step", { step: state.step });
      });
    });
    root.querySelectorAll("[data-back]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.step = Math.max(state.step - 1, 0);
        render();
      });
    });

    function validateStep(stepIndex) {
      const el = steps[stepIndex];
      const requiredInputs = el.querySelectorAll("[required]");
      for (const input of requiredInputs) {
        if (!input.value) {
          input.focus();
          input.reportValidity?.();
          return false;
        }
      }
      const requiredField = el.getAttribute("data-required-field");
      if (requiredField && !state[requiredField]) {
        return false;
      }
      return true;
    }

    const submitBtn = root.querySelector("[data-submit]");
    submitBtn?.addEventListener("click", async () => {
      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting…";

      const payload = {
        source: "website_quote_funnel",
        submittedAt: new Date().toISOString(),
        utm: getUTMParams(),
        lead: {
          name: state.name,
          phone: state.phone,
          email: state.email,
          cleaningType: state.cleaningType,
          propertyType: state.propertyType,
          bedrooms: state.bedrooms,
          bathrooms: state.bathrooms,
          propertySizeSqm: state.propertySizeSqm,
          preferredDate: state.preferredDate,
          extras: state.extras,
          notes: state.notes,
        },
        estimatedQuoteAud: estimateQuote(),
      };

      try {
        const webhookUrl = window.CONFIG?.WEBHOOK_URL;
        if (webhookUrl) {
          await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        } else {
          console.info("[KQuality] Demo mode — quote payload:", payload);
          await new Promise((r) => setTimeout(r, 700));
        }
        clearAbandonedQuote();
        trackEvent("quote_funnel_submit", { estimated: payload.estimatedQuoteAud });
        showSuccess();
      } catch (err) {
        console.error("[KQuality] Quote submission failed:", err);
        submitBtn.disabled = false;
        submitBtn.textContent = "Get My Free Quote";
        alert("Something went wrong sending your request. Please call us directly or try again.");
      }
    });

    function showSuccess() {
      steps.forEach((s) => s.classList.remove("active"));
      if (successPanel) successPanel.classList.add("active");
    }

    function persistAbandoned() {
      try {
        sessionStorage.setItem("kq_quote_progress", JSON.stringify({ state, savedAt: Date.now() }));
      } catch (_) {}
    }
    function clearAbandonedQuote() {
      try {
        sessionStorage.removeItem("kq_quote_progress");
      } catch (_) {}
    }
    window.addEventListener("beforeunload", persistAbandoned);

    render();
  }

  function trackEvent(name, params) {
    if (typeof gtag === "function") gtag("event", name, params);
    if (typeof fbq === "function") fbq("trackCustom", name, params);
    window.dataLayer?.push({ event: name, ...params });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
