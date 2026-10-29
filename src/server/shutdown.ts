interface ShutdownState {
	draining: boolean;
	cleanup: Set<() => void>;
}
const KEY = Symbol.for("lh.serverShutdown");

function state(): ShutdownState {
	const global = globalThis as typeof globalThis & { [KEY]?: ShutdownState };
	if (global[KEY]) return global[KEY];
	const current: ShutdownState = { draining: false, cleanup: new Set() };
	global[KEY] = current;
	const drain = () => {
		if (current.draining) return;
		current.draining = true;
		const callbacks = [...current.cleanup];
		current.cleanup.clear();
		for (const close of callbacks) {
			try { close(); } catch { console.error("[shutdown] cleanup failed"); }
		}
	};
	process.once("SIGTERM", drain);
	process.once("SIGINT", drain);
	return current;
}

/** Initialise before requests arrive, including a route's first lazy import. */
export function registerServerShutdown(): void { state(); }

export function serverIsShuttingDown(): boolean { return state().draining; }

/** Stop owned admission/transports while Next drains its HTTP requests. */
export function onServerShutdown(close: () => void): () => void {
	const current = state();
	if (current.draining) { close(); return () => {}; }
	current.cleanup.add(close);
	return () => { current.cleanup.delete(close); };
}
