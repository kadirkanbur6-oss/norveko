// lib/pipeline/steps.ts
// Pipeline adım tanımları ve kredi maliyetleri — tek doğru kaynak.

export type PipelineStepId = "script" | "voiceover" | "thumbnail";

export type StepStatus = "pending" | "running" | "completed" | "failed";

export interface StepState {
  status: StepStatus;
  provider: string;
  error: string | null;
  // Adıma özel çıktılar (script için metinler, thumbnail için image_url, voiceover için audio_url)
  [key: string]: unknown;
}

export interface StepDefinition {
  id: PipelineStepId;
  label: string; // UI'da gösterilecek isim
  credits: number; // bu adımın kredi maliyeti
  provider: string; // varsayılan sağlayıcı (ileride fallback için alan açık)
}

export const PIPELINE_STEP_ORDER: StepDefinition[] = [
  {
    id: "script",
    label: "Content Package",
    credits: 5,
    provider: "openai:gpt-5-mini",
  },
  {
    id: "voiceover",
    label: "Voiceover",
    credits: 15,
    provider: "elevenlabs:eleven_multilingual_v2",
  },
  {
    id: "thumbnail",
    label: "Thumbnail",
    credits: 10,
    provider: "gemini-3.1-flash-image",
  },
];

export function buildPipelineSteps(includeVoiceover = false): StepDefinition[] {
  return includeVoiceover
    ? PIPELINE_STEP_ORDER
    : PIPELINE_STEP_ORDER.filter((step) => step.id !== "voiceover");
}

export function getPipelineStepDefinition(stepId: PipelineStepId): StepDefinition {
  const step = PIPELINE_STEP_ORDER.find((definition) => definition.id === stepId);
  if (!step) {
    throw new Error(`Unknown pipeline step: ${stepId}`);
  }
  return step;
}

// Bir job'ın toplam kredi maliyeti
export function totalPipelineCredits(includeVoiceover = false): number {
  return buildPipelineSteps(includeVoiceover).reduce((sum, step) => sum + step.credits, 0);
}

// Verilen adımdan SONRAKİ adımı döndürür (yoksa null → pipeline bitti)
export function nextStep(
  current: PipelineStepId,
  includeVoiceover = false
): StepDefinition | null {
  const steps = buildPipelineSteps(includeVoiceover);
  const idx = steps.findIndex((step) => step.id === current);
  if (idx === -1 || idx === steps.length - 1) return null;
  return steps[idx + 1];
}

// Job başlarken steps JSON'unun başlangıç hali
export function initialStepsState(
  includeVoiceover = false
): Record<string, StepState> {
  const state: Record<string, StepState> = {};
  for (const step of buildPipelineSteps(includeVoiceover)) {
    state[step.id] = { status: "pending", provider: step.provider, error: null };
  }
  return state;
}