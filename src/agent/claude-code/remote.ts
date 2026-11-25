/** Runs Claude Code in the shared provider service. It looks like a local child
 * process to the stream; the tool bridge stays on this app's loopback. */
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import net from "node:net";
import { PassThrough, Writable } from "node:stream";
import { readSocketLines, writeSocketLine } from "../../core/socket-lines.ts";
import { ClaudeLaunchError } from "./launch.ts";
import type { RunClaude } from "./stream.ts";

// Covers the version check and spawn, not the turn.
const LAUNCH_TIMEOUT_MS = 30_000;

export function createRemoteClaudeLauncher(socketPath: string): RunClaude {
	return (_args, { remote, signal }) => new Promise((resolve, reject) => {
		if (signal?.aborted) { reject(new ClaudeLaunchError("Request was aborted")); return; }
		if (!remote) { reject(new ClaudeLaunchError("The shared Claude Code service needs a launch request.")); return; }
		const socket = net.connect(socketPath);
		const tunnels = new Map<number, net.Socket>();
		let started = false, finished = false;
		const stdout = new PassThrough(), stderr = new PassThrough();
		const child = Object.assign(new EventEmitter(), {
			stdout, stderr,
			stdin: new Writable({
				write(chunk: Buffer, _encoding, done) { writeSocketLine(socket, { t: "stdin", data: Buffer.from(chunk).toString("base64") }); done(); },
			}),
			kill(name?: NodeJS.Signals) { writeSocketLine(socket, { t: "kill", signal: name }); return !finished; },
		});
		// Once started, the turn cancels through kill() like any other child.
		const abort = () => socket.destroy();
		const launchTimer = setTimeout(abort, LAUNCH_TIMEOUT_MS);
		signal?.addEventListener("abort", abort, { once: true });

		function openTunnel(id: number) {
			const connection = net.connect(remote!.bridgePort, "127.0.0.1");
			tunnels.set(id, connection);
			connection.on("data", (data) => writeSocketLine(socket, { t: "mcp", id, data: data.toString("base64") }));
			connection.on("error", () => { /* close follows */ });
			connection.once("close", () => { if (tunnels.delete(id)) writeSocketLine(socket, { t: "mcp-close", id }); });
		}
		function finish(code: number | null) {
			if (finished) return;
			finished = true;
			for (const connection of tunnels.values()) connection.destroy();
			tunnels.clear();
			stderr.end();
			// Deliver buffered output before the exit, as a real child process does.
			stdout.once("end", () => setImmediate(() => child.emit("close", code)));
			stdout.end();
			socket.end();
		}
		function refuse(message: string) {
			clearTimeout(launchTimer);
			signal?.removeEventListener("abort", abort);
			finished = true;
			reject(new ClaudeLaunchError(message));
			socket.destroy();
		}

		socket.on("error", () => { /* close follows */ });
		socket.once("connect", () => writeSocketLine(socket, { op: "claude", launch: remote.launch }));
		socket.once("close", () => {
			if (started) finish(null);
			else if (!finished) refuse(signal?.aborted ? "Request was aborted" : "The shared Claude Code service is unavailable.");
		});
		readSocketLines(socket, (message) => {
			const data = typeof message.data === "string" ? Buffer.from(message.data, "base64") : undefined;
			const id = message.id as number;
			if (message.t === "started") {
				started = true;
				clearTimeout(launchTimer);
				signal?.removeEventListener("abort", abort);
				resolve(child as unknown as ChildProcessWithoutNullStreams);
			} else if (message.t === "stdout" && data) stdout.write(data);
			else if (message.t === "stderr" && data) stderr.write(data);
			else if (message.t === "mcp-open") openTunnel(id);
			else if (message.t === "mcp" && data) tunnels.get(id)?.write(data);
			else if (message.t === "mcp-close") { const connection = tunnels.get(id); tunnels.delete(id); connection?.end(); }
			else if (message.t === "close") finish(typeof message.code === "number" ? message.code : null);
			else if (message.t === "error") {
				if (started) child.emit("error", new Error(String(message.message)));
				else refuse(String(message.message));
			}
		});
	});
}
