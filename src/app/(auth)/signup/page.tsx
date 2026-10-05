"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { postJson } from "@/lib/http";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await postJson("/api/auth/signup", { email, password, name, inviteCode });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.replace("/");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center p-6 bow-pattern-bg">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 bg-white/90 dark:bg-gray-900/90 backdrop-blur rounded-2xl shadow-xl p-6"
      >
        <div>
          <h1 className="text-2xl font-semibold">Create your account</h1>
          <p className="text-sm text-gray-500 mt-1">
            This app is private — you need the invite code set on the server (SIGNUP_SECRET).
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 text-red-700 text-sm px-3 py-2 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="name">
            Name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-sm"
          />
        </div>

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
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="inviteCode">
            Invite code
          </label>
          <input
            id="inviteCode"
            type="password"
            required
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-pink-600 text-white hover:bg-pink-700 dark:bg-pink-600 dark:hover:bg-pink-700 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Creating account…" : "Create account"}
        </button>

        <p className="text-sm text-gray-500 text-center">
          Already have an account?{" "}
          <Link href="/login" className="underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
