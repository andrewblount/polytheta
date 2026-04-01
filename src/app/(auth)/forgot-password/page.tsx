import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset password"
      description="We’ll send recovery instructions through Netlify Identity."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
