// lib/pipeline/script-examples.ts
// Reference narrations that show the quality bar for each style (few-shot).
// Written in-house, facts checked against encyclopedic sources. They are shown
// to the writer as EXAMPLES OF CRAFT ONLY: the prompt forbids reusing their
// topic, sentences or stock phrases. Keep them short, true and varied — a
// model copies whatever it sees most.

export interface ScriptExample {
  topic: string;
  hook: string;
  script: string;
  /** Why it works — the craft notes the writer should imitate. */
  notes: string;
}

const MYSTERY: ScriptExample = {
  topic: "The Mary Celeste (1872)",
  hook: "The ship was fine. The people were gone.",
  script:
    "The ship was fine. The people were gone. On December 4, 1872, sailors on the Dei Gratia spotted a brigantine drifting between the Azores and Portugal. She was the Mary Celeste, and nobody was at the wheel. They rowed over and climbed aboard. The cargo, more than 1,700 barrels of alcohol, was almost untouched. There were six months of food and water. The crew's belongings were still below deck. But the lifeboat was missing, and so were all ten people aboard, including the captain's wife and their two-year-old daughter. The last log entry had been written nine days earlier. An inquiry suspected mutiny, then piracy, then fraud. Nothing fit. One theory still stands out: fumes from leaking barrels may have convinced the captain the ship was about to explode. He ordered everyone into the boat... and the Mary Celeste sailed on without them.",
  notes:
    "Hook is literally true and creates a question without answering it. Chronological, one thread. Every sentence adds a concrete detail (date, place, numbers). Theories come at the end and are framed as theories. Final line lands an image, not a summary.",
};

const DOCUMENTARY: ScriptExample = {
  topic: "The Tunguska event (1908)",
  hook: "Eighty million trees fell. No crater.",
  script:
    "Eighty million trees fell. No crater. On the morning of June 30, 1908, a blinding fireball crossed the sky above the Tunguska River in Siberia. Then came the blast. At a trading post more than sixty kilometres away, a man was thrown from his chair, and windows shattered. Across roughly two thousand square kilometres, the forest was flattened outward, like matchsticks around a point. The region was so remote that no scientist reached it for nineteen years. In 1927, Leonid Kulik finally led an expedition. He expected a giant meteorite. He found no crater and no large fragments. At the very centre, trees still stood upright, stripped bare. Today most scientists agree: a space rock tens of metres wide exploded in the air, several kilometres above the ground. It never hit the Earth. It didn't have to.",
  notes:
    "Opens with a contradiction. Builds with eyewitness-scale details before the explanation. The scientific answer arrives late and is stated with the right confidence ('most scientists agree'). Short closing punch.",
};

const EDUCATIONAL: ScriptExample = {
  topic: "Why the sky is blue",
  hook: "The sky isn't blue because of the ocean.",
  script:
    "The sky isn't blue because of the ocean. Sunlight looks white, but it is every colour mixed together. When it enters the atmosphere, it hits tiny molecules of nitrogen and oxygen. Those molecules scatter short wavelengths much more strongly than long ones. Blue light is scattered around five times more than red. So blue bounces across the whole sky and reaches your eyes from every direction. But violet scatters even more. Why isn't the sky violet? Partly because the sun sends out less violet than blue. And partly because your eyes are far more sensitive to blue. At sunset, light crosses much more air to reach you. Most of the blue is scattered away before it arrives, and the reds and oranges are what's left. Same sun. Same air. Just a longer path.",
  notes:
    "Hook corrects a common belief. One idea per sentence, plain words, no jargon without explanation. A mid-point question re-opens curiosity and is answered. Ends with a rhythmic three-part line.",
};

/** Picks the example that matches a style label (falls back to documentary). */
export function exampleForStyle(style?: string | null): ScriptExample | null {
  const s = (style ?? "").toLowerCase();
  if (s.includes("ad") || s.includes("promo")) return null; // ads follow the brief, not a story arc
  if (s.includes("mystery") || s.includes("horror")) return MYSTERY;
  if (s.includes("educational")) return EDUCATIONAL;
  return DOCUMENTARY;
}

export function exampleBlock(style?: string | null): string {
  const ex = exampleForStyle(style);
  if (!ex) return "";
  return `\n\nQUALITY REFERENCE — an example of the craft level expected (different topic, written in English). Study HOW it works, never reuse its topic, sentences, structure word-for-word or stock phrases, and write natively in the target language rather than translating its style:\nTopic: ${ex.topic}\nHook: ${ex.hook}\nScript: ${ex.script}\nWhy it works: ${ex.notes}`;
}
