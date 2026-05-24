"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signUp } from "@/lib/auth-client";

export default function RegisterPage() {
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

    router.push("/dashboard/competitors");
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
        }}
        className="w-full max-w-sm p-8"
      >
        <h1
          style={{ fontFamily: "var(--font-syne)", color: "var(--foreground)" }}
          className="text-2xl font-bold mb-1"
        >
          Out<span style={{ color: "var(--accent)" }}>rival</span>
        </h1>
        <p style={{ color: "var(--muted)" }} className="text-sm mb-8">
          Create your account
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label style={{ color: "var(--muted)" }} className="text-xs">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              style={{
                background: "var(--background)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                color: "var(--foreground)",
              }}
              className="px-3 py-2 text-sm outline-none focus:ring-1 ring-amber-500"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label style={{ color: "var(--muted)" }} className="text-xs">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                background: "var(--background)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                color: "var(--foreground)",
              }}
              className="px-3 py-2 text-sm outline-none focus:ring-1 ring-amber-500"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label style={{ color: "var(--muted)" }} className="text-xs">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              style={{
                background: "var(--background)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                color: "var(--foreground)",
              }}
              className="px-3 py-2 text-sm outline-none focus:ring-1 ring-amber-500"
            />
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            style={{
              background: "var(--accent)",
              color: "var(--accent-foreground)",
              borderRadius: "var(--radius)",
            }}
            className="py-2 text-sm font-medium mt-2 disabled:opacity-50"
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p style={{ color: "var(--muted)" }} className="text-xs text-center mt-6">
          Already have an account?{" "}
          <Link href="/login" style={{ color: "var(--accent)" }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
