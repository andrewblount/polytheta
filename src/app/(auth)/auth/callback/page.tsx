import { AuthShell } from "@/components/auth/auth-shell";
import { AuthCallbackHandler } from "@/components/auth/auth-callback-handler";

export default function AuthCallbackPage() {
  return (
    <AuthShell
      title="Completing sign-in"
      description="Polytheta is processing your secure callback from Netlify Identity."
    >
      <AuthCallbackHandler />
    </AuthShell>
  );
}
