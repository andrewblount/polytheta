import { NextResponse } from "next/server";

import { db } from "@/db";
import { accessRequests } from "@/db/schema";

export async function POST(request: Request) {
  const formData = await request.formData();
  const name = String(formData.get("name") ?? "");
  const email = String(formData.get("email") ?? "");
  const company = String(formData.get("company") ?? "");
  const message = String(formData.get("message") ?? "");

  if (!name || !email) {
    return NextResponse.redirect(new URL("/contact?error=1", request.url));
  }

  if (db) {
    await db.insert(accessRequests).values({
      name,
      email,
      company: company || null,
      message: message || null,
    });
  }

  return NextResponse.redirect(new URL("/contact?submitted=1", request.url));
}
