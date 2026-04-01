import { MemberShell } from "@/components/layout/member-shell";
import { requireAppUser } from "@/server/auth/user";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAppUser("admin");
  return <MemberShell user={user} admin>{children}</MemberShell>;
}
