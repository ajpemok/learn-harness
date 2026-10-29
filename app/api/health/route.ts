/** Liveness only: does not read learning data, credentials or provider state. */
export function GET() {
	return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
