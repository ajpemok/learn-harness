/** One Claude Code process for one lesson. The service owns the CLI sign-in and
 * builds the arguments and files. The lesson's tools stay in its own app: the
 * CLI reaches them through a tunnel that exists only for this connection. */
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";
import { ClaudeCodeError } from "../agent/claude-code/constants.ts";
import { ClaudeLaunchError } from "../agent/claude-code/launch.ts";
import { createTurnFiles, removeTurnFiles, toClaudeArgs, toClaudeEnv, type ClaudeLaunch, type RunClaude } from "../agent/claude-code/stream.ts";
import { BRIDGE_SERVER_NAME, toMcpConfig } from "../agent/claude-code/tool-bridge.ts";
import { writeSocketLine } from "../core/socket-lines.ts";

const START_FAILED = "claude CLI failed to start";
const EFFORTS = new Set<unknown>(["low", "medium", "high", "xhigh", "max"]);
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._[\]-]*$/;
const AUTHORIZATION = /^Bearer [0-9a-f]{64}$/;
// The CLI receives these as one comma-separated value.
const TOOL = new RegExp(`^mcp__${BRIDGE_SERVER_NAME}__[^,\\s()]+$`);

/** The app names a model and its own tools, never CLI flags or paths. */
export function parseLaunch(raw: unknown): ClaudeLaunch {
	const { model, effort, systemPrompt, authorization, allowedTools } = (raw ?? {}) as Partial<ClaudeLaunch>;
	if (typeof model !== "string" || !MODEL.test(model) || !effort || !EFFORTS.has(effort) || typeof systemPrompt !== "string"
		|| typeof authorization !== "string" || !AUTHORIZATION.test(authorization)
		|| !Array.isArray(allowedTools) || !allowedTools.every((tool) => typeof tool === "string" && TOOL.test(tool))) {
		throw new ClaudeLaunchError("The Claude Code request is invalid.");
	}
	return { model, effort, systemPrompt, authorization, allowedTools };
}

export function serveClaude(socket: net.Socket, raw: unknown, runClaude: RunClaude): (message: Record<string, unknown>) => void {
	const abort = new AbortController();
	const tunnels = new Map<number, net.Socket>();
	let child: ChildProcessWithoutNullStreams | undefined;
	let killTimer: ReturnType<typeof setTimeout> | undefined;
	let tunnelCount = 0;
	const send = (message: unknown) => writeSocketLine(socket, message);
	const tunnel = net.createServer((connection) => {
		const id = ++tunnelCount;
		tunnels.set(id, connection);
		send({ t: "mcp-open", id });
		connection.on("data", (data) => send({ t: "mcp", id, data: data.toString("base64") }));
		connection.on("error", () => { /* close follows */ });
		connection.once("close", () => { if (tunnels.delete(id)) send({ t: "mcp-close", id }); });
	});
	function stopChild() {
		if (!child) return;
		child.kill();
		killTimer = setTimeout(() => child?.kill("SIGKILL"), 1000);
		killTimer.unref();
	}
	socket.once("close", () => {
		abort.abort();
		for (const connection of tunnels.values()) connection.destroy();
		tunnel.close();
		// Paused output would hold back the exit that removes this turn's files.
		child?.stdout.resume();
		child?.stderr.resume();
		stopChild();
	});

	async function run() {
		const launch = parseLaunch(raw);
		await new Promise<void>((resolve, reject) => { tunnel.once("error", reject); tunnel.listen(0, "127.0.0.1", resolve); });
		const { port } = tunnel.address() as net.AddressInfo;
		const files = await createTurnFiles(launch.systemPrompt, toMcpConfig(port, launch.authorization));
		try {
			const args = toClaudeArgs({ ...launch, systemPromptFile: files.systemPromptFile, mcpConfigFile: files.mcpConfigFile });
			const started = await runClaude(args, { cwd: files.cwd, env: toClaudeEnv(), signal: abort.signal });
			if (!started) throw new ClaudeLaunchError(ClaudeCodeError.CliNotFound);
			child = started;
		} catch (error) {
			await removeTurnFiles(files);
			throw error;
		}
		const running = child;
		for (const name of ["stdout", "stderr"] as const) {
			running[name].on("data", (data: Buffer) => {
				if (send({ t: name, data: data.toString("base64") }) || !socket.writable) return;
				running[name].pause();
				socket.once("drain", () => running[name].resume());
			});
		}
		running.stdin.on("error", () => { /* the exit reports it */ });
		running.once("error", () => send({ t: "error", message: START_FAILED }));
		running.once("close", (code: number | null) => {
			clearTimeout(killTimer);
			child = undefined;
			tunnel.close();
			void removeTurnFiles(files);
			send({ t: "close", code });
			socket.end();
		});
		send({ t: "started" });
		// The app may have gone while the CLI was starting.
		if (abort.signal.aborted) stopChild();
	}
	run().catch((error: unknown) => {
		if (tunnel.listening) tunnel.close();
		send({ t: "error", message: error instanceof ClaudeLaunchError ? error.message : START_FAILED });
		socket.end();
	});

	return (message) => {
		const data = typeof message.data === "string" ? Buffer.from(message.data, "base64") : undefined;
		const id = message.id as number;
		if (message.t === "stdin" && data) child?.stdin.write(data);
		else if (message.t === "kill") child?.kill(message.signal === "SIGKILL" ? "SIGKILL" : "SIGTERM");
		else if (message.t === "mcp" && data) tunnels.get(id)?.write(data);
		else if (message.t === "mcp-close") { const connection = tunnels.get(id); tunnels.delete(id); connection?.end(); }
	};
}
