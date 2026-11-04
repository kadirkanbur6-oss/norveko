"use client";

// app/components/auth/GoogleButton.tsx
// "Continue with Google" düğmesi + "Or continue with email" ayırıcı.
// type="button": form dışında durur, Enter tuşu e-posta formunu gönderir.

export default function GoogleButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="mb-6 flex w-full items-center justify-center gap-3 rounded-3xl border border-white/20 bg-white/[0.08] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <svg className="h-5 w-5" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12S17.4 12 24 12c3 0 5.7 1.1 7.8 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.3 19 12 24 12c3 0 5.7 1.1 7.8 3l5.7-5.7C34 6.1 29.3 4 24 4c-7.7 0-14.4 4.3-17.7 10.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.2c-2.1 1.6-4.6 2.4-7.3 2.4-5.3 0-9.8-3.3-11.5-8l-6.6 5.1C9.2 39.6 16 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3-3.2 5.3-6 6.8l6.2 5.2C39.1 36.7 44 31 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        Continue with Google
      </button>

      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-white/10"></div>
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="bg-[#090b16]/50 px-2 text-gray-500">Or continue with email</span>
        </div>
      </div>
    </>
  );
}
