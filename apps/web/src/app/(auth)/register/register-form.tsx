"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { signUp } from "@/lib/auth-client";
import { identifyUser, track } from "@/lib/posthog/events";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RegisterForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const result = await signUp.email({ email, password, name });

    if (result.error) {
      setError(result.error.message ?? "Registration failed");
      setLoading(false);
      return;
    }

    if (result.data?.user?.id) {
      identifyUser(result.data.user.id);
      track("user_signed_up");
    }
    router.push("/dashboard/competitors");
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-sm p-8">
        <h1 className="text-2xl font-bold mb-1 font-[var(--font-display)]">
          <span className="text-muted-foreground">Out</span>rival
        </h1>
        <p className="text-sm text-muted-foreground mb-8">
          Create your account
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>

          {error && <p className="text-destructive text-xs">{error}</p>}

          <Button type="submit" disabled={loading} className="mt-2">
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? "Creating account…" : "Create account"}
          </Button>
        </form>

        <p className="text-xs text-center mt-6 text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
