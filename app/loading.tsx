import BrandMark from "./components/BrandMark";

export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a12]">
      <BrandMark size={48} className="animate-pulse opacity-80" />
    </div>
  );
}
