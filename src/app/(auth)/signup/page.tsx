import { AuthShell } from "@/components/auth/auth-shell";
import { SignupForm } from "@/components/auth/signup-form";

export default function SignupPage() {
  return (
    <AuthShell
      title="Create account"
      description="Set up your Polytheta account. Access still depends on approval and active membership."
    >
      <SignupForm />
    </AuthShell>
  );
}
