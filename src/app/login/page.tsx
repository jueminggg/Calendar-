"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      router.replace(params.get("next") ?? "/");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="text-sm text-gray-500 mt-1">Access your unified calendar.</p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 text-red-700 text-sm px-3 py-2 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-sm"
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-black text-white dark:bg-white dark:text-black py-2 text-sm font-medium disabled:opacity-50"
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>

      <p className="text-sm text-gray-500 text-center">
        No account yet?{" "}
        <Link href="/signup" className="underline">
          Create one
        </Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
