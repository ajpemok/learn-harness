import { build } from "esbuild";
import * as path from "node:path";

// A separate process in the same image.
const root = path.resolve(import.meta.dirname, "..");
const outfile = path.resolve(root, process.argv[2] ?? ".next/standalone/provider-service.mjs");
await build({
	absWorkingDir: root,
	entryPoints: ["src/provider-service/main.ts"],
	outfile,
	bundle: true,
	// Only the Pi SDK ships unbundled in the image; Next folds the rest into its chunks.
	external: ["@earendil-works/*"],
	platform: "node",
	format: "esm",
	target: "node26",
	// The bundled sign-in modules are CommonJS and require Node built-ins.
	banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
});
console.log("[provider-service] Bundled the shared provider service.");
