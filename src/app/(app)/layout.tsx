import Nav from "@/components/Nav";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <Nav email={session.email} />
      <main className="flex-1 min-h-0 overflow-auto">{children}</main>
    </div>
  );
}
