import { eq } from "drizzle-orm";
import { getUser } from "@netlify/identity";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { userProfiles } from "@/db/schema";
import { demoUsers } from "@/lib/demo-data";
import { env } from "@/lib/env";
import type { AppUserProfile, UserRole } from "@/lib/types";

function normalizeFullName(
  input: string | undefined | null,
  email: string | undefined,
) {
  if (input && input.trim().length > 0) {
    return input;
  }
  if (!email) {
    return "Polytheta User";
  }
  return email.split("@")[0].replace(/[._-]/g, " ");
}

function getDemoUser(): AppUserProfile | null {
  if (!env.useDemoData || !env.demoRole) {
    return null;
  }

  const demo =
    env.demoRole === "admin"
      ? demoUsers.find((user) => user.role === "admin")
      : demoUsers.find((user) => user.role === "member");

  if (!demo) {
    return null;
  }

  return {
    id: demo.id,
    email: demo.email,
    fullName: demo.fullName,
    role: demo.role,
    status: demo.status,
    acknowledgedRiskAt: demo.acknowledgedRiskAt,
    lastLoginAt: demo.lastLoginAt,
    createdAt: demo.createdAt,
  };
}

async function upsertProfileFromIdentity(): Promise<AppUserProfile | null> {
  const demoUser = getDemoUser();
  if (demoUser) {
    return demoUser;
  }

  let identityUser: Awaited<ReturnType<typeof getUser>> | null = null;
  try {
    identityUser = await getUser();
  } catch {
    identityUser = null;
  }

  if (!identityUser || !identityUser.id || !identityUser.email) {
    return null;
  }

  const identityRole = (identityUser.role ?? identityUser.roles?.[0] ?? "member") as UserRole;
  const fullName = normalizeFullName(identityUser.name, identityUser.email);

  if (!db) {
    return {
      id: identityUser.id,
      email: identityUser.email,
      fullName,
      role: identityRole,
      status: "active",
      acknowledgedRiskAt: null,
      lastLoginAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
  }

  const existing = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.identityUserId, identityUser.id),
  });

  if (!existing) {
    const [created] = await db
      .insert(userProfiles)
      .values({
        identityUserId: identityUser.id,
        email: identityUser.email,
        fullName,
        role: identityRole,
        status: "active",
        lastLoginAt: new Date(),
      })
      .returning();

    return {
      id: created.id,
      email: created.email,
      fullName: created.fullName,
      role: created.role,
      status: created.status,
      acknowledgedRiskAt: created.acknowledgedRiskAt?.toISOString() ?? null,
      lastLoginAt: created.lastLoginAt?.toISOString() ?? null,
      createdAt: created.createdAt.toISOString(),
    };
  }

  const [updated] = await db
    .update(userProfiles)
    .set({
      email: identityUser.email,
      fullName,
      role: identityRole,
      lastLoginAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(userProfiles.id, existing.id))
    .returning();

  return {
    id: updated.id,
    email: updated.email,
    fullName: updated.fullName,
    role: updated.role,
    status: updated.status,
    acknowledgedRiskAt: updated.acknowledgedRiskAt?.toISOString() ?? null,
    lastLoginAt: updated.lastLoginAt?.toISOString() ?? null,
    createdAt: updated.createdAt.toISOString(),
  };
}

export async function getCurrentAppUser() {
  return upsertProfileFromIdentity();
}

export async function requireAppUser(role?: UserRole) {
  const user = await getCurrentAppUser();

  if (!user) {
    redirect("/login");
  }

  if (user.status !== "active") {
    redirect("/login?disabled=1");
  }

  if (role === "admin" && user.role !== "admin") {
    redirect("/app/dashboard");
  }

  return user;
}

export async function requireAcknowledgedUser(role?: UserRole) {
  const user = await requireAppUser(role);
  if (!user.acknowledgedRiskAt) {
    redirect("/app/disclaimer");
  }
  return user;
}
