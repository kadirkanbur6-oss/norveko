// lib/likeness.ts — real-people policy (13 Nov 2026).
//
// Paddle (our Merchant of Record) does not support products that generate images, video or
// audio impersonating celebrities or other real people, and declined norveko.app for it. So:
//   - Character swap is switched off (the code stays; flip SWAP_ENABLED to bring it back).
//   - A character built from photos can only be the creator themself ("self"). The
//     "someone who agreed" type is closed for new characters.
//   - A named real person can only be a historical figure who died at least
//     HISTORICAL_MIN_YEARS_DEAD years ago. Living people and the recently dead are refused,
//     whatever character type is picked.
//   - Voice cloning is for the creator's own voice only (consent text says so).
// Pure and client-safe: the UI, the API routes and the landing page all read these.

export const SWAP_ENABLED = false;
export const PERSON_CHARACTERS_ENABLED = false;
export const HISTORICAL_MIN_YEARS_DEAD = 50;

export const SWAP_DISABLED_MESSAGE = "Character swap is no longer available.";
export const REAL_PERSON_MESSAGE =
  "Characters can't be living or recently deceased real people. Use yourself, a historical figure from more than 50 years ago, or an invented character.";
export const PERSON_KIND_MESSAGE = "Photo characters can only be you. Pick \"Me\" and upload your own photos.";

/**
 * The home-page tour (site/promo-tour.mp4) was recorded with a character swap scene and the
 * line "make any character talk. Add a photo". It stays hidden until it is re-made from the
 * updated PROMO_SCENES (lib/lab/promo.ts); then set this back to true.
 */
export const TOUR_VIDEO_READY = false;
