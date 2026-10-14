// Injected into every page via Page.addScriptToEvaluateOnNewDocument (and evaluated once in pages
// that were already open). Talks to Node through the __tabEmit binding. Plain JS: it runs in the page.
(() => {
    if (window.__tabInjected) return;
    window.__tabInjected = true;

    const MAX = 200;
    const INTERACTIVE = "a[href], button, input, select, textarea, [role=button], [contenteditable=''], [contenteditable=true]";
    const TEXT_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "P", "LI", "TD", "TH", "DT", "DD", "LABEL", "SPAN", "DIV", "STRONG", "EM", "B", "CODE", "PRE", "SMALL", "TIME", "FIGCAPTION", "LEGEND", "BLOCKQUOTE", "SUMMARY", "OUTPUT"]);
    const prefix = Math.random().toString(36).slice(2, 6);
    let nextId = 1;

    const emit = (msg) => {
        try {
            window.__tabEmit && window.__tabEmit(JSON.stringify(msg));
        } catch {}
    };

    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const cut = (s) => (s.length > 80 ? s.slice(0, 79) + "…" : s);

    function tabId(el) {
        let id = el.getAttribute("data-tab-id");
        if (!id) {
            id = `${prefix}${nextId++}`;
            el.setAttribute("data-tab-id", id);
        }
        return id;
    }

    // ---------- CSS paths ----------
    const cssEscape = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s);
    const goodId = (id) => id && !/\d{3,}|^[0-9]|:/.test(id) && document.querySelectorAll("#" + cssEscape(id)).length === 1;

    function step(el) {
        const tag = el.tagName.toLowerCase();
        const parent = el.parentElement;
        if (!parent) return tag;
        const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
        return same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(el) + 1})` : tag;
    }

    function cssPath(el, root) {
        const parts = [];
        let cur = el;
        while (cur && cur !== root && cur.nodeType === 1) {
            if (!root && goodId(cur.id)) {
                parts.unshift("#" + cssEscape(cur.id));
                return parts.join(" > ");
            }
            if (!root && cur === document.body) {
                parts.unshift("body");
                return parts.join(" > ");
            }
            parts.unshift(step(cur));
            cur = cur.parentElement;
        }
        return parts.join(" > ");
    }

    // ---------- lists ----------
    // An item is an element whose parent has >= 2 children with the same tag+class signature.
    // Table cells are fields of their row, not items, so the row wins.
    const sig = (el) => el.tagName + "." + Array.from(el.classList).filter((c) => !/active|selected|open|hover|focus|done|current/i.test(c)).sort().join(".");
    const NOT_ITEM = new Set(["TD", "TH", "HTML", "BODY", "MAIN", "HEADER", "FOOTER", "NAV", "TBODY", "THEAD", "OPTION", "SPAN", "A", "STRONG", "EM", "CODE", "B", "I", "SMALL"]);

    function listOf(el) {
        let cur = el;
        for (let depth = 0; cur && cur !== document.body && depth < 8; depth++, cur = cur.parentElement) {
            const parent = cur.parentElement;
            if (!parent || NOT_ITEM.has(cur.tagName)) continue;
            const s = sig(cur);
            const same = Array.from(parent.children).filter((c) => sig(c) === s);
            if (same.length < 2) continue;
            const out = { key: cssPath(parent), index: same.indexOf(cur) };
            if (cur !== el) out.field = cssPath(el, cur);
            return out;
        }
        return undefined;
    }

    // ---------- visibility, geometry ----------
    function visible(el, r) {
        if (r.width < 1 || r.height < 1) return false;
        if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
        return !el.closest("[hidden], [aria-hidden=true], [inert]");
    }

    // Screen points, assuming 100% zoom (per PLAN: x = screenX + r.x, y = screenY + chrome + r.y).
    function screenRect(r) {
        const top = window.screenY + (window.outerHeight - window.innerHeight);
        const left = window.screenX + (window.outerWidth - window.innerWidth) / 2;
        return { x: Math.round(left + r.x), y: Math.round(top + r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }

    // ---------- describing elements ----------
    function roleOf(el) {
        const tag = el.tagName;
        const type = (el.getAttribute("type") || "").toLowerCase();
        if (tag === "SELECT") return "select";
        if (tag === "TEXTAREA" || el.isContentEditable) return "textarea";
        if (tag === "INPUT") {
            if (type === "checkbox" || type === "radio") return "checkbox";
            if (["submit", "button", "reset", "image"].includes(type)) return "button";
            if (type === "hidden") return "other";
            return "textfield";
        }
        if (tag === "BUTTON" || el.getAttribute("role") === "button") return "button";
        if (tag === "A") return "link";
        return "text";
    }

    function labelOf(el, role) {
        const aria = el.getAttribute("aria-label");
        if (aria) return clean(aria);
        if (role === "textfield" || role === "textarea" || role === "select" || role === "checkbox") {
            const lab = (el.labels && el.labels[0]) || (el.id && document.querySelector(`label[for="${cssEscape(el.id)}"]`));
            if (lab) return clean(lab.innerText);
            const by = el.getAttribute("aria-labelledby");
            if (by) {
                const t = by.split(/\s+/).map((i) => document.getElementById(i)).filter(Boolean).map((n) => n.innerText).join(" ");
                if (clean(t)) return clean(t);
            }
        }
        if (role !== "textfield" && role !== "textarea" && role !== "select") {
            const t = clean(el.innerText || el.value);
            if (t) return t;
        }
        return clean(el.getAttribute("placeholder") || el.getAttribute("name") || el.getAttribute("title") || "");
    }

    function describe(el, r) {
        r = r || el.getBoundingClientRect();
        const role = roleOf(el);
        const d = { id: tabId(el), role, label: cut(labelOf(el, role)), rect: screenRect(r), enabled: !(el.disabled || el.getAttribute("aria-disabled") === "true") };
        if (role === "textfield" || role === "textarea") d.value = el.isContentEditable ? clean(el.innerText) : el.value;
        if (role === "select") {
            d.options = Array.from(el.options).map((o) => clean(o.label || o.text));
            const sel = el.options[el.selectedIndex];
            d.value = sel ? clean(sel.label || sel.text) : "";
        }
        if (role === "checkbox") d.checked = !!el.checked;
        const pressed = el.getAttribute("aria-pressed");
        if (pressed !== null) d.checked = pressed === "true";
        d.path = cssPath(el);
        const list = listOf(el);
        if (list) d.list = list;
        return d;
    }

    // An element counts as text if it has its own non-empty text and isn't inside an interactive element.
    function ownText(el) {
        let s = "";
        for (const n of el.childNodes) if (n.nodeType === 3) s += n.nodeValue;
        return clean(s);
    }

    function collect() {
        const main = document.querySelector("main, [role=main]") || document.body;
        const inter = [], interMain = [], text = [];
        const seen = new Set();
        for (const el of document.querySelectorAll(INTERACTIVE)) {
            if (seen.has(el) || el.closest("[data-tab-ignore]")) continue;
            if (el.tagName === "INPUT" && el.type === "hidden") continue;
            const r = el.getBoundingClientRect();
            if (!visible(el, r)) continue;
            seen.add(el);
            (main.contains(el) ? interMain : inter).push([el, r]);
        }
        const walker = document.createTreeWalker(main, NodeFilter.SHOW_ELEMENT);
        for (let el = walker.currentNode; el && text.length < MAX; el = walker.nextNode()) {
            if (el.nodeType !== 1 || !TEXT_TAGS.has(el.tagName) || seen.has(el)) continue;
            if (!ownText(el) || el.closest(INTERACTIVE)) continue;
            const r = el.getBoundingClientRect();
            if (!visible(el, r)) continue;
            text.push([el, r]);
        }
        const all = interMain.concat(inter, text).slice(0, MAX);
        return all.map(([el, r]) => describe(el, r));
    }

    // ---------- state emission ----------
    let timer = 0, lastJson = "";
    function sendState(force) {
        clearTimeout(timer);
        timer = 0;
        let elements;
        try {
            elements = collect();
        } catch (e) {
            return emit({ kind: "error", error: String(e && e.stack) });
        }
        const body = { kind: "state", url: location.href, title: document.title, focused: document.hasFocus(), visible: document.visibilityState === "visible", elements };
        const json = JSON.stringify(body);
        if (!force && json === lastJson) return;
        lastJson = json;
        emit(body);
    }
    const schedule = (ms = 150) => {
        if (!timer) timer = setTimeout(() => sendState(false), ms);
    };
    window.__tabState = () => sendState(true);
    window.__tabDescribe = (el) => describe(el);

    new MutationObserver(() => schedule()).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    addEventListener("scroll", () => schedule(), true);
    addEventListener("resize", () => schedule());
    addEventListener("animationend", () => schedule(), true);
    addEventListener("transitionend", () => schedule(), true);
    addEventListener("focus", () => sendState(true));
    addEventListener("blur", () => sendState(true));
    document.addEventListener("visibilitychange", () => sendState(true));
    addEventListener("load", () => schedule(0));
    let sx = screenX, sy = screenY;
    setInterval(() => {
        if (screenX !== sx || screenY !== sy) {
            sx = screenX;
            sy = screenY;
            schedule(0);
        }
    }, 500);

    // ---------- user events ----------
    const target = (el) => el && el.closest && el.closest(INTERACTIVE);
    const ue = (kind, el, value) => emit({ kind: "user_event", ev: kind, url: location.href, target: el ? describe(el) : undefined, value, trusted: true });

    addEventListener(
        "click",
        (e) => {
            const el = target(e.target);
            if (!el) return;
            if (el.tagName === "SELECT" || (el.tagName === "INPUT" && /^(text|search|email|number|tel|url|password|)$/.test(el.type))) return;
            if (el.tagName === "TEXTAREA") return;
            ue("click", el);
        },
        true,
    );
    addEventListener(
        "change",
        (e) => {
            const el = e.target;
            if (!el || !el.tagName) return;
            if (el.tagName === "SELECT") {
                const o = el.options[el.selectedIndex];
                return ue("type", el, o ? clean(o.label || o.text) : "");
            }
            if (el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio")) return; // the click already said it
            if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") ue("type", el, el.value);
        },
        true,
    );
    addEventListener(
        "focusin",
        (e) => {
            const el = target(e.target);
            if (el) ue("focus", el);
            schedule(0);
        },
        true,
    );
    addEventListener(
        "keydown",
        (e) => {
            if (["Enter", "Escape"].includes(e.key) && !e.isComposing) {
                ue("key", target(e.target) || undefined, e.key);
            }
        },
        true,
    );

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => schedule(0));
    else schedule(0);
})();
