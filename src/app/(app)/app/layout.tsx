import { MemberShell } from "@/components/layout/member-shell";
import { requireAppUser } from "@/server/auth/user";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAppUser();
  return <MemberShell user={user}>{children}</MemberShell>;
}
