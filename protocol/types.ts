// Coordinates: global screen points, origin = top-left of the main display (AX convention).
export type Rect = { x: number; y: number; w: number; h: number };

export type Role =
    | "button"
    | "link"
    | "textfield"
    | "textarea"
    | "select"
    | "checkbox"
    | "text"
    | "other";

export interface El {
    id: string; // stable across snapshots where possible
    role: Role;
    label: string; // accessible name or visible text, ≤ 80 chars
    value?: string; // current value (fields); for Terminal, the last 40 lines
    options?: string[]; // role 'select' only: option labels
    checked?: boolean; // checkboxes and pressed toggle buttons
    rect: Rect;
    enabled: boolean;
    path?: string; // CSS path for web. Replays resolve targets by path.
    list?: { key: string; index: number; field?: string }; // item in a repeated structure; field = path relative to the item
}

export interface ScreenState {
    type: "state";
    source: "native" | "web";
    app: string; // bundle id: 'com.google.Chrome' for web, e.g. 'com.apple.Terminal' for native
    window: string;
    url?: string;
    focused: boolean; // web: this tab is in the focused Chrome window. native: always true
    elements: El[]; // visible only, ≤ 200, interactive first, then text
    seq: number; // monotonic per source
    ts: number;
}

export interface UserEvent {
    // web only (C). A reports native input as anonymous `input` messages.
    type: "user_event";
    source: "web";
    app: string;
    url: string;
    kind: "click" | "type" | "key" | "focus" | "navigate";
    target?: El;
    value?: string; // committed text or selected option label, key name, or url
    ts: number;
}

export type Op = "click" | "type" | "key" | "navigate" | "switch_app" | "sequence";

export interface Action {
    op: Op;
    app: string;
    url?: string; // web: the page this step belongs to, so C can pick the right tab
    targetId?: string; // id in the latest state of `app`
    targetPath?: string; // used by replays; resolved against the latest state
    value?: string; // text, option label (for selects), key name, url, or bundle id
    steps?: Action[]; // op === 'sequence'; run by the hub only
    label: string; // pill text without the key glyph, e.g. "Click Checkout", "Repeat for ENG-150 · #13"
    confidence: number; // 0..1
    source: "pattern" | "model";
}

export interface Ghost {
    id: string;
    kind: "action" | "text" | "pay" | "blocked" | "done";
    label: string; // e.g. "Click Checkout ⇥", "Pay $0.30 · tickets.localhost ⇥"
    rect?: Rect; // highlight box; omitted for Terminal ghosts
    cursor?: { x: number; y: number };
    pillAt?: { x: number; y: number }; // pill position when there is no rect
    ghostText?: string; // gray inline text for kind 'text'
    place?: "below" | "above" | "right" | "inside"; // pill placement relative to rect (default below; A flips it above at the screen edge)
    avoid?: Rect[]; // other interactive elements near rect; with no `place`, A puts the pill where it covers none of them
    ttlMs?: number; // auto-hide, used for 'done'
}

export interface Hud {
    mode: "idle" | "predicting" | "shown" | "running";
    lastSource?: "pattern" | "model";
    lastLatencyMs?: number;
    modelCalls: number;
    shown: number;
    accepted: number;
    tabDid: { clicks: number; keys: number }; // what Tab executed for the user
    youDid: number; // every real user input, including Tab/Esc presses
    lastTx?: { hash: string; explorerUrl: string; amountUsd: string };
}

export interface PaymentRequired {
    type: "payment_required";
    paymentId: string;
    url: string;
    method: string;
    payeeDomain: string; // hostname shown to the user
    payTo: string;
    amountUsd: string; // "0.30"
    network: string; // "eip155:84532"
    asset: string;
    verdict: { ok: boolean; reason?: string; pagePriceUsd?: string };
    anchorRect?: Rect; // element that triggered it (screen points)
}

export interface PaymentResult {
    type: "payment_result";
    paymentId: string;
    ok: boolean;
    txHash?: string;
    explorerUrl?: string;
    error?: string;
}

// ---- Messages (see PLAN.md "Messages"). Every message has a `type` field. ----

export type AppId = string; // bundle id

// A → hub
export type ShellToHub =
    | { type: "hello"; role: "shell" }
    | { type: "frontmost"; app: AppId; window: string }
    | ScreenState // native, Terminal only
    | { type: "input"; kind: "key" | "click" }
    | { type: "accept"; ghostId: string }
    | { type: "dismiss"; ghostId: string }
    | ExecResult
    | { type: "hud_click"; item: "ledger" | "contrast" };

// hub → A
export type HubToShell =
    | { type: "ghost"; ghost: Ghost }
    | { type: "ghost_hide" }
    | { type: "exec"; ghostId: string; action: Action } // switch_app only
    | { type: "hud"; hud: Hud };

// C → hub
export type WebToHub =
    | { type: "hello"; role: "web" }
    | ScreenState // web
    | UserEvent
    | PaymentRequired
    | PaymentResult
    | ExecResult;

// hub → C
export type HubToWeb =
    | { type: "exec"; ghostId: string; action: Action } // single step
    | { type: "pay"; paymentId: string }
    | { type: "dismiss_payment"; paymentId: string }
    | { type: "open_url"; url: string };

export interface ExecResult {
    type: "exec_result";
    ghostId: string; // sequence steps: "<ghostId>:<stepIndex>"
    ok: boolean;
    error?: string;
}

export type AnyMessage = ShellToHub | HubToShell | WebToHub | HubToWeb;
