/**
 * KQuality — Chat Assistant (frontend)
 * Free-form adaptive chat backed by the "Website Chat Assistant" n8n workflow,
 * which calls the self-hosted Qwen3-8B model. No more fixed script — every
 * reply is generated from the visitor's actual message + conversation history.
 * If the model is busy/slow, the backend returns a graceful fallback message
 * within ~13s instead of hanging.
 *
 * Lead capture: best-effort. If the visitor's message contains an email or
 * phone number, the transcript is also posted to window.CONFIG.WEBHOOK_URL
 * (same "Website Quote Intake" pipeline the quote funnel uses) so the team
 * doesn't lose a lead just because it came through chat instead of the form.
 */

(function () {
  const GREETING =
    "Hi there 👋 I'm the KQuality assistant. Ask me about our cleaning services, the areas we cover, or how quoting works — and if you're after a job or already a client, I'll point you to the right person.";

  const FETCH_TIMEOUT_MS = 16000; // gives the backend's own 13s budget some headroom
  const MAX_HISTORY = 8;

  const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
  const PHONE_RE = /(\+?\d[\d\s()-]{7,}\d)/;

  let history = []; // [{role:'user'|'assistant', content:string}]
  let leadSent = false;
  let lastIntent = ""; // intent of the most recent backend reply, drives lead routing

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function init() {
    const toggle = document.querySelector("[data-ai-toggle]");
    const panel = document.querySelector("[data-ai-panel]");
    const msgs = document.querySelector("[data-ai-msgs]");
    const form = document.querySelector("[data-ai-form]");
    const input = document.querySelector("[data-ai-input]");
    const closeBtn = document.querySelector("[data-ai-close]");
    if (!toggle || !panel) return;

    // Master switch (window.CONFIG.CHAT_ENABLED in config.js). When off, the
    // widget is hidden and no webhook calls are made — wiring is left intact.
    if (window.CONFIG && window.CONFIG.CHAT_ENABLED === false) {
      toggle.style.display = "none";
      panel.style.display = "none";
      return;
    }

    let opened = false;
    let sessionId =
      "web_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);

    function setOpen(state) {
      opened = state;
      panel.classList.toggle("open", opened);
      toggle.setAttribute("aria-expanded", String(opened));
      if (opened) {
        input?.focus();
        if (msgs.children.length === 0) {
          botSay(GREETING, 350);
        }
      }
    }

    toggle.addEventListener("click", () => setOpen(!opened));
    closeBtn?.addEventListener("click", () => setOpen(false));

    function scroll() {
      msgs.scrollTop = msgs.scrollHeight;
    }

    function showTyping() {
      const t = el("div", "ai-typing");
      t.append(el("i"), el("i"), el("i"));
      msgs.appendChild(t);
      scroll();
      return t;
    }

    function botSay(text, delay) {
      return new Promise((resolve) => {
        const typing = showTyping();
        setTimeout(() => {
          typing.remove();
          msgs.appendChild(el("div", "ai-msg bot", text));
          scroll();
          resolve();
        }, delay || 400);
      });
    }

    function userSay(text) {
      msgs.appendChild(el("div", "ai-msg user", text));
      scroll();
    }

    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      const value = input.value.trim();
      if (!value) return;

      userSay(value);
      input.value = "";
      input.disabled = true;

      history.push({ role: "user", content: value });
      if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);

      maybeCaptureLead(value);

      const typing = showTyping();
      askAssistant(value)
        .then((reply) => {
          typing.remove();
          msgs.appendChild(el("div", "ai-msg bot", reply));
          scroll();
          history.push({ role: "assistant", content: reply });
          if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
        })
        .catch(() => {
          typing.remove();
          msgs.appendChild(
            el(
              "div",
              "ai-msg bot",
              "Sorry, I'm having trouble replying right now. Please try again, or call us on 0439 489 630 and someone will help you directly."
            )
          );
          scroll();
        })
        .finally(() => {
          input.disabled = false;
          input.focus();
        });
    });

    async function askAssistant(message) {
      const chatUrl = window.CONFIG?.CHAT_WEBHOOK_URL;
      if (!chatUrl) {
        console.info("[KQuality] No chat webhook configured — echoing input.");
        return "Thanks for your message! (Demo mode — no AI backend configured yet.)";
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(chatUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            history: history.slice(0, -1), // exclude the message we just pushed; backend appends it
            sessionId,
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Chat backend returned " + res.status);
        const data = await res.json();
        if (data.intent) lastIntent = String(data.intent);
        return (
          data.reply ||
          "Thanks for your message — could you tell me a bit more, or call 0439 489 630 and the team will help you directly?"
        );
      } finally {
        clearTimeout(timer);
      }
    }

    function maybeCaptureLead(latestMessage) {
      if (leadSent) return;
      const hasEmail = EMAIL_RE.test(latestMessage);
      const hasPhone = PHONE_RE.test(latestMessage);
      if (!hasEmail && !hasPhone) return;

      // A job applicant, a complaint or a sales pitch is not a quote lead.
      // Filing them here is what made the chat "ask about a quotation" — the
      // intake pipeline emails them about pricing. Those go to the team by
      // email instead, which is what the assistant tells them to do.
      const NON_SALES = /^(careers|subcontractor|complaint|cancel|reschedule|existing_client|spam_pitch|abuse|media|how_found_me|privacy|contact_shared_careers)/;
      if (NON_SALES.test(lastIntent)) return;

      leadSent = true;
      const webhookUrl = window.CONFIG?.WEBHOOK_URL;
      if (!webhookUrl) return;

      const transcript = history.map((m) => `${m.role}: ${m.content}`).join("\n");
      const payload = {
        source: "website_ai_assistant",
        submittedAt: new Date().toISOString(),
        lead: {
          name: null,
          email: hasEmail ? latestMessage.match(EMAIL_RE)[0] : null,
          phone: hasPhone ? latestMessage.match(PHONE_RE)[0] : null,
          rawAnswers: { transcript, sessionId, chatIntent: lastIntent || "unknown" },
        },
      };

      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch((err) => console.error("[KQuality] Chat lead capture failed:", err));
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
