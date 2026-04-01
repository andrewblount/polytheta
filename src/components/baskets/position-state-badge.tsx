import type { PositionState } from "@/lib/types";

import { Badge } from "@/components/ui/badge";

const mapping: Record<
  PositionState,
  { label: string; variant: React.ComponentProps<typeof Badge>["variant"] }
> = {
  safe: { label: "Safe", variant: "success" },
  "approaching-strike": { label: "Approaching", variant: "warning" },
  breached: { label: "Breached", variant: "danger" },
  "expired-otm": { label: "Expired OTM", variant: "success" },
  "expired-itm": { label: "Expired ITM", variant: "danger" },
  "manually-closed": { label: "Manually Closed", variant: "accent" },
};

export function PositionStateBadge({ state }: { state: PositionState }) {
  const config = mapping[state];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
