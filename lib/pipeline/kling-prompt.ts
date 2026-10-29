// lib/pipeline/kling-prompt.ts
// Pure prompt helpers for Kling (no env, safe to import in tests/UI).

/**
 * Orientation words in a prompt ("vertical", "tall framing", "9:16"…) make
 * Kling physically rotate the picture mid-clip (seen 29 Oct: pyramids and
 * Samsun clips turned sideways after ~2 s). The aspect ratio is a setting,
 * so strip those words and pin the camera level instead.
 */
export function sanitizeClipPrompt(prompt: string): string {
  return prompt
    .replace(/\b(vertical|portrait|horizontal|landscape)\s*(cinematic|video|shot|framing|format|orientation)?\b/gi, "")
    .replace(/\b(tall|wide)\s+framing\b/gi, "")
    .replace(/\b(9\s*:\s*16|16\s*:\s*9)\b/g, "")
    .replace(/\b(camera\s+)?(roll|rotation|rotating|spinning|flip|flipping|orbit(?:ing)?)\b/gi, "")
    .replace(/\s*,\s*,+/g, ",")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .replace(/\s{2,}/g, " ");
}

export const CAMERA_RULE =
  "Camera stays level with an upright horizon for the whole clip: steady, slow movement only, no roll, no spin, no flip, no rotation of the frame.";

