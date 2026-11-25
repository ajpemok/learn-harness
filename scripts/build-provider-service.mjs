import { build } from "esbuild";
import * as path from "node:path";

// A separate process in the same image, using the app's traced dependencies.
const root = path.resolve(import.meta.dirname, "..");
await build({
	absWorkingDir: root,
	entryPoints: ["src/provider-service/main.ts"],
	outfile: path.join(root, ".next/standalone/provider-service.mjs"),
	bundle: true,
	packages: "external",
	platform: "node",
	format: "esm",
	target: "node26",
});
console.log("[provider-service] Bundled the shared provider service.");
