import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string; error?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      <Card>
        <CardHeader>
          <p className="eyebrow text-xs text-muted-foreground">Request access</p>
          <CardTitle className="mt-3 text-4xl">Tell us who you are and how you plan to use Polytheta.</CardTitle>
        </CardHeader>
        <CardContent>
          {params.submitted === "1" ? (
            <p className="mb-4 rounded-2xl border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
              Your request was received. Polytheta will follow up by email.
            </p>
          ) : null}
          {params.error === "1" ? (
            <p className="mb-4 rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
              Name and email are required to submit an access request.
            </p>
          ) : null}
          <form action="/api/contact" method="post" className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="company">Company</Label>
              <Input id="company" name="company" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="message">Context</Label>
              <Textarea
                id="message"
                name="message"
                placeholder="Tell us about your workflow, team, and what you'd want from the member experience."
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit">Request access</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
