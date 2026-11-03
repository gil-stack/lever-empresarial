export const runtime = "nodejs";

export function GET(request: Request) {
  if (request.method !== "GET") {
    return new Response(null, { status: 405 });
  }

  return new Response("ok", {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
