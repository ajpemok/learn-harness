import assert from "node:assert/strict";
import test from "node:test";
import { WRITING_GUIDANCE, withWritingGuidance, withWritingContext } from "../src/agent/writing-guidance.ts";
import { composeInstructions } from "../src/agent/teacher-agent.ts";
import { piEngineForSpec, piModels } from "../src/agent/models.ts";
import { createFauxCore, getCurrentSystemPrompt, normalizeContext, type TranscriptContext } from "@earendil-works/pi-ai";

test("global writing guidance preserves task instructions and is appended once", () => {
	const task = 'Return only JSON with the exact fields "color" and "artifact_id".';
	const instructions = withWritingGuidance(task);
	assert.ok(instructions.startsWith(task));
	assert.equal(withWritingGuidance(instructions), instructions);
	assert.match(instructions, /Australian English/);
	assert.match(instructions, /APA Title Case/);
	assert.match(instructions, /Preserve the task's required output format/);
});

test("conversation prompts include the shared policy in context-budget estimates", () => {
	for (const kind of ["prober", "teacher", "practice"] as const) {
		const instructions = composeInstructions(kind);
		assert.equal(instructions.split(WRITING_GUIDANCE).length, 2);
	}
});

test("the production model factory adds guidance to helper requests without changing tools or history", () => {
	const models = piModels();
	const original = models.streamSimple;
	const faux = createFauxCore({});
	const context = normalizeContext({ systemPrompt: "Write a research brief.", messages: [{ role: "user", content: "Check the source.", timestamp: 1 }], tools: [] });
	let observed: TranscriptContext | undefined;
	models.streamSimple = (model, received, options) => {
		observed = normalizeContext(received);
		return faux.streamSimple(faux.getModel(), observed, options);
	};
	try {
		const model = models.getModels("openai").find((entry) => entry.api === "openai-responses")!;
		const engine = piEngineForSpec({ provider: model.provider, id: model.id });
		engine.streamFn(engine.model, context);
		const system = observed?.messages[0];
		assert.equal(system?.role, "system");
		if (system?.role !== "system") throw new Error("System instructions are missing");
		assert.equal(system.sections?.learnHarnessWriting, WRITING_GUIDANCE);
		assert.equal(getCurrentSystemPrompt(observed!.messages).split(WRITING_GUIDANCE).length, 2);
		assert.ok(getCurrentSystemPrompt(observed!.messages).startsWith("Write a research brief."));
		assert.equal(observed!.messages[0]?.role === "system" && observed!.messages[0].toolsAdded, context.messages[0]?.role === "system" && context.messages[0].toolsAdded);
		assert.equal(observed?.messages[1], context.messages[1]);
		assert.equal(withWritingContext(observed!), observed);
		const originalSystem = context.messages[0];
		assert.equal(originalSystem?.role === "system" && originalSystem.content, "Write a research brief.");
	} finally {
		models.streamSimple = original;
	}
});
