import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("startup shutdown rejects late owners and streams, isolates cleanup and runs each callback once", () => {
	const shutdown = new URL("../src/server/shutdown.ts", import.meta.url).href;
	const events = new URL("../src/server/events-stream.ts", import.meta.url).href;
	const subscriptions = new URL("../src/server/web-subscriptions.ts", import.meta.url).href;
	const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
		import assert from 'node:assert/strict';
		import fs from 'node:fs';
		import os from 'node:os';
		import path from 'node:path';
		const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-shutdown-'));
		process.env.LH_AUTH_FILE = path.join(fixture, 'auth.json');
		process.env.LH_DATA_DIR = path.join(fixture, 'state');
		delete process.env.LH_DESKTOP_SERVER;
		try {
			const { registerServerShutdown, onServerShutdown } = await import(${JSON.stringify(shutdown)});
			registerServerShutdown();
			registerServerShutdown();
			const called = [];
			onServerShutdown(() => called.push('first'));
			onServerShutdown(() => { throw Error('fixture failure'); });
			onServerShutdown(() => called.push('last'));
			onServerShutdown(() => called.push('removed'))();
			process.emit('SIGTERM');
			process.emit('SIGINT');
			assert.deepEqual(called, ['first', 'last']);
			onServerShutdown(() => called.push('late'));
			assert.deepEqual(called, ['first', 'last', 'late']);
			const { eventsResponse } = await import(${JSON.stringify(events)});
			assert.equal((await eventsResponse().body.getReader().read()).done, true);
			const { webSubscriptionOwner } = await import(${JSON.stringify(subscriptions)});
			assert.throws(() => webSubscriptionOwner(), /shutting down/);
			assert.deepEqual(fs.readdirSync(fixture), []);
		} finally { fs.rmSync(fixture, { recursive: true, force: true }); }
	`], { encoding: "utf8", timeout: 10_000 });
	assert.equal(child.status, 0, child.stderr || String(child.error));
});
