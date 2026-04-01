import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDateLabel } from "@/lib/format";
import { listBaskets } from "@/server/repos/baskets";

export default async function AdminBasketsPage() {
  const baskets = await listBaskets();

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-[10px] text-muted-foreground">Publishing</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">Basket management</h1>
        </div>
        <Button asChild>
          <Link href="/admin/baskets/new">New basket</Link>
        </Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {baskets.map((basket) => (
          <Card key={basket.id}>
            <CardHeader>
              <p className="eyebrow text-[10px] text-muted-foreground">{basket.status}</p>
              <CardTitle className="mt-3">
                <Link href={`/admin/baskets/${basket.id}`}>{basket.title}</Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm text-muted-foreground">
              <p>Week of {formatDateLabel(basket.weekOf)}</p>
              <p>GSRS {basket.gsrs}</p>
              <p>{basket.callPositions.length + basket.putPositions.length} positions</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
