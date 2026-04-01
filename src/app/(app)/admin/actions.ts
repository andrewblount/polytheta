"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createUser,
  saveBasket,
  saveManualOverride,
  runManualSync,
  updateUserAccess,
} from "@/server/services/admin";
import { requireAppUser } from "@/server/auth/user";

export async function saveBasketAction(payload: string) {
  const user = await requireAppUser("admin");
  const parsed = JSON.parse(payload);
  const result = await saveBasket(parsed, user.id);
  revalidatePath("/admin");
  revalidatePath("/admin/baskets");
  revalidatePath("/app/baskets");
  return result;
}

export async function updateUserAccessAction(formData: FormData) {
  await requireAppUser("admin");
  await updateUserAccess({
    userId: String(formData.get("userId")),
    fullName: String(formData.get("fullName")),
    role: String(formData.get("role")) as "admin" | "member",
    status: String(formData.get("status")) as "active" | "inactive",
    password:
      String(formData.get("password") ?? "").trim().length > 0
        ? String(formData.get("password"))
        : undefined,
  });
  revalidatePath("/admin/users");
}

export async function createUserAction(
  _previousState: { error?: string },
  formData: FormData,
) {
  await requireAppUser("admin");

  try {
    await createUser({
      fullName: String(formData.get("fullName") ?? ""),
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      role: String(formData.get("role") ?? "member") as "admin" | "member",
      status: String(formData.get("status") ?? "active") as "active" | "inactive",
    });
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unable to create user.",
    };
  }

  revalidatePath("/admin/users");
  redirect("/admin/users?created=1");
}

export async function saveManualOverrideAction(formData: FormData) {
  const user = await requireAppUser("admin");
  await saveManualOverride({
    positionId: String(formData.get("positionId")),
    actualExitCredit: Number(formData.get("actualExitCredit")),
    actualCloseValue: Number(formData.get("actualCloseValue")),
    actualCloseDate: String(formData.get("actualCloseDate")),
    note: String(formData.get("note")),
    actorIdentityUserId: user.id,
  });
  revalidatePath("/admin/overrides");
  revalidatePath("/app/positions");
}

export async function runManualSyncAction() {
  await requireAppUser("admin");
  await runManualSync();
  revalidatePath("/admin/sync");
  revalidatePath("/app/dashboard");
}
