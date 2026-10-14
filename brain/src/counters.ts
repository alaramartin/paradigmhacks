import type { Action, El, Hud } from "../../protocol/types.ts";

export function newHud(): Hud {
    return { mode: "idle", modelCalls: 0, shown: 0, accepted: 0, tabDid: { clicks: 0, keys: 0 }, youDid: 0 };
}

/** Tab did: click/navigate/switch_app and a select choice = 1 click; other typing = its length in keys; key = 1 key. */
export function countStep(hud: Hud, step: Action, target?: El): void {
    switch (step.op) {
        case "click":
        case "navigate":
        case "switch_app":
            hud.tabDid.clicks++;
            break;
        case "type":
            if (target?.role === "select") hud.tabDid.clicks++;
            else hud.tabDid.keys += step.value?.length ?? 0;
            break;
        case "key":
            hud.tabDid.keys++;
            break;
    }
}
