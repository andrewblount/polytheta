import { notFound } from "next/navigation";

import { PositionDetailView } from "@/components/positions/position-detail-view";
import { getPositionDetail } from "@/server/repos/baskets";

export default async function PositionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const position = await getPositionDetail(id);
  if (!position) {
    notFound();
  }
  return <PositionDetailView position={position} />;
}
