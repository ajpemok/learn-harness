/** Two study instances can share one provider service. The primary manages the
 * shared keys, sign-ins and provider settings; a secondary only reads them. */
export type ProviderRole = "primary" | "secondary";

/** Settings sections that follow the primary instance. */
export const SHARED_PROVIDER_SECTIONS = ["models", "claudeCode", "customProvider"] as const;

export const PROVIDERS_MANAGED_MESSAGE = "Provider settings are managed on the primary Learn Harness instance.";

type Env = Record<string, string | undefined>;

/** Unset means an ordinary instance that owns its own providers. A partial
 * configuration throws: falling back would start a second credential owner. */
export function providerConnection(env: Env = process.env): { role: ProviderRole; socket: string; adminSocket?: string } | undefined {
	const { LH_PROVIDER_ROLE: role, LH_PROVIDER_SOCKET: socket, LH_PROVIDER_ADMIN_SOCKET: adminSocket } = env;
	if (role === undefined && socket === undefined && adminSocket === undefined) return undefined;
	if (role === "primary" && socket && adminSocket) return { role, socket, adminSocket };
	if (role === "secondary" && socket && adminSocket === undefined) return { role, socket };
	throw new Error("Set LH_PROVIDER_ROLE=primary with LH_PROVIDER_SOCKET and LH_PROVIDER_ADMIN_SOCKET, or LH_PROVIDER_ROLE=secondary with LH_PROVIDER_SOCKET only.");
}

export function providersReadOnly(env: Env = process.env): boolean {
	return providerConnection(env)?.role === "secondary";
}
