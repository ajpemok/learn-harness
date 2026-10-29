import assert from "node:assert/strict";
import test from "node:test";
import { subscriptionRequestOrigin, subscriptionControlsResponse } from "../src/server/web-subscription-http.ts";

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
