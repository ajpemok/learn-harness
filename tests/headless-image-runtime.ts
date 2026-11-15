/** Run in the final Linux image as node with Docker networking disabled. */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { browserServiceBinary, realHeadless, resolveChromeExecutablePath } from "../src/agent/subagents/headless.ts";
import { tinyPdf } from "./helpers/tiny-pdf.ts";

assert.equal(process.platform, "linux", "Run this check in the Linux image.");
assert.equal(os.userInfo().username, "node", "Run as the image's node user.");
assert.ok(Object.values(os.networkInterfaces()).flat().every(address => address?.internal), "Use docker run --network none.");
assert.equal(browserServiceBinary(), null, "The headless image must use its installed Chromium.");
assert.equal(resolveChromeExecutablePath(), "/usr/bin/chromium");

const timer = setTimeout(() => { console.error("[headless-check] Timed out."); process.exit(1); }, 45_000);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lh-headless-check-"));
function pngDimensions(png: Buffer): [number, number] {
	assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
	return [png.readUInt32BE(16), png.readUInt32BE(20)];
}
try {
	const pdf = path.join(directory, "synthetic.pdf");
	fs.writeFileSync(pdf, tinyPdf([{ runs: [{ text: "Synthetic renderer check", x: 72, y: 720 }] }]));
	const pages = await realHeadless.renderPdfPages(pdf, [1], { dpi: 72 });
	assert.equal(pages.length, 1);
	assert.deepEqual(pngDimensions(pages[0]!.png), [612, 792]);
	const svg = await realHeadless.renderSvg('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect width="32" height="24" fill="blue"/></svg>', { nativeOnly: true });
	assert.deepEqual(pngDimensions(svg), [32, 24]);
	const demo = await realHeadless.runDemo('<output id="value">0</output><script>document.querySelector("#value").textContent = "42";</script>', {
		settleMs: 20, probe: '({ origin: location.origin, value: document.querySelector("#value").textContent })',
	});
	assert.equal(demo.ok, true, JSON.stringify(demo));
	assert.deepEqual(demo.probeResult, { origin: "null", value: "42" });
	const canary = path.join(directory, "canary.txt");
	fs.writeFileSync(canary, "SYNTHETIC_FILE_CANARY");
	const refusal = await realHeadless.runDemo("<p>File access check</p>", {
		settleMs: 20,
		probe: `(async () => { try { return (await (await fetch(${JSON.stringify(pathToFileURL(canary).href)})).text()).includes("SYNTHETIC_FILE_CANARY"); } catch { return false; } })()`,
	});
	assert.deepEqual(refusal.pageErrors, []);
	assert.equal(refusal.probeResult, false, "The production demo must refuse local file reads.");
	console.log("[headless-check] Native PDF/SVG rendering, Chromium execution and file-read refusal passed.");
} finally {
	clearTimeout(timer);
	fs.rmSync(directory, { recursive: true, force: true });
}
