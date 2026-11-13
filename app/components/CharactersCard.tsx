"use client";

// Settings → Characters: recurring people who keep the same face in every scene.
// Four ways to add one: yourself (photos), someone who agreed (photos), a
// historical figure (portrait found for you) or an invented character.

import { useEffect, useRef, useState } from "react";
import { Crown, ImagePlus, Loader2, Sparkles, Trash2, User, Users } from "lucide-react";

export interface CharacterItem {
  id: string;
  name: string;
  kind: "self" | "person" | "historical" | "fictional";
  description: string;
  previews: string[];
}

const KINDS = [
  { id: "self", label: "Me", hint: "Upload 1–4 clear photos of your face.", icon: User },
  { id: "historical", label: "Historical figure", hint: "Someone who died more than 50 years ago. We find their portrait.", icon: Crown },
  { id: "fictional", label: "Invented", hint: "Describe a character and we draw them.", icon: Sparkles },
] as const;

const KIND_LABEL: Record<CharacterItem["kind"], string> = {
  self: "You",
  person: "With permission",
  historical: "Historical",
  fictional: "Invented",
};

const MAX_BYTES = 4 * 1024 * 1024;

/**
 * The "Add a character" form — used in Settings and in the AI Workspace.
 * `onCreated` receives the new character.
 */
