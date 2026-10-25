"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { supabase } from "../lib/supabase";

/**
 * Signs the user out everywhere this browser session is known (Supabase
 * clears its cookies), then sends them to the landing page with a full
 * reload so server components re-render in the signed-out state.
 */
export default function SignOutButton({
  className = "",
  label = "Log out",
  onDone,
}: {
  className?: string;
  label?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    if (busy) return;
    setBusy(true);
    try {
      await supabase.auth.signOut();
    } catch {
      // Even if the network call fails, drop local state and leave.
    }
    onDone?.();
    router.replace("/");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={busy}
      className={className}
      aria-label={label}
    >
      {busy ? <LogOut size={16} className="opacity-0" /> : <LogOut size={16} />}
      {busy ? (
        <span className="flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          Signing out…
        </span>
      ) : (
        label
      )}
    </button>
  );
}
