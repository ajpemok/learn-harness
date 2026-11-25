import net from "node:net";
import { createClaudeLauncher } from "../agent/claude-code/launch.ts";
import { startProviderService } from "./service.ts";

function required(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`Set ${name}.`);
	return value;
}

// Distinct from the app's LH_PROVIDER_* names: this process is not an app instance.
const socket = required("LH_PROVIDER_SERVICE_SOCKET"), adminSocket = required("LH_PROVIDER_SERVICE_ADMIN_SOCKET");

if (process.argv.includes("--health")) {
	const probe = net.connect(socket, () => probe.write(`${JSON.stringify({ op: "health" })}\n`));
	probe.setTimeout(4000, () => process.exit(1));
	probe.once("data", () => process.exit(0));
	probe.once("error", () => process.exit(1));
} else {
	const service = await startProviderService({
		socket, adminSocket,
		owner: { directory: required("LH_PROVIDER_SERVICE_CREDENTIALS_DIR") },
		runClaude: createClaudeLauncher(),
	});
	// Exit when the last credential write and Claude process finish, inside
	// Docker's 45-second stop limit. Exiting sooner could lose a rotated token.
	const stop = () => {
		setTimeout(() => process.exit(1), 30_000).unref();
		void service.close();
	};
	process.once("SIGTERM", stop);
	process.once("SIGINT", stop);
	console.log("[provider-service] ready");
}
