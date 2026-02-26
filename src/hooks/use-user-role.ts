"use client";

import { useEffect, useState } from "react";
import { jwtDecode } from "jwt-decode";
import { createClient } from "@/lib/supabase/client";
import type { AppRole } from "@/types/roles";

interface JwtPayload {
  user_role?: AppRole;
  [key: string]: unknown;
}

export function useUserRole() {
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    // Check existing session first
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        try {
          const decoded = jwtDecode<JwtPayload>(session.access_token);
          setRole(decoded.user_role ?? null);
        } catch {
          setRole(null);
        }
      }
      setLoading(false);
    });

    // Subscribe to auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        try {
          const decoded = jwtDecode<JwtPayload>(session.access_token);
          setRole(decoded.user_role ?? null);
        } catch {
          setRole(null);
        }
      } else {
        setRole(null);
      }
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return { role, loading };
}
