/** Keeps this instance in step with the files the primary instance writes. */
import fs from "node:fs";
import { AUTH_FILE, SHARED_PROVIDER_SETTINGS_FILE } from "../../config.ts";
import { emit } from "../core/events.ts";
import { providerConnection } from "../core/provider-role.ts";
import { reloadSharedKeys } from "./keys.ts";
import { onServerShutdown } from "./shutdown.ts";
import { webSubscriptionOwner } from "./web-subscriptions.ts";

const POLL_MS = 1_000;

/** Throws on a partial sharing configuration, before any request is served. */
export function startSharedProviders(): void {
	if (!providerConnection()) return;
	const owner = webSubscriptionOwner();
	// The service may start later. The client keeps retrying.
	if ("open" in owner) owner.open().catch(() => { /* retried */ });
	const files = [AUTH_FILE, SHARED_PROVIDER_SETTINGS_FILE];
	// Polling follows atomic renames by path, including through a container bind.
	for (const file of files) {
		fs.watchFile(/* turbopackIgnore: true */ file, { interval: POLL_MS, persistent: false }, () => {
			reloadSharedKeys();
			emit("subscriptions-changed", {});
		});
	}
	onServerShutdown(() => { for (const file of files) fs.unwatchFile(file); });
}
