import { redirect } from "next/navigation";
import { SWAP_ENABLED } from "@/lib/likeness";

// Character swap now lives in the AI Workspace (one box, four modes); old links land there.
export default function Page() {
  redirect(SWAP_ENABLED ? "/chat?mode=swap" : "/chat");
}
