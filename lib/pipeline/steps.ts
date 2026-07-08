// lib/pipeline/steps.ts
// Pipeline adım tanımları ve kredi maliyetleri — tek doğru kaynak.

export type PipelineStepId = "script" | "thumbnail";
// İleride: | "voiceover" | "video" | "subtitles" | "assembly"

export type StepStatus = "pending" | "running" | "completed" | "failed";

export interface StepState {
  status: StepStatus;
  provider: string;
  error: string | null;
  // Adıma özel çıktılar (script için metinler, thumbnail için image_url)
  [key: string]: unknown;
}

export interface StepDefinition {
  id: PipelineStepId;
  label: string; // UI'da gösterilecek isim
  credits: number; // bu adımın kredi maliyeti
  provider: string; // varsayılan sağlayıcı (ileride fallback için alan açık)
}

// Adım sırası önemli: pipeline bu dizide yukarıdan aşağı ilerler.
export const PIPELINE_STEPS: StepDefinition[] = [
  {
    id: "script",
    label: "Script & Hook",
    credits: 5,
    provider: "openai:gpt-5-mini",
  },
  {
    id: "thumbnail",
    label: "Thumbnail",
    credits: 10,
    provider: "gemini-3.1-flash-image",
  },
];

// Bir job'ın toplam kredi maliyeti
export function totalPipelineCredits(): number {
  return PIPELINE_STEPS.reduce((sum, s) => sum + s.credits, 0);
}

// Verilen adımdan SONRAKİ adımı döndürür (yoksa null → pipeline bitti)
export function nextStep(current: PipelineStepId): StepDefinition | null {
  const idx = PIPELINE_STEPS.findIndex((s) => s.id === current);
  if (idx === -1 || idx === PIPELINE_STEPS.length - 1) return null;
  return PIPELINE_STEPS[idx + 1];
}

// Job başlarken steps JSON'unun başlangıç hali
export function initialStepsState(): Record<string, StepState> {
  const state: Record<string, StepState> = {};
  for (const step of PIPELINE_STEPS) {
    state[step.id] = { status: "pending", provider: step.provider, error: null };
  }
  return state;
}