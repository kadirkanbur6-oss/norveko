import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
  );
}

export function createServerSupabaseClient() {
  return createServerClient(supabaseUrl, supabaseAnonKey, {
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
}

export async function getUserChannelContext() {
  const supabase = createServerSupabaseClient();
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.user?.id) {
    return { userId: null, channelId: null };
  }

  const { data, error } = await supabase
    .from("user_channels")
    .select("channel_id")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error("getUserChannelContext error:", error);
    return { userId: session.user.id, channelId: null };
  }

  return { userId: session.user.id, channelId: data?.channel_id ?? null };
}

export async function getUserChannelId() {
  const { channelId } = await getUserChannelContext();
  return channelId;
}
