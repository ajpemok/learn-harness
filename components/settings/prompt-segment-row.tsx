"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Toggle } from "./controls";

// APA Title Case keeps these short function words lowercase after the first word.
const MINOR_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "if", "in", "nor", "of", "off", "on", "or", "per", "so", "the", "to", "up", "via", "yet"]);

export function promptSegmentName(path: string): string {
	const name = (path.split("/").at(-1) ?? "").replace(/\.[^.]+$/, "").replace(/^[\d-]+/, "").replace(/-+/g, " ");
	return name.split(" ").map((word, i) => i > 0 && MINOR_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export function PromptSegmentRow({ path, usageHint, hasOverride, enabled, busy, switching, error, onView, onEdit, onToggle }: {
	path: string;
	usageHint?: string;
	hasOverride: boolean;
	enabled: boolean;
	busy: boolean;
	switching: boolean;
	error?: string;
	onView: (row: HTMLDivElement) => void;
	onEdit: (row: HTMLDivElement) => void;
	onToggle: (enabled: boolean) => void;
}) {
	const name = promptSegmentName(path);
	const row = useRef<HTMLDivElement>(null);
	return <div ref={row} role="group" aria-label={name} tabIndex={-1} data-testid={`prompt-segment-${path}`} className="border-t border-border/50 py-2 font-ui focus-visible:outline-1 focus-visible:outline-ring">
		<div data-testid={`prompt-row-${path}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
			<div className="min-w-0 flex-1 basis-44">
				<p className="font-prose text-(length:--lh-prose-size) text-foreground">{name}</p>
				{usageHint && <p className="mt-0.5 text-xs text-muted-foreground">{usageHint}</p>}
			</div>
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
				<Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => { if (row.current) onView(row.current); }}>View Default</Button>
				<Button type="button" size="xs" variant="outline" className={cn("w-[17ch]", switching && !busy && "disabled:opacity-100")} disabled={busy || switching} onClick={() => { if (row.current) onEdit(row.current); }}>
					{hasOverride ? "Edit Override" : "+ Add Override"}
				</Button>
				<div className="flex items-center gap-2 sm:ml-2">
					<span className="w-[20ch] text-xs text-muted-foreground">In Use: <span className="text-foreground">{enabled ? "Your Version" : "Default"}</span></span>
					<span className={cn("flex", !hasOverride && "opacity-40")}>
						<Toggle label={`Use Your Override for ${name}`} title="Use Your Override Instead of the Default" checked={enabled} disabled={!hasOverride || busy || switching} onChange={onToggle} />
					</span>
				</div>
			</div>
		</div>
		{error && <p role="alert" className="mt-1 text-xs text-error">{error}</p>}
	</div>;
}
