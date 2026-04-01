import { MemberShell } from "@/components/layout/member-shell";
import { requireAppUser } from "@/server/auth/user";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAppUser();
  return <MemberShell user={user}>{children}</MemberShell>;
}
