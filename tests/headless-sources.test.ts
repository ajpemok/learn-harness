import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveSourcePath } from "../src/agent/tools/fs-shared.ts";
import { readTool } from "../src/agent/tools/read.ts";
import { lsTool } from "../src/agent/tools/ls.ts";
import { findTool } from "../src/agent/tools/find.ts";
import { grepTool } from "../src/agent/tools/grep.ts";

test("server study files cannot escape through absolute paths, traversal or symlinked parents", async () => {
	const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "lh-study-root-"));
	const root = path.join(scratch, "sources");
	const secret = path.join(scratch, "auth.json");
	const previous = process.env.LH_SOURCES_DIR;
	try {
		await fs.mkdir(root);
		await fs.writeFile(secret, "SECRET_CANARY");
		await fs.writeFile(path.join(root, "notes.txt"), "study material");
		process.env.LH_SOURCES_DIR = root;
		assert.equal(resolveSourcePath(), await fs.realpath(root));
		assert.equal(resolveSourcePath("notes.txt"), await fs.realpath(path.join(root, "notes.txt")));
		for (const outside of [secret, "../auth.json"]) {
			assert.throws(() => resolveSourcePath(outside), /study folder/);
			for (const [tool, input] of [[readTool, { path: outside }], [lsTool, { path: outside }], [findTool, { path: outside, pattern: "*" }], [grepTool, { path: outside, pattern: "SECRET" }]] as const) {
				await assert.rejects(async () => tool.execute!("scope-test", input as never), /study folder/);
			}
		}
		// Windows junctions need no symlink privilege and exercise a symlinked parent.
		await fs.symlink(scratch, path.join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
		assert.throws(() => resolveSourcePath("escape/auth.json"), /study folder/);
		assert.throws(() => resolveSourcePath("escape"), /study folder/);
		if (process.platform !== "win32") {
			await fs.symlink(secret, path.join(root, "secret.txt"));
			assert.throws(() => resolveSourcePath("secret.txt"), /study folder/);
		}
		process.env.LH_SOURCES_DIR = "";
		assert.throws(() => resolveSourcePath("notes.txt"), /absolute study folder/);
		delete process.env.LH_SOURCES_DIR;
		assert.equal(resolveSourcePath(), os.homedir(), "desktop default remains unchanged");
	} finally {
		if (previous === undefined) delete process.env.LH_SOURCES_DIR;
		else process.env.LH_SOURCES_DIR = previous;
		await fs.rm(scratch, { recursive: true, force: true });
	}
});
