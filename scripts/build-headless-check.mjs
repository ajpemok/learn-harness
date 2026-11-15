import { build } from "esbuild";
import * as path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
await build({
	absWorkingDir: root,
	entryPoints: ["tests/headless-image-runtime.ts"],
	outfile: path.join(root, ".next/headless-check/headless-image-check.mjs"),
	bundle: true,
	packages: "external",
	platform: "node",
	format: "esm",
	target: "node26",
});
console.log("[headless-check] Bundled production renderer functions for the final Linux image.");
