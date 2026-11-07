/**
 * Turns a raw provider / pipeline error into something a creator can read.
 * The raw text stays in the database (admin panel shows it); users never see
 * provider names, status codes or billing messages.
 */
export interface FriendlyError {
  title: string;
  detail: string;
  kind: "policy" | "busy" | "timeout" | "generic";
}

const POLICY =
  /safety|content.?polic|moderation|blocked|prohibited|flagged|responsible ?ai|violates? |inappropriate|IMAGE_SAFETY|PROHIBITED_CONTENT/i;
const BUSY =
  /\b(402|429|500|502|503|504)\b|quota|RESOURCE_EXHAUSTED|credits are depleted|prepay|billing|rate.?limit|overloaded|unavailable|downstream|insufficient|balance|ECONN|fetch failed|network/i;
const TIMEOUT = /time(d)? ?out|took too long|deadline|aborted/i;

export function friendlyError(raw: string | null | undefined): FriendlyError {
  const text = String(raw ?? "");
  if (POLICY.test(text)) {
    return {
      kind: "policy",
      title: "This video goes against the content policy",
      detail:
        "The AI models refused some of this content (for example graphic injuries, gore or explicit material). Try telling the story without graphic details.",
    };
  }
  if (TIMEOUT.test(text)) {
    return {
      kind: "timeout",
      title: "This took longer than expected",
      detail: "One of the steps did not finish in time. Please try again.",
    };
  }
  if (BUSY.test(text)) {
    return {
      kind: "busy",
      title: "Our AI service is temporarily unavailable",
      detail: "This is on our side, not yours. Please try again in a little while.",
    };
  }
  return {
    kind: "generic",
    title: "We couldn't finish this video",
    detail: "Something went wrong on our side. Please try again.",
  };
}

/** One short line for small spots (clip rows, studio lists). */
export function friendlyErrorLine(raw: string | null | undefined): string {
  const e = friendlyError(raw);
  return e.kind === "policy" ? "Blocked by the content policy" : e.kind === "busy" ? "Service temporarily unavailable" : e.kind === "timeout" ? "Took too long" : "Failed";
}
