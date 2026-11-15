import assert from "node:assert/strict";
import test from "node:test";
import { subscriptionRequestOrigin, subscriptionControlsResponse } from "../src/server/web-subscription-http.ts";
import { apiRequestRefusal } from "../src/server/desktop-access.ts";
import { createPluginDocumentRoute } from "../src/server/plugin-transport.ts";

test("an explicit HTTPS origin supports TLS termination and rejects foreign hosts or origins", async () => {
	const previous = process.env.LH_PUBLIC_ORIGIN;
	try {
		process.env.LH_PUBLIC_ORIGIN = "https://learn.example.invalid";
		const request = (headers: Record<string, string> = {}) => new Request("http://127.0.0.1:3000/api/subscriptions", {
			method: "POST", headers: { host: "learn.example.invalid", origin: "https://learn.example.invalid", "x-learnharness-subscriptions": "1", ...headers },
		});
		assert.equal(subscriptionRequestOrigin(request()), "https://learn.example.invalid");
		assert.equal(subscriptionRequestOrigin(request({ host: "other.example.invalid", "x-forwarded-host": "learn.example.invalid" })), undefined);
		assert.equal((await subscriptionControlsResponse(request({ origin: "https://other.example.invalid" }))).status, 403);
		for (const origin of ["", "not a URL", "http://learn.example.invalid", "https://user:pass@learn.example.invalid", "https://learn.example.invalid/path", "https://learn.example.invalid?query", "https://learn.example.invalid#fragment"]) {
			process.env.LH_PUBLIC_ORIGIN = origin;
			assert.equal(subscriptionRequestOrigin(request()), undefined, origin);
		}
		delete process.env.LH_PUBLIC_ORIGIN;
		assert.equal(subscriptionRequestOrigin(request({ host: "localhost:3000", "x-forwarded-proto": "https", "x-forwarded-host": "other.example.invalid" })), "http://localhost:3000");
	} finally {
		if (previous === undefined) delete process.env.LH_PUBLIC_ORIGIN;
		else process.env.LH_PUBLIC_ORIGIN = previous;
	}
});

test("the shared browser API guard requires both explicit host admission and the configured HTTPS origin", () => {
	const env = { LH_ALLOWED_HOSTS: "learn.example.invalid", LH_PUBLIC_ORIGIN: "https://learn.example.invalid" };
	const request = (method = "POST", headers: Record<string, string> = {}) => new Request("http://127.0.0.1:3000/api/settings", {
		method, headers: { host: "learn.example.invalid", origin: "https://learn.example.invalid", "sec-fetch-site": "same-origin", ...headers },
	});
	assert.equal(apiRequestRefusal(request(), env), undefined);
	assert.match(apiRequestRefusal(request(), { ...env, LH_ALLOWED_HOSTS: "" })!, /not allowed/);
	assert.match(apiRequestRefusal(request("POST", { origin: "http://learn.example.invalid" }), env)!, /Cross-site/);
	for (const method of ["GET", "HEAD", "OPTIONS", "POST", "PUT", "DELETE"]) {
		assert.ok(apiRequestRefusal(request(method, { host: "localhost", "x-forwarded-host": "learn.example.invalid" }), env));
		assert.ok(apiRequestRefusal(request(method), { ...env, LH_PUBLIC_ORIGIN: "http://learn.example.invalid" }));
	}
	const desktop = { ...env, LH_DESKTOP_SERVER: "1", LH_DESKTOP_API_SECRET: "x".repeat(64) };
	assert.ok(apiRequestRefusal(request(), desktop));
	assert.equal(apiRequestRefusal(request("POST", { "x-learnharness-desktop": "x".repeat(64) }), desktop), undefined);
});

test("streamed plugin documents enforce the HTTPS origin before conversion", async t => {
	const keys = ["LH_ALLOWED_HOSTS", "LH_PUBLIC_ORIGIN", "LH_DESKTOP_SERVER", "LH_DESKTOP_API_SECRET"] as const;
	const saved = keys.map(key => process.env[key]);
	const convertDocument = t.mock.fn(async () => Response.json({ markdown: "synthetic" }));
	const route = createPluginDocumentRoute({ convertDocument });
	try {
		delete process.env.LH_DESKTOP_SERVER;
		delete process.env.LH_DESKTOP_API_SECRET;
		process.env.LH_ALLOWED_HOSTS = "learn.example.invalid";
		process.env.LH_PUBLIC_ORIGIN = "https://learn.example.invalid";
		const post = (origin: string) => new Request("http://127.0.0.1:3000/api/plugins/document-one/documents/markdown", {
			method: "POST", headers: { host: "learn.example.invalid", origin, "sec-fetch-site": "same-origin" },
		});
		assert.equal((await route.POST(post("https://other.invalid"), { params: Promise.resolve({ id: "document-one" }) })).status, 403);
		assert.equal(convertDocument.mock.callCount(), 0);
		assert.equal((await route.POST(post("https://learn.example.invalid"), { params: Promise.resolve({ id: "document-one" }) })).status, 200);
		assert.equal(convertDocument.mock.callCount(), 1);
	} finally {
		keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; });
	}
});
