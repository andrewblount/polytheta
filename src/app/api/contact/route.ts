import { NextResponse } from "next/server";

import { db } from "@/db";
import { accessRequests } from "@/db/schema";
import { sendAccessRequestNotification } from "@/server/services/email";

function getRequestOrigin(request: Request) {
  const forwardedHost =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const originHeader = request.headers.get("origin");

  if (forwardedHost) {
    const protocol =
      forwardedProto ?? (forwardedHost.includes("localhost") ? "http" : "https");

    return `${protocol}://${forwardedHost}`;
  }

  if (originHeader) {
    return originHeader;
  }

  return new URL(request.url).origin;
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const name = String(formData.get("name") ?? "");
  const email = String(formData.get("email") ?? "");
  const company = String(formData.get("company") ?? "");
  const message = String(formData.get("message") ?? "");
  const origin = getRequestOrigin(request);

  if (!name || !email) {
    return NextResponse.redirect(new URL("/contact?error=1", origin), 303);
  }

  if (db) {
    await db.insert(accessRequests).values({
      name,
      email,
      company: company || null,
      message: message || null,
    });
  }

  try {
    await sendAccessRequestNotification({
      name,
      email,
      company,
      message,
    });
  } catch (error) {
    console.error("Failed to send access request notification:", error);
  }

  return NextResponse.redirect(new URL("/contact?submitted=1", origin), 303);
}
