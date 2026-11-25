/** Two independent app processes share one provider service. */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { startProviderService } from "../src/provider-service/service.ts";
import { parseLaunch } from "../src/provider-service/claude-session.ts";
import { providerConnection } from "../src/core/provider-role.ts";
import type { RunClaude } from "../src/agent/claude-code/stream.ts";

const root = path.resolve(import.meta.dirname, "..");
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lh-providers-"));
after(() => fs.rm(directory, { recursive: true, force: true }));
const { SCOPES } = createRequire(import.meta.url)("../electron/chatgpt.cjs");
const model = openaiProvider().getModels().find((entry) => entry.api === "openai-responses")!;

let refreshes = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
	const url = String(input);
	if (url.endsWith("/oauth/token")) { refreshes++; throw new Error("refresh is not expected"); }
	assert.equal(url, "https://api.openai.com/v1/models", "unexpected network request");
	return Response.json({ models: [{ slug: model.id, display_name: "Fixture ChatGPT", visibility: "list" }] });
};
after(() => { globalThis.fetch = originalFetch; });

let count = 0;
function socketPath(name: string): string {
	return process.platform === "win32" ? `\\\\.\\pipe\\lh-${process.pid}-${++count}-${name}` : path.join(directory, `${++count}-${name}.sock`);
}

async function credentials(): Promise<string> {
	const target = await fs.mkdtemp(path.join(directory, "credentials-"));
	await fs.writeFile(path.join(target, "chatgpt-credentials.json"), JSON.stringify({ version: 1, hostId: "fixture-host", allowBackgroundUse: true, activeId: "fixture-account", registrations: [{ id: "fixture-account", clientId: "oaiapp_fixture", issuer: "https://auth.openai.com", subject: "fixture-subject", tokens: { accessToken: "fixture-chatgpt-access", refreshToken: "fixture-chatgpt-refresh", idToken: "fixture-id-token", scopes: SCOPES, expiresAt: Date.now() + 3600000 } }] }), { mode: 0o600 });
	return target;
}

const FAKE_CLAUDE = path.join(root, "tests/fixtures/claude-code/fake-claude.mjs");
const launches: string[][] = [];
/** The fake CLI calls the lesson's own tool through its MCP bridge, then replies with the result. */
const runClaude: RunClaude = async (args, options) => {
	launches.push(args);
	const scenario = path.join(directory, `scenario-${launches.length}.jsonl`);
	const id = `toolu_${launches.length}`;
	const event = (value: object) => JSON.stringify({ type: "stream_event", event: value });
	await fs.writeFile(scenario, [
		event({ type: "message_start", message: { usage: {} } }),
		event({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name: "mcp__learnharness__lesson", input: {} } }),
		event({ type: "content_block_stop", index: 0 }),
		event({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: {} }),
		event({ type: "message_stop" }),
		JSON.stringify({ fake: "call", id, name: "lesson", arguments: {} }),
		JSON.stringify({ fake: "reply" }),
	].join("\n"));
	return spawn(process.execPath, [FAKE_CLAUDE, ...args], { cwd: options.cwd, env: { ...options.env, FAKE_CLAUDE_SCENARIO: scenario }, stdio: ["pipe", "pipe", "pipe", "ipc"] }) as never;
};

