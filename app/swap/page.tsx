import { redirect } from "next/navigation";

// Character swap now lives in the AI Workspace (one box, four modes); old links land there.
export default function Page() {
  redirect("/chat?mode=swap");
}
