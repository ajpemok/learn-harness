/** Newline-delimited JSON over a private local socket. */
import type { Socket } from "node:net";

/** A malformed line closes the connection; callers treat that as a lost peer. */
export function readSocketLines(socket: Socket, receive: (message: Record<string, unknown>) => void): void {
	const partial: string[] = [];
	socket.setEncoding("utf8");
	socket.on("data", (chunk: string) => {
		const lines = chunk.split("\n");
		partial.push(lines[0]!);
		for (const next of lines.slice(1)) {
			const line = partial.splice(0).join("");
			partial.push(next);
			if (!line) continue;
			try { receive(JSON.parse(line) as Record<string, unknown>); }
			catch { socket.destroy(); return; }
		}
	});
}

/** False asks the caller to slow down, or means the peer has gone. */
export function writeSocketLine(socket: Socket, message: unknown): boolean {
	return socket.writable && socket.write(`${JSON.stringify(message)}\n`);
}
