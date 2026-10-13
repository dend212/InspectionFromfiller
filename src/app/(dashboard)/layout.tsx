import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Nav } from "@/components/layout/nav";
import { Toaster } from "@/components/ui/sonner";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-svh flex-col">
      <Header />
      <div className="flex flex-1">
        <Nav />
        <main className="flex-1 p-4 lg:p-8">{children}</main>
      </div>
      {/* Lives in the layout (persists across client navigation) so a toast fired just before router.push stays visible */}
      <Toaster />
    </div>
  );
}
