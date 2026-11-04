// app/components/auth/AuthAlert.tsx
// Hata / bilgi kutusu. role="alert" + aria-live sayesinde ekran okuyucular
// yeni mesajı anında duyurur.

export default function AuthAlert({
  tone,
  children,
}: {
  tone: "error" | "success";
  children: React.ReactNode;
}) {
  const classes =
    tone === "error"
      ? "border-red-500/30 bg-red-500/10 text-red-200"
      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={`rounded-3xl border p-4 text-sm ${classes}`}
    >
      {children}
    </div>
  );
}
