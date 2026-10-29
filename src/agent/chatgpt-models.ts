import type { Model } from "@earendil-works/pi-ai";

/** Subscription-only metadata for a model released ahead of the Pi catalogue.
 * OpenAI API specification, checked 29 October 2026:
 * https://developers.openai.com/api/docs/models/gpt-6.1-terra
 * The SDK entry takes precedence when it becomes available. Account discovery
 * still determines whether the model can be selected or leased. */
export function chatGPTModelMetadata(
	id: string,
	supported: readonly Model<"openai-responses">[],
): Model<"openai-responses"> | undefined {
	const known = supported.find((model) => model.id === id && model.api === "openai-responses");
	if (known) return known;
	if (id !== "gpt-6.1-terra") return;
	return {
		id,
		name: "GPT-6.1 Terra",
		api: "openai-responses",
		provider: "chatgpt",
		baseUrl: "https://api.openai.com/v1",
		input: ["text", "image"],
		reasoning: true,
		thinkingLevelMap: {
			off: "none", minimal: null, low: "low", medium: "medium",
			high: "high", xhigh: "xhigh", max: "max",
		},
		contextWindow: 1_050_000,
		maxTokens: 128_000,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
}
