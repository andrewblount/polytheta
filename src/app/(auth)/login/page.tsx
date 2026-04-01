import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ disabled?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthShell
      title="Sign in"
      description="Access the member app, current basket, archive, and analytics."
    >
      <LoginForm disabled={params.disabled === "1"} />
    </AuthShell>
  );
}