const APP = `
const url = (file) => new URL(file, ${JSON.stringify(`${pathToFileURL(root).href}/`)}).href;
const chat = await import(url("src/agent/chatgpt-bridge.ts"));
const subscriptions = await import(url("src/server/web-subscriptions.ts"));
const http = await import(url("src/server/web-subscription-http.ts"));
const { refreshConnectionCatalog } = await import(url("src/server/model-catalog.ts"));
const { startSharedProviders } = await import(url("src/server/shared-providers.ts"));
const settings = await import(url("src/store/settings.ts"));
const keys = await import(url("src/server/keys.ts"));
const { streamClaudeCode } = await import(url("src/agent/claude-code/stream.ts"));
const { normalizeContext } = await import(${JSON.stringify(import.meta.resolve("@earendil-works/pi-ai/utils/transcript"))});
const { CLAUDE_CODE_MODELS } = await import(url("src/agent/claude-code/provider.ts"));
startSharedProviders();
const background = chat.chatGPTAbortController(true), foreground = chat.chatGPTAbortController(false);
const request = (command) => new Request("http://127.0.0.1/api/subscriptions", { method: "POST", headers: { host: "127.0.0.1", origin: "http://127.0.0.1", "sec-fetch-site": "same-origin", "x-learnharness-subscriptions": "1", "content-type": "application/json" }, body: JSON.stringify(command) });
const ops = {
	async lease({ model }) { await refreshConnectionCatalog("chatgpt"); return (await chat.chatGPTLease(chat.chatGPTScope(model), false)).accessToken; },
	state: () => ({ connected: chat.chatGPTConnected(), background: background.controller.signal.aborted, foreground: foreground.controller.signal.aborted }),
	async control({ command }) { const response = await http.subscriptionControlsResponse(request(command)); return { status: response.status, body: await response.json() }; },
	saveKey: ({ value }) => keys.saveKey("TAVILY_API_KEY", value).ok,
	key: () => process.env.TAVILY_API_KEY ?? null,
	write: ({ section, value }) => settings.writeSettings({ ...(settings.readSettings() ?? { version: 1 }), [section]: value }),
	settings: () => settings.readSettings(),
	async claude({ answer }) {
		const tool = { name: "lesson", description: "Lesson tool", parameters: { type: "object", properties: {} } };
		const context = (...extra) => normalizeContext({ systemPrompt: "Teach", tools: [tool], messages: [{ role: "user", content: "Go", timestamp: 1 }, ...extra] });
		const first = await streamClaudeCode(CLAUDE_CODE_MODELS[0], context(), { sessionId: answer }).result();
		const call = first.content.find((block) => block.type === "toolCall");
		if (!call) return { error: first.errorMessage ?? "no tool call" };
		const result = { role: "toolResult", toolCallId: call.id, toolName: call.name, content: [{ type: "text", text: answer }], isError: false, timestamp: 2 };
		const second = await streamClaudeCode(CLAUDE_CODE_MODELS[0], context(first, result), { sessionId: answer }).result();
		return { text: second.content.map((block) => block.text ?? "").join(""), error: second.errorMessage };
	},
};
process.on("message", async ({ id, op, ...fields }) => {
	try { process.send({ id, value: await ops[op](fields) }); }
	catch (error) { process.send({ id, error: error.stack }); }
});
process.send({ ready: true });
`;

async function startApp(role: "primary" | "secondary", socket: string, adminSocket: string, shared: string) {
	const home = await fs.mkdtemp(path.join(directory, `${role}-`));
	const script = path.join(home, "app.mts");
	await fs.writeFile(script, APP);
	const child: ChildProcess = spawn(process.execPath, ["--import", pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href, script], {
		cwd: root, stdio: ["ignore", "ignore", "inherit", "ipc"],
		env: {
			PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMPDIR: process.env.TMPDIR, HOME: home, USERPROFILE: home,
			NODE_ENV: "test", LH_DATA_DIR: path.join(home, "state"), LH_AUTH_FILE: path.join(shared, "auth.json"),
			LH_PROVIDER_ROLE: role, LH_PROVIDER_SOCKET: socket, ...(role === "primary" ? { LH_PROVIDER_ADMIN_SOCKET: adminSocket } : {}),
		},
	});
	const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
	let next = 0;
	const ready = new Promise<void>((resolve, reject) => {
		child.on("message", (message: { ready?: boolean; id?: number; value?: unknown; error?: string }) => {
			if (message.ready) { resolve(); return; }
			const call = pending.get(message.id!)!;
			pending.delete(message.id!);
			if (message.error) call.reject(new Error(message.error)); else call.resolve(message.value);
		});
		child.once("exit", (code) => reject(new Error(`app exited ${code}`)));
	});
	await ready;
	return {
		home,
		call: <T = unknown>(op: string, fields: Record<string, unknown> = {}) => new Promise<T>((resolve, reject) => {
			const id = ++next;
			pending.set(id, { resolve: (value) => resolve(value as T), reject });
			child.send({ id, op, ...fields });
		}),
		async stop() { if (child.exitCode === null) { child.kill("SIGKILL"); await once(child, "exit"); } },
	};
}

async function eventually(check: () => Promise<boolean>, label: string): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	assert.fail(label);
}

