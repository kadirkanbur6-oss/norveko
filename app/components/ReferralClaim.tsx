"use client";

// Claims an invite code (nv_ref cookie, set from ?ref=) once after sign-in.
// The cookie is httpOnly, so the server decides; this just pings it once per session.

import { useEffect } from "react";

export default function ReferralClaim() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem("nv_ref_checked")) return;
      sessionStorage.setItem("nv_ref_checked", "1");
    } catch {
      // storage blocked: still fine to ping once per mount
    }
    fetch("/api/referrals/claim", { method: "POST" }).catch(() => undefined);
  }, []);
  return null;
}
