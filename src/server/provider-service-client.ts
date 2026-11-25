/** App side of the shared provider service. Replies and revocation packets use
 * one ordered connection, so a reply cannot overtake an earlier revocation. */
import net from "node:net";
import { readSocketLines, writeSocketLine } from "../core/socket-lines.ts";
import type { SubscriptionRuntimeChannel as Channel, SubscriptionRuntimePacket as Packet } from "../agent/subscription-runtime.ts";
import type { ChatGPTStatus } from "../core/contracts/chatgpt.ts";
import type { NativeSubscriptionSnapshot } from "../core/contracts/subscriptions.ts";

const REQUEST_TIMEOUT_MS = 45_000;
const RECONNECT_MS = 1_000;
const UNAVAILABLE = "The shared provider service is unavailable.";

interface Pending { resolve(value: unknown): void; reject(error: Error): void; timer?: ReturnType<typeof setTimeout> }
interface ConnectionOptions { packets: boolean; onPacket(channel: Channel, packet: Packet): void; onLost(): void }

/** `packets` connections receive state and reconnect; the admin one only sends commands. */
function createConnection(path: string, options: ConnectionOptions) {
	let socket: net.Socket | undefined;
	let opening: Promise<void> | undefined;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let closed = false, counter = 0;
	const pending = new Map<number, Pending>();

	function open(): Promise<void> {
		if (closed) return Promise.reject(new Error("The server is shutting down."));
		return opening ??= new Promise<void>((resolve, reject) => {
			clearTimeout(retry);
			const current = net.connect(path);
			socket = current;
			let ready = false;
			const timer = setTimeout(() => current.destroy(), REQUEST_TIMEOUT_MS);
			current.on("error", () => { /* close follows */ });
			current.once("connect", () => writeSocketLine(current, { op: "hello", packets: options.packets }));
			readSocketLines(current, (message) => {
				if (message.packet) { options.onPacket(message.channel as Channel, message.packet as Packet); return; }
				if (message.hello) { ready = true; clearTimeout(timer); resolve(); return; }
				const call = pending.get(message.id as number);
				if (!call) return;
				pending.delete(message.id as number);
				clearTimeout(call.timer);
				if (message.ok) call.resolve(message.value);
				else call.reject(new Error(typeof message.error === "string" ? message.error : "The provider service request failed."));
			});
			current.once("close", () => {
				clearTimeout(timer);
				socket = undefined;
				opening = undefined;
				for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error(UNAVAILABLE)); }
				pending.clear();
				reject(new Error(UNAVAILABLE));
				// State packets can arrive before the acknowledgement, so any loss invalidates them.
				if (options.packets || ready) options.onLost();
				if (options.packets && !closed) {
					retry = setTimeout(() => { open().catch(() => { /* the next close retries */ }); }, RECONNECT_MS);
					retry.unref();
				}
			});
		});
	}
	return {
		open,
		async call<T>(op: string, fields: Record<string, unknown>, timeout?: number): Promise<T> {
			await open();
			const target = socket;
			if (!target) throw new Error(UNAVAILABLE);
			return new Promise<T>((resolve, reject) => {
				const id = ++counter;
				const timer = timeout === undefined ? undefined
					: setTimeout(() => { pending.delete(id); reject(new Error("The shared provider service timed out.")); }, timeout);
				pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
				writeSocketLine(target, { ...fields, id, op });
			});
		},
		close() { closed = true; clearTimeout(retry); socket?.destroy(); },
	};
}

export interface ProviderServiceStatus { chatgpt: ChatGPTStatus; native: NativeSubscriptionSnapshot["statuses"] }

export function createProviderServiceClient(options: {
	socket: string;
	adminSocket?: string;
	onPacket(channel: Channel, packet: Packet): void;
	onLost(): void;
}) {
	const runtime = createConnection(options.socket, { packets: true, onPacket: options.onPacket, onLost: options.onLost });
	const admin = options.adminSocket === undefined ? undefined
		: createConnection(options.adminSocket, { packets: false, onPacket: () => {}, onLost: () => {} });
	function managed() {
		if (!admin) throw new Error("Provider sign-ins are managed on the primary instance.");
		return admin;
	}
	return {
		open: () => runtime.open(),
		status: () => runtime.call<ProviderServiceStatus>("status", {}, REQUEST_TIMEOUT_MS),
		request: <T>(channel: Channel, operation: string, fields: Record<string, unknown>) =>
			runtime.call<T>("request", { channel, operation, fields }, REQUEST_TIMEOUT_MS),
		// Native sign-in commands stay open until the learner finishes or cancels.
		control: async (providerId: string, command: Record<string, unknown>, origin: string) =>
			managed().call<{ value: unknown; browserAction?: string }>("control", { providerId, command, origin }),
		takeBrowserAction: async (action: string, origin: string) =>
			managed().call<string | undefined>("browser", { action, origin }, REQUEST_TIMEOUT_MS),
		close() { runtime.close(); admin?.close(); },
	};
}
