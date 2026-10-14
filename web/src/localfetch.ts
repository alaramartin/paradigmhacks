// Node can't resolve *.localhost on every OS (Chrome can). Send those requests to 127.0.0.1
// and keep the original Host header, so the demo server sees the same URL the page did.
export const localFetch: typeof fetch = (input, init) => {
    const req = new Request(input as RequestInfo, init);
    const u = new URL(req.url);
    if (!u.hostname.endsWith(".localhost")) return fetch(req);
    const host = u.host;
    u.hostname = "127.0.0.1";
    const headers = new Headers(req.headers);
    headers.set("host", host);
    return fetch(new Request(u, { method: req.method, headers, body: req.body, duplex: "half", redirect: req.redirect } as RequestInit));
};
