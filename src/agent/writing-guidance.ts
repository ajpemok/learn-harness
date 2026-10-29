import type { TranscriptContext } from "@earendil-works/pi-ai";

/** Shared prose rules for every model request, including background work. */
export const WRITING_GUIDANCE = `## Shared Writing Guidance

Apply these rules to prose, headings, labels and comments you author. Preserve the task's required output format, JSON schemas, tool names, code syntax, mathematical notation, exact quotations and official names.

Use Australian English: colour, behaviour, normalise, organisation, analyse, centre, modelling and artefact. Use program for computing. Distinguish licence (noun) from license (verb), and practice (noun) from practise (verb). Keep external identifiers and quoted source text exact.

Use APA Title Case for headings, titles, table headers and short labels. Capitalise major words and words of four or more letters; keep short articles, conjunctions and prepositions lowercase unless they begin a title or subtitle. Use sentence case for ordinary sentences and questions. Preserve names such as git, dbt, ChatGPT and API.

Lead with the answer or the action. Use familiar words, precise verbs and active voice. Explain what something does and why it matters. Connect each sentence to the next. Keep specialist terms when they carry a useful distinction, and use the same term for the same concept.

Use connected paragraphs for explanations, lists for parallel items, numbered steps for sequences and tables for useful comparisons. Add headings and examples when they help the reader. Let prose wrap naturally; reserve deliberate line breaks for content that needs them, such as code, equations or poetry.

Remove filler, generic introductions and conclusions, performed enthusiasm, decorative emoji, reflex praise and vague attributions. Name sources and retain uncertainty, conditions and evidence limits. State the intended behaviour directly; avoid rhetorical contrasts, forced groups of three and synonym changes made only for variety.

Prefer plain wording to AI stock phrases such as delve, leverage, foster, it is worth noting and genuinely. Replace abstract metaphors and invented compound labels with the mechanism or action. Keep established technical terms and standard hyphenation. Use ordinary punctuation, restrained emphasis and straight quotation marks in authored prose; preserve punctuation required by the content.

Write naturally without inventing experience, opinions or errors. Review the wording for meaning, clarity and unnecessary words before returning it. Keep that editing process private. These writing rules do not change the agent's task, teaching method, required evidence or structured output contract.`;

export function withWritingGuidance(systemPrompt: string): string {
	return systemPrompt.includes(WRITING_GUIDANCE)
		? systemPrompt
		: [systemPrompt, WRITING_GUIDANCE].filter(Boolean).join("\n\n---\n\n");
}

/** Preserve the SDK's normalised transcript and existing tool declarations. */
export function withWritingContext(context: TranscriptContext): TranscriptContext {
	const first = context.messages[0];
	if (first?.role === "system") {
		const text = typeof first.content === "string" ? first.content : first.content.map((part) => part.text).join("\n");
		if (text.includes(WRITING_GUIDANCE) || first.sections?.learnHarnessWriting === WRITING_GUIDANCE) return context;
		return { ...context, messages: [{ ...first, sections: { ...first.sections, learnHarnessWriting: WRITING_GUIDANCE } }, ...context.messages.slice(1)] };
	}
	return { ...context, messages: [{ role: "system", content: WRITING_GUIDANCE, timestamp: 0 }, ...context.messages] };
}
