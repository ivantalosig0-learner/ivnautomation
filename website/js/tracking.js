(function () {
  function loadScript(src, attrs = {}) {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    Object.entries(attrs).forEach(([k, v]) => s.setAttribute(k, v));
    document.head.appendChild(s);
    return s;
  }

  function initGA4(id) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      dataLayer.push(arguments);
    };
    gtag("js", new Date());
    gtag("config", id);
    loadScript(`https://www.googletagmanager.com/gtag/js?id=${id}`);
  }

  function initGTM(id) {
    (function (w, d, s, l, i) {
      w[l] = w[l] || [];
      w[l].push({ "gtm.start": new Date().getTime(), event: "gtm.js" });
      const f = d.getElementsByTagName(s)[0];
      const j = d.createElement(s);
      const dl = l !== "dataLayer" ? "&l=" + l : "";
      j.async = true;
      j.src = "https://www.googletagmanager.com/gtm.js?id=" + i + dl;
      f.parentNode.insertBefore(j, f);
    })(window, document, "script", "dataLayer", id);
  }

  function initPixel(id) {
    !(function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = !0;
      n.version = "2.0";
      n.queue = [];
      t = b.createElement(e);
      t.async = !0;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    fbq("init", id);
    fbq("track", "PageView");
  }

  function captureUTM() {
    const params = new URLSearchParams(window.location.search);
    const utmKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
    const utm = {};
    let hasUTM = false;
    utmKeys.forEach((k) => {
      const v = params.get(k);
      if (v) {
        utm[k] = v;
        hasUTM = true;
      }
    });
    if (hasUTM) {
      try {
        sessionStorage.setItem("kq_utm", JSON.stringify(utm));
      } catch (_) {}
    }
  }

  function wireCtaTracking() {
    document.querySelectorAll("[data-cta]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const label = btn.getAttribute("data-cta");
        window.dataLayer?.push({ event: "cta_click", cta_label: label });
        if (typeof gtag === "function") gtag("event", "cta_click", { cta_label: label });
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    const cfg = window.CONFIG || {};
    captureUTM();
    wireCtaTracking();

    if (cfg.GA4_MEASUREMENT_ID) initGA4(cfg.GA4_MEASUREMENT_ID);
    if (cfg.GTM_CONTAINER_ID) initGTM(cfg.GTM_CONTAINER_ID);
    if (cfg.FACEBOOK_PIXEL_ID) initPixel(cfg.FACEBOOK_PIXEL_ID);
  });
})();
