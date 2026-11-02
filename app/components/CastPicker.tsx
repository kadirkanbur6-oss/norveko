"use client";

// AI Workspace → Characters: pick who appears in the video (same face in every
// scene), add new ones right here, and get the historical people of the idea
// offered in one click ("Timur and Bayezid at Ankara" → Timur, Bayezid I).

import { useEffect, useRef, useState } from "react";
import { Crown, Loader2, Plus, Users, X } from "lucide-react";
import Disclosure from "./Disclosure";
import { CharacterCreator, type CharacterItem } from "./CharactersCard";

export const MAX_CAST = 3;

export default function CastPicker({
  idea,
  presenter,
  characters,
  setCharacters,
  castIds,
  setCastIds,
  className = "",
}: {
  idea: string;
  characters: CharacterItem[];
  setCharacters: (fn: (prev: CharacterItem[]) => CharacterItem[]) => void;
  castIds: string[];
  setCastIds: (fn: (prev: string[]) => string[]) => void;
  className?: string;
  /** Full videos only: who (if anyone) talks to camera, and what it adds. */
  presenter?: { id: string | null; set: (id: string | null) => void; credits: number; scenes: number } | null;
}) {
  const [creating, setCreating] = useState(false);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [adding, setAdding] = useState<string>("");
  const [error, setError] = useState("");
  const asked = useRef("");

  // Historical people in the idea, looked up once the idea stops changing.
  useEffect(() => {
    const text = idea.trim();
    if (text.length < 12 || text === asked.current) return;
    const id = setTimeout(async () => {
      asked.current = text;
      try {
        const d = await fetch("/api/characters/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idea: text }),
        }).then((r) => r.json());
        setSuggested(Array.isArray(d?.people) ? d.people : []);
      } catch {
        // suggestions are optional
      }
    }, 1500);
    return () => clearTimeout(id);
  }, [idea]);

  const select = (c: CharacterItem) => setCastIds((prev) => (prev.includes(c.id) || prev.length >= MAX_CAST ? prev : [...prev, c.id]));
  const added = (c: CharacterItem) => {
    setCharacters((prev) => [...prev, c]);
    select(c);
  };

  async function addHistorical(name: string) {
    setAdding(name);
    setError("");
    const form = new FormData();
    form.set("kind", "historical");
    form.set("name", name);
    try {
      const d = await fetch("/api/characters", { method: "POST", body: form }).then((r) => r.json());
      if (!d.success) throw new Error(d.error || `Couldn't add ${name}.`);
      added(d.character);
      setDismissed((prev) => [...prev, name]);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Couldn't add ${name}.`);
    } finally {
      setAdding("");
    }
  }

  const offers = suggested.filter(
    (name) => !dismissed.includes(name) && !characters.some((c) => c.name.toLowerCase() === name.toLowerCase())
  );
  const chosen = characters.filter((c) => castIds.includes(c.id));

  return (
    <div className={className}>
      {offers.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-amber-300/20 bg-amber-400/[0.06] px-4 py-3">
          <Crown size={15} className="text-amber-300" aria-hidden />
          <span className="text-xs text-gray-300">Show them with a consistent face:</span>
          {offers.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => addHistorical(name)}
              disabled={adding !== "" || castIds.length >= MAX_CAST}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/30 px-3 py-1 text-xs font-medium text-amber-100 transition hover:bg-amber-400/10 disabled:opacity-50"
            >
              {adding === name ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              {adding === name ? `Finding ${name}'s portrait…` : name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setDismissed((prev) => [...prev, ...offers])}
            aria-label="Hide suggestions"
            className="ml-auto text-gray-500 hover:text-gray-300"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {error && <p className="mb-3 text-xs text-red-300">{error}</p>}

      <Disclosure
        title="Characters"
        icon={<Users size={16} />}
        summary={chosen.length ? chosen.map((c) => c.name).join(", ") : "Put yourself, a historical figure or an invented character in the video"}
      >
        {characters.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {characters.map((c) => {
              const on = castIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setCastIds((prev) => (on ? prev.filter((x) => x !== c.id) : prev.length >= MAX_CAST ? prev : [...prev, c.id]))}
                  className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition ${
                    on ? "border-sky-400/60 bg-sky-500/15 text-white" : "border-white/10 text-gray-300 hover:border-white/25"
                  }`}
                >
                  {c.previews[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.previews[0]} alt="" className="h-7 w-7 rounded-full object-cover" />
                  ) : (
                    <span className="h-7 w-7 rounded-full bg-white/10" />
                  )}
                  {c.name}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setCreating((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-white/15 px-3 py-1 text-sm text-gray-400 transition hover:border-white/30 hover:text-white"
            >
              <Plus size={14} /> New
            </button>
          </div>
        )}
        {presenter && chosen.length > 0 && presenter.scenes > 0 && (
          <div className="mt-4 rounded-xl border border-white/10 bg-[#0d0d16] p-3">
            <p className="text-sm font-medium text-white">On-camera presenter</p>
            <p className="mt-0.5 text-xs text-gray-500">
              One character talks to the camera, lip-synced to the narration, in {presenter.scenes} scenes (+{presenter.credits} credits).
            </p>
            <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="On-camera presenter">
              {[{ id: null as string | null, name: "Nobody" }, ...chosen.map((c) => ({ id: c.id as string | null, name: c.name }))].map((o) => {
                const on = presenter.id === o.id;
                return (
                  <button
                    key={o.id ?? "none"}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => presenter.set(o.id)}
                    className={`rounded-full border px-3 py-1 text-xs transition ${on ? "border-sky-400/60 bg-sky-500/15 text-white" : "border-white/10 text-gray-300 hover:border-white/25"}`}
                  >
                    {o.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <p className="mt-3 text-xs text-gray-500">
          Up to {MAX_CAST} per video. Chosen characters keep the same face in every AI scene, clip and the thumbnail.
        </p>
        {(creating || characters.length === 0) && (
          <CharacterCreator className="mt-3" initialKind="historical" onCreated={(c) => { added(c); setCreating(false); }} />
        )}
      </Disclosure>
    </div>
  );
}
