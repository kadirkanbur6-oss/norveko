// lib/likeness.ts — real-people policy (13 Nov 2026).
//
// Paddle (our Merchant of Record) does not support products that generate images, video or
// audio of celebrities or other real people, and declined norveko.app twice for it. After the
// second decline everything that works from a real person's face or voice is switched off:
//   - Character swap is off.
//   - Characters are invented only: no photo characters (not even the creator), no
//     historical figures, and a described character may not be a real person.
//   - Voice cloning and uploading a voice recording are off; voices are Norveko's own.
//   - Image to video refuses photographs of real people.
// The code for each feature stays; flip a flag to bring one back.
// Pure and client-safe: the UI, the API routes and the landing page all read these.

export const SWAP_ENABLED = false;
/** Photo characters of the creator ("self") or someone who agreed ("person"). */
export const PHOTO_CHARACTERS_ENABLED = false;
/** Named real people from history (portrait from Wikimedia Commons). */
export const HISTORICAL_CHARACTERS_ENABLED = false;
export const VOICE_CLONE_ENABLED = false;
/** Uploading a voice recording for a talking character. */
export const VOICE_UPLOAD_ENABLED = false;

export const SWAP_DISABLED_MESSAGE = "Character swap is no longer available.";
export const REAL_PERSON_MESSAGE = "Characters are invented only. Describe a made-up character instead of a real person.";
export const CHARACTER_KIND_MESSAGE = "Characters are invented only. Pick \"Invented\" and describe how the character looks.";
export const VOICE_CLONE_MESSAGE = "Voice cloning is no longer available. Pick one of the Norveko voices.";
export const VOICE_UPLOAD_MESSAGE = "Uploading a recording is no longer available. Type the line and pick a voice.";
export const REAL_PHOTO_MESSAGE = "Photos of real people can't be turned into videos. Use a scene, an object, artwork or an invented character.";

/** Which character types can be created and used right now. */
export function characterKindAllowed(kind: string): boolean {
  if (kind === "fictional") return true;
  if (kind === "historical") return HISTORICAL_CHARACTERS_ENABLED;
  if (kind === "self" || kind === "person") return PHOTO_CHARACTERS_ENABLED;
  return false;
}

/**
 * The home-page tour (site/promo-tour.mp4) was recorded with character swap and
 * "put yourself in the scene" parts. It stays hidden until it is re-made from the
 * updated PROMO_SCENES (lib/lab/promo.ts); then set this back to true.
 */
export const TOUR_VIDEO_READY = false;
