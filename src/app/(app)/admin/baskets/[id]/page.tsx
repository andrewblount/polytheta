import { notFound } from "next/navigation";

import { BasketEditor } from "@/components/admin/basket-editor";
import { createDraftFromBasket } from "@/lib/markdown-import";
import { listBaskets } from "@/server/repos/baskets";

export default async function EditBasketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const baskets = await listBaskets();
  const basket = baskets.find((item) => item.id === id);
  if (!basket) {
    notFound();
  }
  return <BasketEditor initialDraft={createDraftFromBasket(basket)} />;
}