export function CharacterCreator({
  onCreated,
  initialKind = "self",
  initialName = "",
  className = "",
}: {
  onCreated: (c: CharacterItem) => void;
  initialKind?: CharacterItem["kind"];
  initialName?: string;
  className?: string;
}) {
  const [kind, setKind] = useState<CharacterItem["kind"]>(initialKind);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // The form opens below the fold in the studios ("+ New"): bring it into view
  // and focus the name, otherwise it looks like nothing happened (5 Nov 2026).
  useEffect(() => {
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    nameRef.current?.focus({ preventScroll: true });
  }, []);

  const needsPhotos = kind === "self" || kind === "person";
  // Historical figures: photos are optional (a portrait you picked); otherwise we find one.
  const usesPhotos = needsPhotos || (kind === "historical" && files.length > 0);
  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  const canCreate =
    !busy &&
    name.trim().length >= 2 &&
    (!needsPhotos || files.length > 0) &&
    (!usesPhotos || (consent && totalBytes <= MAX_BYTES)) &&
    (kind !== "fictional" || description.trim().length >= 10);

  async function create() {
    setBusy(true);
    setMessage(null);
    const form = new FormData();
    form.set("kind", kind);
    form.set("name", name.trim());
    form.set("description", description.trim());
    if (usesPhotos) {
      form.set("consent", consent ? "yes" : "no");
      files.forEach((f) => form.append("photos", f));
    }
    try {
      const d = await fetch("/api/characters", { method: "POST", body: form }).then((r) => r.json());
      if (!d.success) throw new Error(d.error || "Could not create the character.");
      setName("");
      setDescription("");
      setFiles([]);
      setConsent(false);
      setMessage({ ok: true, text: `${d.character.name} is ready.` });
      onCreated(d.character);
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Could not create the character." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={rootRef} className={`rounded-xl border border-white/10 bg-[var(--nv-panel)] p-4 ${className}`}>
      <p className="text-sm font-medium text-white">Add a character</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Character type">
        {KINDS.map((k) => {
          const Icon = k.icon;
          const on = kind === k.id;
          return (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => {
                setKind(k.id);
                setMessage(null);
              }}
              className={`rounded-xl border p-3 text-left transition ${on ? "border-sky-400/60 bg-sky-500/10" : "border-white/10 hover:border-white/20"}`}
            >
              <Icon size={16} className={on ? "text-sky-300" : "text-gray-400"} aria-hidden />
              <span className="mt-1.5 block text-sm font-semibold text-white">{k.label}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-gray-500">{k.hint}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">{kind === "historical" ? "Who? (e.g. Fatih Sultan Mehmet)" : "Name"}</span>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            className="w-full rounded-xl border border-white/10 bg-[var(--nv-field)] px-3 py-2 text-sm text-white outline-none focus:border-sky-400/50"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">
            {kind === "fictional" ? "What do they look like?" : "Notes (optional): age, usual clothing"}
          </span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={300}
            placeholder={kind === "fictional" ? "A weathered sea captain in his 50s, grey beard, navy coat" : ""}
            className="w-full rounded-xl border border-white/10 bg-[var(--nv-field)] px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-sky-400/50"
          />
        </label>
      </div>

      {(needsPhotos || kind === "historical") && (
        <div className="mt-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 4))}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-gray-200 transition hover:border-white/20"
          >
            <ImagePlus size={15} aria-hidden />{" "}
            {files.length ? `${files.length} picture${files.length > 1 ? "s" : ""} selected` : kind === "historical" ? "Use my own portrait (optional)" : "Choose photos"}
          </button>
          <span className={`ml-3 text-xs ${totalBytes > MAX_BYTES ? "text-red-300" : "text-gray-500"}`}>
            {kind === "historical" ? "A painting or portrait of them · up to 4, 4 MB together" : "Clear, well-lit face photos of one adult · up to 4 photos, 4 MB together"}
          </span>
          {usesPhotos && (
            <label className="mt-3 flex items-start gap-2 text-xs text-gray-300">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
              <span>
                {kind === "self"
                  ? "These photos are of me, and I'm 18 or older."
                  : kind === "historical"
                    ? "I have the right to use these pictures (for example a public-domain painting or my own photo of it)."
                    : "These photos are of me, and I'm 18 or older."}
              </span>
            </label>
          )}
        </div>
      )}

      {kind === "historical" && !files.length && (
        <p className="mt-3 text-xs text-gray-500">
          Without your own picture we use their best-known public-domain portrait and turn it into a lifelike reference.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={create}
          disabled={!canCreate}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {busy ? (usesPhotos ? "Checking pictures…" : "Creating, about 30 s…") : "Add character"}
        </button>
        <span className="text-xs text-gray-500">You&apos;re responsible for who you use. Children and explicit content aren&apos;t allowed.</span>
      </div>
      {message && <p className={`mt-3 text-sm ${message.ok ? "text-emerald-300" : "text-red-300"}`}>{message.text}</p>}
    </div>
  );
}

export default function CharactersCard() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [items, setItems] = useState<CharacterItem[]>([]);
  const [max, setMax] = useState(12);
  const [busy, setBusy] = useState<string>("");

  useEffect(() => {
    fetch("/api/characters")
      .then((r) => r.json())
      .then((d) => {
        setAllowed(Boolean(d.allowed) || (d.characters?.length ?? 0) > 0);
        setItems(d.characters ?? []);
        setMax(d.max ?? 12);
      })
      .catch(() => setAllowed(false));
  }, []);

  if (allowed === null || (!allowed && !items.length)) return null;

  async function remove(id: string) {
    setBusy(id);
    try {
      const d = await fetch(`/api/characters?id=${id}`, { method: "DELETE" }).then((r) => r.json());
      if (d.success) setItems((prev) => prev.filter((c) => c.id !== id));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-center gap-2">
        <Users size={18} className="text-sky-300" aria-hidden />
        <h2 className="font-semibold">Characters</h2>
      </div>
      <p className="mt-2 text-sm text-gray-400">
        People who appear in your videos with the same face in every scene: you, a historical figure or an invented character. Living people other than you can&apos;t be used.
      </p>

      {items.length > 0 && (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {items.map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-[var(--nv-panel)] p-3">
              {c.previews[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.previews[0]} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
              ) : (
                <span className="h-14 w-14 shrink-0 rounded-lg bg-white/5" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white">{c.name}</span>
                <span className="block text-xs text-gray-500">{KIND_LABEL[c.kind]}</span>
              </span>
              <button
                type="button"
                onClick={() => remove(c.id)}
                disabled={busy === c.id}
                aria-label={`Delete ${c.name}`}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
              >
                {busy === c.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
              </button>
            </li>
          ))}
        </ul>
      )}

      {allowed && items.length < max && (
        <CharacterCreator className="mt-5" onCreated={(c) => setItems((prev) => [...prev, c])} />
      )}
    </div>
  );
}
