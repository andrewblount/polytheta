"use server";

import { revalidatePath } from "next/cache";

import { saveBasket, saveManualOverride, runManualSync, updateUserAccess } from "@/server/services/admin";
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
    role: String(formData.get("role")) as "admin" | "member",
    status: String(formData.get("status")) as "active" | "inactive",
  });
  revalidatePath("/admin/users");
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
