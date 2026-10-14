// Tracker state: in memory, restored by POST /api/reset.
import type { Express } from "express";

export interface Ticket {
    id: string;
    title: string;
    status: "Backlog" | "In review" | "Done";
    pr: string;
    assignee: string;
    updated: number;
}

const SEED: Omit<Ticket, "updated">[] = [
    { id: "ENG-142", title: "Checkout total rounds half-cents down", status: "In review", pr: "", assignee: "Maya" },
    { id: "ENG-150", title: "Retry webhook delivery on 5xx", status: "In review", pr: "", assignee: "Theo" },
    { id: "ENG-151", title: "Show seat map on mobile", status: "In review", pr: "", assignee: "Maya" },
    { id: "ENG-155", title: "Rate-limit promo code lookups", status: "In review", pr: "", assignee: "Sam" },
    { id: "ENG-157", title: "Fix timezone on event reminders", status: "In review", pr: "", assignee: "Ines" },
    { id: "ENG-160", title: "Cache venue images at the edge", status: "In review", pr: "", assignee: "Theo" },
];

let tickets: Ticket[] = [];
export function resetTracker(): void {
    const now = Date.now();
    tickets = SEED.map((t, i) => ({ ...t, updated: now - (i + 1) * 3_600_000 }));
}
resetTracker();

export function trackerRoutes(app: Express): void {
    app.get("/api/tickets", (_req, res) => res.json(tickets));
    app.post("/api/tickets/:id", (req, res) => {
        const t = tickets.find((x) => x.id === req.params.id);
        if (!t) return void res.status(404).json({ error: "not found" });
        const { status, pr } = req.body ?? {};
        if (status === "Backlog" || status === "In review" || status === "Done") t.status = status;
        if (typeof pr === "string") t.pr = pr.trim();
        t.updated = Date.now();
        res.json(t);
    });
}
