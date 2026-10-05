import Nav from "@/components/Nav";
import TimezoneSync from "@/components/TimezoneSync";
import { getCurrentUser } from "@/lib/current-user";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // A valid cookie is not enough: it outlives the account it names.
  const user = await getCurrentUser();
  if (!user) redirect("/login?expired=1");

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TimezoneSync />
      <Nav email={user.email} />
      <main className="flex-1 min-h-0 overflow-auto">{children}</main>
    </div>
  );
}
