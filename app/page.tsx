export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-green-500">NORVEKO</h1>

        <p className="mt-6 text-xl text-gray-300">
          Yapay Zeka Destekli SaaS Platformu
        </p>

        <button className="mt-10 px-8 py-4 bg-green-500 hover:bg-green-600 rounded-xl text-black font-bold transition">
          Başlayalım
        </button>
      </div>
    </main>
  );
}