test("a partial sharing configuration refuses to start", () => {
	assert.equal(providerConnection({}), undefined);
	assert.deepEqual(providerConnection({ LH_PROVIDER_ROLE: "secondary", LH_PROVIDER_SOCKET: "/s" }), { role: "secondary", socket: "/s" });
	for (const env of [{ LH_PROVIDER_ROLE: "primary", LH_PROVIDER_SOCKET: "/s" }, { LH_PROVIDER_ROLE: "secondary" }, { LH_PROVIDER_SOCKET: "/s" }, { LH_PROVIDER_ROLE: "secondary", LH_PROVIDER_SOCKET: "/s", LH_PROVIDER_ADMIN_SOCKET: "/a" }, { LH_PROVIDER_ROLE: "other", LH_PROVIDER_SOCKET: "/s" }]) {
		assert.throws(() => providerConnection(env), /LH_PROVIDER_ROLE/);
	}
});

test("a Claude request cannot add CLI flags, tools or paths", () => {
	const valid = { model: "sonnet", effort: "medium", systemPrompt: "Teach", authorization: `Bearer ${"a".repeat(64)}`, allowedTools: ["mcp__learnharness__read"] };
	assert.deepEqual(parseLaunch({ ...valid, mcpConfigFile: "/etc/passwd" }), valid);
	for (const change of [{ model: "--dangerously-skip-permissions" }, { effort: "x" }, { authorization: "Bearer x" }, { allowedTools: ["Bash"] }, { allowedTools: ["mcp__learnharness__a,Bash"] }, { allowedTools: ["mcp__other__a"] }, { systemPrompt: 1 }]) {
		assert.throws(() => parseLaunch({ ...valid, ...change }), /invalid/);
	}
	assert.throws(() => parseLaunch(null), /invalid/);
});

test("the bundled service starts, reports health and stops", { timeout: 60_000 }, async (t) => {
	// Inside the checkout so the bundle resolves the app's dependencies, as in the image.
	const output = await fs.mkdtemp(path.join(root, ".next-provider-test-"));
	t.after(() => fs.rm(output, { recursive: true, force: true }));
	const bundle = path.join(output, "provider-service.mjs");
	const env: NodeJS.ProcessEnv = {
		PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, NODE_ENV: "test", HOME: output, USERPROFILE: output,
		LH_PROVIDER_SERVICE_SOCKET: socketPath("bundle"), LH_PROVIDER_SERVICE_ADMIN_SOCKET: socketPath("bundle-admin"),
		LH_PROVIDER_SERVICE_CREDENTIALS_DIR: await credentials(),
	};
	const run = async (args: string[]) => { const child = spawn(process.execPath, args, { cwd: root, env, stdio: "ignore" }); return (await once(child, "exit"))[0] as number; };
	assert.equal(await run([path.join(root, "scripts/build-provider-service.mjs"), bundle]), 0);
	const service = spawn(process.execPath, [bundle], { cwd: output, env, stdio: ["ignore", "pipe", "inherit"] });
	t.after(() => service.kill("SIGKILL"));
	const [line] = await Promise.race([once(service.stdout, "data"), once(service, "exit").then(() => assert.fail("the service exited"))]);
	assert.match(String(line), /ready/);
	assert.equal(await run([bundle, "--health"]), 0);
	const exited = once(service, "exit");
	service.kill("SIGTERM");
	const [code] = await exited;
	if (process.platform !== "win32") assert.equal(code, 0);
	assert.equal(await run([bundle, "--health"]), 1);
});

