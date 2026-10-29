import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { SCOPES } = createRequire(import.meta.url)("../electron/chatgpt.cjs");

async function within(promise, label, ms = 10_000) {
	let timer;
	try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label)), ms); })]); }
	finally { clearTimeout(timer); }
}

/** Exercise the built server with disposable credentials and no provider traffic. */
export async function verifyShutdownRuntime(root, runtime = process.execPath) {
	if (process.platform === "win32") {
		console.log("[shutdown-runtime] POSIX signal checks require Linux or macOS");
		return;
	}
	const results = [];
	for (const mode of ["notification-streams", "queued-provider-requests"]) {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "lh-shutdown-runtime-"));
		fs.chmodSync(home, 0o700);
		fs.writeFileSync(path.join(home, "auth.json"), "{}", { mode: 0o600 });
		const preload = path.join(home, "offline.cjs");
		fs.writeFileSync(preload, `global.fetch = (_url, options = {}) => {
			console.log('LH_FIXTURE_PROVIDER_WAIT');
			return new Promise((_resolve, reject) => {
				const signal = options.signal;
				if (!signal) return reject(Error('Fixture requires a cancellation signal'));
				if (signal.aborted) reject(signal.reason);
				else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
			});
		};`, { mode: 0o600 });
		if (mode === "queued-provider-requests") {
			fs.writeFileSync(path.join(home, "chatgpt-credentials.json"), JSON.stringify({
				version: 1, hostId: "fixture-host", activeId: "fixture-account", registrations: [{
					id: "fixture-account", clientId: "fixture-client", issuer: "https://auth.openai.com", subject: "fixture-subject",
					tokens: { idToken: "fixture-id", accessToken: "fixture-access", refreshToken: "fixture-refresh", scopes: SCOPES, expiresAt: 0 },
				}],
			}), { mode: 0o600 });
		}
		const reservation = net.createServer();
		reservation.listen(0, "127.0.0.1");
		await once(reservation, "listening");
		const port = reservation.address().port;
		await new Promise(resolve => reservation.close(resolve));
		const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
		const child = spawn(runtime, [path.join(root, "server.js")], {
			cwd: root, stdio: ["ignore", "pipe", "pipe"], env: {
				...env, HOME: home, USERPROFILE: home, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", ELECTRON_RUN_AS_NODE: "1",
				HOSTNAME: "127.0.0.1", PORT: String(port), NODE_OPTIONS: `--require=${preload}`,
				LH_AUTH_FILE: path.join(home, "auth.json"), LH_DATA_DIR: path.join(home, "state"), LH_IGNORE_ENV_KEYS: "1",
			},
		});
		const exited = once(child, "exit").then(([code, signal]) => ({ code, signal }));
		let logs = "", providerStarted;
		const providerWait = new Promise(resolve => { providerStarted = resolve; });
		const record = data => { logs = (logs + data).slice(-8000); if (logs.includes("LH_FIXTURE_PROVIDER_WAIT")) providerStarted(); };
		child.stdout.on("data", record); child.stderr.on("data", record);
		const agent = new http.Agent({ keepAlive: true, maxSockets: 12 });
		const pending = [];
		const request = pathname => new Promise((resolve, reject) => {
			const req = http.get({ host: "127.0.0.1", port, path: pathname, agent }, res => {
				res.resume(); res.on("error", reject); res.on("end", () => resolve(res.statusCode));
			});
			req.on("error", reject);
		});
		try {
			let ready = false;
			for (let i = 0; i < 120; i++) {
				try { ready = await request("/api/health") === 200; } catch { /* Wait for the disposable server. */ }
				if (ready) break;
				assert.equal(child.exitCode, null, logs);
				await new Promise(resolve => setTimeout(resolve, 100));
			}
			assert.ok(ready, logs);
			if (mode === "queued-provider-requests") {
				for (let i = 0; i < 8; i++) pending.push(request("/api/models").catch(() => {}));
				await within(providerWait, "Fixture never reached provider transport");
			} else {
				for (let i = 0; i < 3; i++) pending.push(request("/api/events").catch(() => {}));
				// Signal while the first route can still be importing, before its heartbeat.
				await request("/api/health");
			}
			const started = Date.now();
			child.kill("SIGTERM");
			assert.deepEqual(await within(exited, `Shutdown stalled: ${mode}\n${logs}`), { code: 143, signal: null });
			await within(Promise.all(pending), "Client requests did not settle");
			results.push({ mode, shutdownMs: Date.now() - started, forcedKill: false });
		} finally {
			agent.destroy();
			if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
			fs.rmSync(home, { recursive: true, force: true });
		}
	}
	console.log(`[shutdown-runtime] passed ${JSON.stringify(results)}`);
	return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	verifyShutdownRuntime(path.resolve(process.argv[2] ?? ".next/standalone")).catch(error => { console.error(error); process.exitCode = 1; });
}
