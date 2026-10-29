export async function register() {
	if (process.env.NEXT_RUNTIME === "nodejs") {
		const { registerServerShutdown } = await import("./src/server/shutdown.ts");
		registerServerShutdown();
	}
}
