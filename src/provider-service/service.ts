/** Owns subscription credentials and refresh for every study instance.
 * Only the admin socket accepts sign-in commands; a secondary container never
 * receives it. */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { publicError as chatGPTError } from "../../electron/chatgpt.cjs";
import { publicError as nativeError } from "../../electron/subscriptions.cjs";
import { readSocketLines, writeSocketLine } from "../core/socket-lines.ts";
import { createWebSubscriptionOwner } from "../server/web-subscriptions.ts";
import type { SubscriptionRuntimeChannel as Channel } from "../agent/subscription-runtime.ts";
import type { RunClaude } from "../agent/claude-code/stream.ts";
import { serveClaude } from "./claude-session.ts";

type Owner = ReturnType<typeof createWebSubscriptionOwner>;
type OwnerOptions = Omit<Parameters<typeof createWebSubscriptionOwner>[0], "onPacket">;
type Message = Record<string, unknown>;

/** Two owners would refresh the same credentials against each other. */
async function refuseSecondOwner(socket: string): Promise<void> {
	const answered = await new Promise<boolean>((resolve) => {
		const probe = net.connect(socket);
		probe.once("connect", () => { probe.destroy(); resolve(true); });
		probe.once("error", () => resolve(false));
	});
	if (answered) throw new Error("Another provider service is already running.");
}

async function listen(server: net.Server, socket: string): Promise<void> {
	if (process.platform !== "win32") {
		// A killed service leaves its socket behind. Replace only a socket, never a file.
		const existing = fs.lstatSync(socket, { throwIfNoEntry: false });
		if (existing?.isSocket()) fs.unlinkSync(socket);
		else if (existing) throw new Error(`${path.basename(socket)} exists and is not a socket.`);
	}
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(socket, () => { server.removeListener("error", reject); resolve(); });
	});
	if (process.platform !== "win32") fs.chmodSync(socket, 0o600);
}

/** A status with the revision it belongs to, even if it changes while being read. */
async function stampedStatus(owner: Owner) {
	for (;;) {
		const { revision } = owner.chatgpt.stamp();
		const status = await owner.chatgpt.status();
		const stamp = owner.chatgpt.stamp();
		if (stamp.revision === revision) return { status, stamp };
	}
}

async function runtimeCall(owner: Owner, message: Message): Promise<unknown> {
	if (message.op === "status") return owner.status();
	if (message.op !== "request") throw new Error("Unsupported operation.");
	const channel = message.channel as Channel;
	if (channel === "lh:chatgpt" && message.operation === "status") {
		const { status, stamp } = await stampedStatus(owner);
		return { status, ...stamp };
	}
	try { return await owner.request(channel, String(message.operation), (message.fields ?? {}) as Message); }
	catch (error) { throw new Error(channel === "lh:chatgpt" ? chatGPTError(error) : nativeError(error)); }
}

async function adminCall(owner: Owner, message: Message): Promise<unknown> {
	if (message.op === "control") return owner.control(String(message.providerId), (message.command ?? {}) as Message, String(message.origin));
	if (message.op === "browser") return owner.takeBrowserAction(String(message.action), String(message.origin));
	throw new Error("Unsupported operation.");
}

/** State first, then the acknowledgement that lets the app send requests. */
async function greet(owner: Owner, socket: net.Socket, packets: boolean): Promise<void> {
	try {
		if (packets) {
			const { status, stamp } = await stampedStatus(owner);
			writeSocketLine(socket, { channel: "lh:chatgpt", packet: { channel: "lh:chatgpt", kind: "state", stamp, status, invalidate: "none" } });
			const snapshot = await owner.native.snapshot();
			writeSocketLine(socket, { channel: "lh:subscriptions", packet: { channel: "lh:subscriptions", op: "changed", snapshot } });
		}
		writeSocketLine(socket, { hello: true });
	} catch { socket.destroy(); }
}

export async function startProviderService(options: { socket: string; adminSocket: string; owner: OwnerOptions; runClaude: RunClaude }) {
	await refuseSecondOwner(options.socket);
	const observers = new Set<net.Socket>();
	// The owner lets a newer catalogue read supersede an older one. Two apps
	// reading together share one read, so neither sees an empty catalogue.
	let catalogue: Promise<unknown> | undefined;
	const sockets = new Set<net.Socket>();
	const owner = createWebSubscriptionOwner({
		...options.owner,
		onPacket: (channel, packet) => {
			if (packet.invalidate === "all") catalogue = undefined;
			for (const socket of observers) writeSocketLine(socket, { channel, packet });
		},
	});

	function sharedRuntimeCall(current: Owner, message: Message): Promise<unknown> {
		if (message.op !== "request" || message.channel !== "lh:chatgpt" || message.operation !== "models") return runtimeCall(current, message);
		if (catalogue) return catalogue;
		const read = runtimeCall(current, message).finally(() => { if (catalogue === read) catalogue = undefined; });
		return catalogue = read;
	}

	function serve(call: typeof runtimeCall, admin: boolean): net.Server {
		return net.createServer((socket) => {
			sockets.add(socket);
			socket.on("error", () => { /* close follows */ });
			socket.once("close", () => { sockets.delete(socket); observers.delete(socket); });
			let claude: ((message: Message) => void) | undefined;
			readSocketLines(socket, (message) => {
				if (claude) claude(message);
				else if (message.op === "health") writeSocketLine(socket, { hello: true });
				else if (message.op === "claude" && !admin) claude = serveClaude(socket, message.launch, options.runClaude);
				else if (message.op === "hello") {
					const packets = message.packets === true && !admin;
					if (packets) observers.add(socket);
					void greet(owner, socket, packets);
				} else call(owner, message).then(
					(value) => writeSocketLine(socket, { id: message.id, ok: true, value }),
					(error: unknown) => writeSocketLine(socket, { id: message.id, ok: false, error: error instanceof Error ? error.message : undefined }),
				);
			});
		});
	}

	const runtime = serve(sharedRuntimeCall, false), admin = serve(adminCall, true);
	await listen(runtime, options.socket);
	await listen(admin, options.adminSocket);
	return {
		owner,
		async close(): Promise<void> {
			owner.close();
			for (const socket of sockets) socket.destroy();
			await Promise.all([runtime, admin].map((server) => new Promise((resolve) => server.close(resolve))));
		},
	};
}
