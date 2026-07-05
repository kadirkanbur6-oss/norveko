import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import LandingPage from "./components/LandingPage";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

export default async function Home() {
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: async () => {
        const requestCookies = await cookies();
        return requestCookies.getAll().map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
        }));
      },
    },
  });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  // Giriş yapmış kullanıcı direkt dashboard'a
  if (session?.user?.id) {
    redirect("/dashboard");
  }

  return <LandingPage />;
}