test("two apps share sign-ins, keys and provider settings while lessons stay separate", { timeout: 90_000 }, async (t) => {
	const socket = socketPath("runtime"), adminSocket = socketPath("admin");
	const shared = await fs.mkdtemp(path.join(directory, "shared-"));
	await fs.writeFile(path.join(shared, "auth.json"), "{}", { mode: 0o600 });
	const owner = { directory: await credentials() };
	let service = await startProviderService({ socket, adminSocket, owner, runClaude });
	t.after(() => service.close());
	const [primary, secondary] = await Promise.all([startApp("primary", socket, adminSocket, shared), startApp("secondary", socket, adminSocket, shared)]);
	t.after(() => Promise.all([primary.stop(), secondary.stop()]));

	await t.test("both lease from the one owner, with no refresh in either app", async () => {
		assert.deepEqual(await Promise.all([primary, secondary].map((app) => app.call("lease", { model: model.id }))), ["fixture-chatgpt-access", "fixture-chatgpt-access"]);
		assert.equal(refreshes, 0);
		await assert.rejects(startProviderService({ socket, adminSocket, owner, runClaude }), /already running/);
		assert.deepEqual(await fs.readdir(shared), ["auth.json"]);
	});

	await t.test("simultaneous cold catalogue reads both see the models", async () => {
		const isolated = socketPath("cold");
		const cold = await startProviderService({ socket: isolated, adminSocket: socketPath("cold-admin"), owner: { directory: await credentials() }, runClaude });
		try {
			const read = async () => {
				const raw = net.connect(isolated);
				raw.write(`${JSON.stringify({ id: 1, op: "request", channel: "lh:chatgpt", operation: "models" })}\n`);
				const [reply] = await once(raw, "data");
				raw.destroy();
				return JSON.parse(String(reply)).value.models.length;
			};
			assert.deepEqual(await Promise.all([read(), read()]), [1, 1]);
		} finally { await cold.close(); }
	});

	await t.test("the secondary cannot manage sign-ins; a primary change reaches both", async () => {
		const refused = await secondary.call<{ status: number }>("control", { command: { providerId: "chatgpt", op: "consent", enabled: false } });
		assert.equal(refused.status, 403);
		// Even a compromised secondary only holds the runtime socket.
		const raw = net.connect(socket);
		raw.write(`${JSON.stringify({ id: 1, op: "control", providerId: "chatgpt", command: { op: "consent", enabled: false }, origin: "x" })}\n`);
		const [reply] = await once(raw, "data");
		raw.destroy();
		assert.equal(JSON.parse(String(reply)).ok, false);
		assert.deepEqual(await secondary.call("state"), { connected: true, background: false, foreground: false });
		assert.equal((await primary.call<{ status: number }>("control", { command: { providerId: "chatgpt", op: "consent", enabled: false } })).status, 200);
		for (const app of [primary, secondary]) await eventually(async () => (await app.call<{ background: boolean }>("state")).background, "background use was not revoked");
		assert.equal((await secondary.call<{ foreground: boolean }>("state")).foreground, false);
	});

	await t.test("keys and provider settings follow the primary; other settings do not", async () => {
		assert.equal(await primary.call("saveKey", { value: "tvly-fake-key-1234567890" }), true);
		await eventually(async () => await secondary.call("key") === "tvly-fake-key-1234567890", "key did not arrive");
		assert.equal(await primary.call("saveKey", { value: "tvly-fake-key-0987654321" }), true);
		await eventually(async () => await secondary.call("key") === "tvly-fake-key-0987654321", "changed key did not arrive");
		await primary.call("write", { section: "claudeCode", value: { enabled: true } });
		await primary.call("write", { section: "appearance", value: { proseFontSize: 20 } });
		const copied = await secondary.call<Record<string, unknown>>("settings");
		assert.deepEqual(copied.claudeCode, { enabled: true });
		assert.equal(copied.appearance, undefined);
		await secondary.call("write", { section: "appearance", value: { proseFontSize: 18 } });
		const stored = JSON.parse(await fs.readFile(path.join(secondary.home, "state/settings.json"), "utf8"));
		assert.deepEqual(stored, { version: 1, appearance: { proseFontSize: 18 } });
		await assert.rejects(secondary.call("saveKey", { value: "tvly-fake-key-1111111111" }), /primary/);
		await secondary.call("write", { section: "claudeCode", value: { enabled: false } });
		assert.deepEqual((await primary.call<Record<string, unknown>>("settings")).claudeCode, { enabled: true });
	});

	await t.test("concurrent Claude turns reach only their own lesson's tools", async () => {
		const results = await Promise.all([primary.call("claude", { answer: "AZ lesson" }), secondary.call("claude", { answer: "ML lesson" })]);
		assert.deepEqual(results, [{ text: "AZ lesson" }, { text: "ML lesson" }]);
		assert.equal(launches.length, 2);
		for (const args of launches) assert.equal(args[args.indexOf("--tools") + 1], "");
	});

	await t.test("losing the service disconnects both apps; a restart restores them", async () => {
		await service.close();
		for (const app of [primary, secondary]) {
			await eventually(async () => (await app.call<{ connected: boolean }>("state")).connected === false, "still connected");
			assert.equal((await app.call<{ foreground: boolean }>("state")).foreground, true);
		}
		service = await startProviderService({ socket, adminSocket, owner, runClaude });
		for (const app of [primary, secondary]) {
			await eventually(async () => (await app.call<{ connected: boolean }>("state")).connected, "did not reconnect");
			assert.equal(await app.call("lease", { model: model.id }), "fixture-chatgpt-access");
		}
	});
});
