"use client";

import type { CSSProperties, PointerEvent } from "react";

const LETTERS = "ajpemok".split("");
const OFFSETS = [[-8, -7, -18], [5, 7, 16], [-4, -10, -12], [3, 8, 20], [-5, -8, -16], [6, 6, 14], [9, -6, -20]];

export function OwnerWordmark() {
	function move(event: PointerEvent<HTMLSpanElement>) {
		if (event.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const bounds = event.currentTarget.getBoundingClientRect();
		event.currentTarget.style.setProperty("--owner-x", `${((event.clientX - bounds.left) / bounds.width - 0.5) * 8}px`);
		event.currentTarget.style.setProperty("--owner-y", `${((event.clientY - bounds.top) / bounds.height - 0.5) * 5}px`);
	}

	return <span
		aria-hidden="true"
		className="owner-wordmark font-ui text-base font-medium"
		data-testid="owner-wordmark"
		onPointerMove={move}
		onPointerLeave={(event) => {
			event.currentTarget.style.setProperty("--owner-x", "0px");
			event.currentTarget.style.setProperty("--owner-y", "0px");
		}}
	>
		{LETTERS.map((letter, index) => <span key={index} className="owner-letter" style={{
			"--letter-delay": `${index * 24}ms`,
			"--letter-x": `${OFFSETS[index]![0]}px`,
			"--letter-y": `${OFFSETS[index]![1]}px`,
			"--letter-rotation": `${OFFSETS[index]![2]}deg`,
		} as CSSProperties}>{letter}</span>)}
		{[-1, 1].flatMap((side) => [0, 1, 2].map((index) => <span key={`${side}-${index}`} className="owner-spark" style={{
			"--spark-x": `${side * (22 + index * 17)}px`,
			"--spark-y": `${(index % 2 ? 1 : -1) * (10 + index * 4)}px`,
			"--spark-delay": `${index * 42}ms`,
		} as CSSProperties} />))}
	</span>;
}
