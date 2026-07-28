"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import NotificationBell from "./NotificationBell";

export default function Nav({ email }: { email: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const linkClass = (href: string) =>
    `px-3 py-1.5 rounded-md text-sm font-medium ${
      pathname === href
        ? "bg-black text-white dark:bg-white dark:text-black"
        : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
    }`;

  return (
    <header className="border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-lg mr-2">Calendar</span>
        <nav className="flex items-center gap-1">
          <Link href="/" className={linkClass("/")}>
            Calendar
          </Link>
          <Link href="/todo" className={linkClass("/todo")}>
            To-do
          </Link>
          <Link href="/settings/connections" className={linkClass("/settings/connections")}>
            Connections
          </Link>
        </nav>
      </div>

      <div className="flex items-center gap-3">
        <NotificationBell />
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-sm font-medium"
            title={email}
          >
            {email[0]?.toUpperCase()}
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-2 w-56 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg z-20">
              <div className="px-3 py-2 text-xs text-gray-500 truncate border-b border-gray-100 dark:border-gray-800">
                {email}
              </div>
              <Link
                href="/settings/notifications"
                onClick={() => setMenuOpen(false)}
                className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                Notifications
              </Link>
              <button
                onClick={signOut}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
