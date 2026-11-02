// What the public API shows of a job (no internal step details).
type Row = {
  id: string;
  idea: string;
  status: string;
  error: string | null;
  duration: string | null;
  output_language: string | null;
  created_at: string;
  current_step: string | null;
  credits_charged: number | null;
  credits_refunded: number | null;
  steps: Record<string, Record<string, unknown>> | null;
};

export function jobView(row: Row) {
  const steps = row.steps ?? {};
  const script = steps.script ?? {};
  return {
    id: row.id,
    idea: row.idea,
    status: row.status,
    step: row.status === "running" ? row.current_step : null,
    error: row.error,
    duration: row.duration,
    language: row.output_language,
    createdAt: row.created_at,
    credits: { charged: row.credits_charged ?? 0, refunded: row.credits_refunded ?? 0 },
    projectId: (steps.result?.project_id as string | undefined) ?? null,
    result:
      row.status === "completed"
        ? {
            videoUrl: (steps.render?.video_url as string | undefined) ?? null,
            thumbnailUrl: (steps.thumbnail?.image_url as string | undefined) ?? null,
            voiceoverUrl: (steps.voiceover?.audio_url as string | undefined) ?? null,
            titles: (script.titles as string[] | undefined) ?? [],
            description: (script.description as string | undefined) ?? "",
            tags: (script.tags as string[] | undefined) ?? [],
            hook: (script.hook as string | undefined) ?? "",
            script: (script.script as string | undefined) ?? "",
            captions: (steps.voiceover?.captions as unknown[] | undefined) ?? [],
          }
        : null,
  };
}
