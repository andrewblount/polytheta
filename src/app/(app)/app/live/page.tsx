import { requireAppUser } from "@/server/auth/user";
import { LivePositions } from "@/components/broker/live-positions";
export default async function LivePage() { await requireAppUser("admin"); return <LivePositions />; }
