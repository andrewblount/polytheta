import { CopyButton } from "@/components/ui/copy-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BrokerOrderBlockData } from "@/lib/types";

export function OrderBlockCard({ orderBlock }: { orderBlock: BrokerOrderBlockData }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <p className="eyebrow text-[10px] text-muted-foreground">{orderBlock.broker}</p>
          <CardTitle className="mt-2">{orderBlock.title}</CardTitle>
        </div>
        <CopyButton text={orderBlock.orderText} />
      </CardHeader>
      <CardContent>
        <pre className="overflow-auto rounded-3xl border border-border/70 bg-background/50 p-4 text-xs leading-6 whitespace-pre-wrap">
          {orderBlock.orderText}
        </pre>
      </CardContent>
    </Card>
  );
}
