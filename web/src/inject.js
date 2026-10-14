// Injected into every page (Page.addScriptToEvaluateOnNewDocument + Runtime.evaluate on attach).
// Emits {kind:'state'|'user_event'|'focus', ...} JSON through the __tabEmit binding. No page-specific code.
(() => {
    if (window.__tabInjected) return;
    window.__tabInjected = true;
    const emit = (o) => {
        try {
            window.__tabEmit && window.__tabEmit(JSON.stringify(o));
        } catch {}
    };

    const INTERACTIVE = "a[href], button, input, select, textarea, [role=button], [contenteditable=true]";
    const MAX = 200;
    let nextId = 1;

    function idOf(el) {
        if (!el.dataset.tabId) el.dataset.tabId = "t" + nextId++;
        return el.dataset.tabId;
    }

    // Repeatable tags always carry their position, so a path is the same whether one or six items show
    // (the tracker's search shows one result while a unit is recorded, and six while it is replayed).
    const REPEATABLE = new Set(["LI", "TR", "TD", "TH", "DT", "DD", "OPTION", "ARTICLE"]);

    function cssPath(el) {
        if (el.id && document.querySelectorAll("#" + CSS.escape(el.id)).length === 1) return "#" + CSS.escape(el.id);
        const parts = [];
        for (let e = el; e && e.nodeType === 1 && e !== document.body; e = e.parentElement) {
            if (e.id && document.querySelectorAll("#" + CSS.escape(e.id)).length === 1) {
                parts.unshift("#" + CSS.escape(e.id));
                return parts.join(" > ");
            }
            const p = e.parentElement;
            const tag = e.tagName.toLowerCase();
            if (!p) {
                parts.unshift(tag);
                break;
            }
            const same = [...p.children].filter((c) => c.tagName === e.tagName);
            parts.unshift(same.length > 1 || REPEATABLE.has(e.tagName) ? `${tag}:nth-child(${[...p.children].indexOf(e) + 1})` : tag);
        }
        return parts.join(" > ");
    }

    // Path from `root` (exclusive) down to `el` (inclusive).
    function relPath(root, el) {
        if (root === el) return "";
        const parts = [];
        for (let e = el; e && e !== root; e = e.parentElement) {
            const p = e.parentElement;
            const tag = e.tagName.toLowerCase();
            const same = p ? [...p.children].filter((c) => c.tagName === e.tagName) : [];
            parts.unshift(same.length > 1 || REPEATABLE.has(e.tagName) ? `${tag}:nth-child(${[...p.children].indexOf(e) + 1})` : tag);
        }
        return parts.join(" > ");
    }

    const sig = (e) => e.tagName + "." + [...e.classList].sort().join(".");

    // Repeated structure: nearest ancestor-or-self whose parent has ≥ 2 children with the same tag+class signature.
    function listOf(el) {
        for (let a = el; a && a !== document.body; a = a.parentElement) {
            if (a.tagName === "TD" || a.tagName === "TH") continue; // cells are fields; the row is the item
            const p = a.parentElement;
            if (!p || p === document.body) break;
            const sibs = [...p.children].filter((c) => sig(c) === sig(a));
            // Semantic lists count even when filtered down to one item (a search box narrowing a <ul>).
            const semantic = ["UL", "OL", "TBODY", "MENU"].includes(p.tagName) && ["LI", "TR"].includes(a.tagName);
            if (sibs.length >= 2 || semantic) {
                const field = relPath(a, el);
                return { key: cssPath(p), index: sibs.indexOf(a), ...(field ? { field } : {}) };
            }
        }
        return undefined;
    }

    function roleOf(el) {
        const tag = el.tagName;
        const type = (el.getAttribute("type") || "").toLowerCase();
        if (tag === "A") return "link";
        if (tag === "BUTTON" || el.getAttribute("role") === "button") return "button";
        if (tag === "SELECT") return "select";
        if (tag === "TEXTAREA" || el.isContentEditable) return "textarea";
        if (tag === "INPUT") {
            if (type === "checkbox" || type === "radio") return "checkbox";
            if (["button", "submit", "reset"].includes(type)) return "button";
            if (type === "hidden") return null;
            return "textfield";
        }
        return "text";
    }

    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const cut = (s, n = 80) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

    function labelOf(el) {
        const aria = el.getAttribute("aria-label");
        if (aria) return cut(clean(aria));
        const by = el.getAttribute("aria-labelledby");
        if (by) {
            const t = by.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ");
            if (clean(t)) return cut(clean(t));
        }
        if (el.labels && el.labels.length) {
            const t = clean(el.labels[0].innerText);
            if (t) return cut(t);
        }
        if (!["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) {
            const t = clean(el.innerText);
            if (t) return cut(t);
        }
        return cut(clean(el.getAttribute("placeholder") || el.getAttribute("name") || el.getAttribute("title") || ""));
    }

    function valueOf(el) {
        if (el.tagName === "SELECT") return el.selectedOptions[0] ? clean(el.selectedOptions[0].label) : "";
        if (el.tagName === "INPUT" && ["checkbox", "radio"].includes(el.type)) return undefined; // `checked` says it
        if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return el.type === "password" ? undefined : el.value;
        if (el.isContentEditable) return el.innerText;
        return undefined;
    }

    // Screen points. Assumes 100% zoom; the browser chrome height is outer − inner.
    function screenRect(r) {
        const top = window.screenY + (window.outerHeight - window.innerHeight);
        return { x: Math.round(window.screenX + r.left), y: Math.round(top + r.top), w: Math.round(r.width), h: Math.round(r.height) };
    }

    function visible(el, r, anywhere = false) {
        if (r.width < 1 || r.height < 1) return false;
        if (!anywhere && (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth)) return false;
        const cs = getComputedStyle(el);
        return cs.visibility !== "hidden" && cs.opacity !== "0";
    }

    function describe(el) {
        const role = roleOf(el);
        if (!role) return null;
        const r = el.getBoundingClientRect();
        const d = { id: idOf(el), role, label: labelOf(el), rect: screenRect(r), enabled: !el.disabled && el.getAttribute("aria-disabled") !== "true", path: cssPath(el) };
        const v = valueOf(el);
        if (v !== undefined) d.value = v;
        if (el.tagName === "SELECT") d.options = [...el.options].map((o) => clean(o.label));
        if (role === "checkbox") d.checked = el.checked;
        else if (el.hasAttribute("aria-pressed")) d.checked = el.getAttribute("aria-pressed") === "true";
        const list = listOf(el);
        if (list) d.list = list;
        return d;
    }

    function ownText(el) {
        let t = "";
        for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent;
        return clean(t);
    }

    function collect() {
        const out = [];
        const seen = new Set();
        for (const el of document.querySelectorAll(INTERACTIVE)) {
            if (out.length >= MAX) break;
            const r = el.getBoundingClientRect();
            if (!visible(el, r)) continue;
            const d = describe(el);
            if (d) {
                out.push(d);
                seen.add(el);
            }
        }
        // Visible text: elements with their own text, not inside something already collected.
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        for (let el = walker.nextNode(); el && out.length < MAX; el = walker.nextNode()) {
            if (seen.has(el) || el.closest(INTERACTIVE) || ["SCRIPT", "STYLE", "NOSCRIPT", "OPTION", "LABEL"].includes(el.tagName)) continue;
            if (!ownText(el)) continue;
            const r = el.getBoundingClientRect();
            const list = listOf(el);
            // List items count even just off-screen: "the next row" must exist even if it's below the fold.
            if (!visible(el, r, !!list)) continue;
            const d = { id: idOf(el), role: "text", label: cut(clean(el.textContent), 200), rect: screenRect(r), enabled: true, path: cssPath(el) };
            if (list) d.list = list;
            out.push(d);
        }
        return out;
    }

    let timer = null;
    function sendState(reason) {
        clearTimeout(timer);
        timer = null;
        emit({ kind: "state", reason, url: location.href, title: document.title, visible: document.visibilityState === "visible", focused: document.hasFocus() && document.visibilityState === "visible", elements: collect() });
    }
    const soon = (reason) => {
        if (!timer) timer = setTimeout(() => sendState(reason), 150);
    };

    // ---- user events ----
    const target = (e) => {
        const el = e.target instanceof Element ? e.target.closest(INTERACTIVE) || e.target : null;
        return el ? describe(el) : undefined;
    };
    document.addEventListener("click", (e) => e.isTrusted !== false && emit({ kind: "user_event", ev: "click", target: target(e) }), true);
    document.addEventListener(
        "change",
        (e) => {
            const el = e.target;
            if (!(el instanceof Element)) return;
            if (el.type === "checkbox" || el.type === "radio") return; // the click already says it
            emit({ kind: "user_event", ev: "type", target: describe(el), value: valueOf(el) });
        },
        true,
    );
    document.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === "Escape") emit({ kind: "user_event", ev: "key", value: e.key, target: target(e) });
    }, true);
    document.addEventListener("focusin", (e) => emit({ kind: "user_event", ev: "focus", target: target(e) }), true);

    // ---- when to emit state ----
    new MutationObserver(() => soon("mutation")).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    document.addEventListener("input", () => soon("input"), true);
    addEventListener("scroll", () => soon("scroll"), true);
    addEventListener("resize", () => soon("resize"));
    addEventListener("focus", () => sendState("focus"));
    addEventListener("blur", () => sendState("blur"));
    document.addEventListener("visibilitychange", () => sendState("visibility"));
    document.addEventListener("animationend", () => soon("animation"), true);
    document.addEventListener("transitionend", () => soon("transition"), true);
    let lastPos = "";
    setInterval(() => {
        const pos = [screenX, screenY, outerWidth, outerHeight, innerWidth, innerHeight].join(",");
        if (pos !== lastPos) {
            lastPos = pos;
            soon("window");
        }
    }, 500);

    window.__tabState = () => sendState("request");
    const start = () => {
        emit({ kind: "user_event", ev: "navigate", value: location.href });
        sendState("load");
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
})();
