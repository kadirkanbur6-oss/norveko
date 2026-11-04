// Public shape of a skit in the API.
export function skitApiView(r: Record<string, unknown>) {
  const plan = (r.plan ?? {}) as { title?: string };
  return {
    id: r.id,
    status: r.status,
    step: r.phase,
    title: plan.title ?? null,
    credits: r.credits,
    video_url: r.output_url ?? null,
    project_id: r.project_id ?? null,
    error: r.error ?? null,
    created_at: r.created_at,
  };
}

