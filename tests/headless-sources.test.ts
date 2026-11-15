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
import { fileAccessPolicy, resolvePolicy, setFileAccessPolicy } from "../src/agent/tools/file-access.ts";
import { sourceSearchRoots } from "../src/agent/tools/fs-shared.ts";

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

test("headless listings and searches intersect optional folders without widening the study boundary", async () => {
	const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "lh-study-policy-")));
	const root = path.join(scratch, "sources");
	const course = path.join(root, "course");
	const outside = path.join(scratch, "outside");
	const previousRoot = process.env.LH_SOURCES_DIR;
	const previousPolicy = fileAccessPolicy();
	const text = async (tool: typeof lsTool | typeof findTool | typeof grepTool, input: Record<string, string>) => {
		const result = await tool.execute!("headless-policy", input as never);
		return result.content.map(part => part.type === "text" ? part.text : "").join("\n");
	};
	try {
		await fs.mkdir(course, { recursive: true });
		await fs.mkdir(outside);
		await fs.writeFile(path.join(course, "notes.txt"), "STUDY_MARKER");
		await fs.writeFile(path.join(outside, "secret.txt"), "OUTSIDE_MARKER");
		await fs.symlink(outside, path.join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
		process.env.LH_SOURCES_DIR = root;
		setFileAccessPolicy(() => ({ restricted: false, folders: [outside] }));
		const listing = await text(lsTool, {});
		assert.match(listing, /course\//);
		assert.doesNotMatch(listing, /Allowed folders:|escape/);
		assert.match(await text(findTool, { pattern: "*.txt" }), /notes.txt/);
		assert.doesNotMatch(await text(grepTool, { pattern: "MARKER" }), /OUTSIDE_MARKER/);
		for (const [folders, expected] of [[[scratch], root], [[course], course]] as const) {
			setFileAccessPolicy(() => ({ restricted: true, folders }));
			assert.deepEqual(sourceSearchRoots(undefined, resolvePolicy()).roots, [expected]);
			const roots = await text(lsTool, {});
			assert.match(roots, /Allowed folders:/);
			assert.ok(roots.includes(expected));
			assert.doesNotMatch(roots, /escape/);
			assert.match(await text(grepTool, { pattern: "STUDY_MARKER" }), /STUDY_MARKER/);
			await assert.rejects(lsTool.execute!("escape", { path: "escape" }), /study folder/);
		}
		for (const folders of [[outside], [], [path.join(scratch, "missing")]]) {
			setFileAccessPolicy(() => ({ restricted: true, folders }));
			await assert.rejects(lsTool.execute!("closed", {}), /no accessible allowed folders/);
			await assert.rejects(findTool.execute!("closed", { pattern: "*" }), /no accessible allowed folders/);
			await assert.rejects(grepTool.execute!("closed", { pattern: "MARKER" }), /no accessible allowed folders/);
		}
	} finally {
		setFileAccessPolicy(() => previousPolicy);
		if (previousRoot === undefined) delete process.env.LH_SOURCES_DIR;
		else process.env.LH_SOURCES_DIR = previousRoot;
		await fs.rm(scratch, { recursive: true, force: true });
	}
});
