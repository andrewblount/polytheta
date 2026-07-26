import { timingSafeEqual } from "node:crypto";

// Bearer-token gate for the mobile API. Single-user system: the token lives
// in MOBILE_API_TOKEN (Netlify env) and in the iOS app's settings.
export function mobileAuthOk(request: Request): boolean {
  const expected = process.env.MOBILE_API_TOKEN;
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function unauthorized() {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
