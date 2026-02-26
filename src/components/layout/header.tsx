"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { MobileNav } from "@/components/layout/mobile-nav";
import { LogOut, Menu } from "lucide-react";
import type { AppRole } from "@/types/roles";

export function Header() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserEmail(session?.user?.email ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase.auth]);

  async function handleLogout() {
    setLoggingOut(true);
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-50 flex h-14 items-center border-b bg-background px-4 lg:px-6">
      {/* Mobile hamburger */}
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden mr-2"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation menu"
      >
        <Menu className="size-5" />
      </Button>

      {/* Branding */}
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
          <span className="text-sm font-bold text-primary-foreground">ST</span>
        </div>
        <span className="text-lg font-semibold tracking-tight hidden sm:inline">
          SewerTime
        </span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* User info + Logout */}
      <div className="flex items-center gap-3">
        {userEmail && (
          <span className="text-sm text-muted-foreground hidden sm:inline">
            {userEmail}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          disabled={loggingOut}
          className="gap-1.5"
        >
          <LogOut className="size-4" />
          <span className="hidden sm:inline">
            {loggingOut ? "Signing out..." : "Sign Out"}
          </span>
        </Button>
      </div>

      {/* Mobile Nav Sheet */}
      <MobileNav open={mobileOpen} onOpenChange={setMobileOpen} />
    </header>
  );
}
