import { expect, test, type APIRequestContext } from "@playwright/test";

// Decision M8W-04. The server under test has PUBLIC_ORIGIN=https://shop.example.test but is reached over plain http, like a container behind Azure's TLS termination. Before the fix, React Router's
// single-fetch CSRF guard compared `Origin: https://shop.example.test` with a request URL of http://<host> and answered 400 "Unexpected Server Error" to EVERY form action.
const SITE = "https://shop.example.test";
const asSite = { Host: "shop.example.test" };

/** A page read the way the browser would: the form's csrf token and the cookies the server set (by hand: they are Secure, and this connection is http). */
async function formState(request: APIRequestContext, path = "/sign-in") {
  const res = await request.get(path, { headers: asSite });
  expect(res.status()).toBe(200);
  const csrf = /name="csrf" value="([^"]+)"/.exec(await res.text())?.[1];
  expect(csrf, "the form carries a csrf token").toBeTruthy();
  const cookie = res.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value.split(";")[0]).join("; ");
  return { csrf: csrf!, cookie };
}

const post = (request: APIRequestContext, cookie: string, csrf: string, origin: string | null) =>
  request.post("/sign-in.data", {
    headers: { ...asSite, ...(origin ? { Origin: origin } : {}), Cookie: cookie },
    form: { csrf, email: "nobody@example.test", password: "Wrong-password-1" },
  });

test.describe("behind a TLS-terminating proxy", () => {
  test("a same-origin form action (single fetch) reaches the app instead of 'Unexpected Server Error'", async ({ request }) => {
    const { csrf, cookie } = await formState(request);
    const res = await post(request, cookie, csrf, SITE);
    const body = await res.text();
    expect(body).not.toContain("SanitizedError");
    expect(body).not.toContain("Unexpected Server Error");
    expect(res.status()).toBe(401);                                        // our sign-in action answered "invalid credentials": the request reached the app, React Router's guard did not stop it
  });

  test("a foreign Origin is still refused", async ({ request }) => {
    const { csrf, cookie } = await formState(request);
    for (const origin of ["https://evil.example", "http://shop.example.test", "https://shop.example.test.evil.example"]) {
      const res = await post(request, cookie, csrf, origin);
      expect(res.status(), `Origin ${origin}`).toBeGreaterThanOrEqual(400);
    }
  });

  test("a request from ANOTHER https host (a second azurewebsites.net name) gets our readable refusal, not React Router's bare 400", async ({ request }) => {
    const { csrf, cookie } = await formState(request);
    const res = await request.post("/sign-in.data", {
      headers: { Host: "other.example.test", Origin: "https://other.example.test", Cookie: cookie },
      form: { csrf, email: "nobody@example.test", password: "Wrong-password-1" },
    });
    const body = await res.text();
    expect(res.status()).toBe(403);                                        // assertCsrf's refusal, not the 400 of the single-fetch guard
    expect(body).not.toContain("Unexpected Server Error");
    expect(body).toContain("origin_mismatch");                             // the reason the page turns into "use the official address"
  });

  test("X-Forwarded-Proto and X-Forwarded-Host from the peer change nothing", async ({ request }) => {
    const { csrf, cookie } = await formState(request);
    // a peer that claims to be http, or to be another host, must not move the request URL: the same-origin post still works, and a post "from" the claimed host does not
    const res = await request.post("/sign-in.data", {
      headers: { ...asSite, Origin: SITE, Cookie: cookie, "X-Forwarded-Proto": "http", "X-Forwarded-Host": "evil.example" },
      form: { csrf, email: "nobody@example.test", password: "Wrong-password-1" },
    });
    expect(res.status()).toBe(401);                                        // reached our action (invalid credentials), not stopped by the guard
    const forged = await request.post("/sign-in.data", {
      headers: { ...asSite, Origin: "http://evil.example", Cookie: cookie, "X-Forwarded-Proto": "http", "X-Forwarded-Host": "evil.example" },
      form: { csrf, email: "nobody@example.test", password: "Wrong-password-1" },
    });
    expect(forged.status()).toBeGreaterThanOrEqual(400);
  });

  test("a page loads over http with the site's own https assets and cookies marked Secure", async ({ request }) => {
    const res = await request.get("/", { headers: asSite });
    expect(res.status()).toBe(200);
    expect(res.headers()["strict-transport-security"]).toContain("max-age");   // the site is https: HSTS is on
    for (const c of res.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie")) expect(c.value).toContain("Secure");
  });
});
