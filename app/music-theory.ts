export type Mode = "major" | "minor";
export type NoteStyle = "auto" | "sharp" | "flat";
export type Extension = "" | "m" | "7" | "maj7" | "m7" | "9" | "sus2" | "sus4" | "add9" | "6" | "m6" | "m9" | "maj9" | "dim7" | "aug" | "11" | "13" | "7♭9" | "7♯9" | "7♭5" | "7♯5";

export const SHARP_NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export const FLAT_NOTES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
export const CANONICAL_NOTES = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];

export const KEYS = [
  { label: "C", pc: 0, style: "sharp" }, { label: "D♭", pc: 1, style: "flat" },
  { label: "D", pc: 2, style: "sharp" }, { label: "E♭", pc: 3, style: "flat" },
  { label: "E", pc: 4, style: "sharp" }, { label: "F", pc: 5, style: "flat" },
  { label: "F♯", pc: 6, style: "sharp" }, { label: "G", pc: 7, style: "sharp" },
  { label: "A♭", pc: 8, style: "flat" }, { label: "A", pc: 9, style: "sharp" },
  { label: "B♭", pc: 10, style: "flat" }, { label: "B", pc: 11, style: "sharp" },
] as const;

export const MODE_DATA = {
  major: { label: "大調", intervals: [0, 2, 4, 5, 7, 9, 11], qualities: ["", "m", "m", "", "", "m", "dim"], roman: ["I", "ii", "iii", "IV", "V", "vi", "vii°"] },
  minor: { label: "自然小調", intervals: [0, 2, 3, 5, 7, 8, 10], qualities: ["m", "dim", "", "m", "m", "", ""], roman: ["i", "ii°", "III", "iv", "v", "VI", "VII"] },
} as const;

export function parseDegrees(input: string) {
  let normalized = input.replace(/[，、｜|]/g, " ").replace(/♭/g, "b").replace(/♯/g, "#").replace(/\^|:/g, "").trim();
  if (/^(?:[#b]?[1-7]\/){2,}[#b]?[1-7]$/.test(normalized)) normalized = normalized.replace(/\//g, " ");
  if (!normalized) return [];
  if (/^[1-7]+$/.test(normalized)) return normalized.split("").map((raw) => ({ raw, accidental: 0, degree: Number(raw), extension: "" as Extension, bassDegree: null as number | null, bassAccidental: 0 }));
  const tokens = normalized.match(/[#b]?[1-7](?:\((?:maj9|maj7|m9|m7|add9|sus2|sus4|dim7|7b9|7#9|7b5|7#5|m6|13|11|aug|9|7|6|m)\)|maj9|maj7|m9|m7|add9|sus2|sus4|dim7|7b9|7#9|7b5|7#5|m6|13|11|aug|9|7|6|m)?(?:\/[#b]?[1-7])?/gi) ?? [];
  return tokens.map((token) => {
    const [chordToken] = token.split("/");
    const chordMatch = chordToken.match(/^([#b]?)([1-7])(?:\(([^)]+)\)|(.*))?$/i);
    const accidental = chordMatch?.[1] === "#" ? 1 : chordMatch?.[1] === "b" ? -1 : 0;
    const degree = Number(chordMatch?.[2] ?? 1);
    const extensionText = (chordMatch?.[3] ?? chordMatch?.[4] ?? "").toLowerCase();
    const bassMatch = token.match(/\/([#b]?)([1-7])$/i);
    const bassAccidental = bassMatch?.[1] === "#" ? 1 : bassMatch?.[1] === "b" ? -1 : 0;
    const extension = extensionText.replace("7b", "7♭").replace("7#", "7♯") as Extension;
    return { raw: token, accidental, degree, extension, bassDegree: bassMatch ? Number(bassMatch[2]) : null, bassAccidental };
  });
}

export function suffixFor(quality: string, extension: Extension) {
  if (!extension) return quality;
  if (extension === "7") return quality === "m" ? "m7" : quality === "dim" ? "m7♭5" : "7";
  return extension;
}

export function suffixForDegree(quality: string, accidental: number, extension: Extension) {
  return suffixFor(accidental !== 0 && !extension ? "" : quality, extension);
}

export function noteForDegree(pc: number, accidental: number, fallbackNotes: string[]) {
  if (accidental < 0) return FLAT_NOTES[pc];
  if (accidental > 0) return SHARP_NOTES[pc];
  return fallbackNotes[pc];
}

export function resolveProgression(input: string, keyPc: number, mode: Mode, noteStyle: NoteStyle = "auto") {
  const key = KEYS.find((item) => item.pc === keyPc) ?? KEYS[0];
  const notes = noteStyle === "flat" || (noteStyle === "auto" && key.style === "flat") ? FLAT_NOTES : SHARP_NOTES;
  const data = MODE_DATA[mode];
  return parseDegrees(input).map((item) => {
    const rootPc = (keyPc + data.intervals[item.degree - 1] + item.accidental + 12) % 12;
    const suffix = suffixForDegree(data.qualities[item.degree - 1], item.accidental, item.extension);
    const bassPc = item.bassDegree === null ? null : (keyPc + data.intervals[item.bassDegree - 1] + item.bassAccidental + 12) % 12;
    const root = noteForDegree(rootPc, item.accidental, notes);
    const bass = bassPc === null ? "" : noteForDegree(bassPc, item.bassAccidental, notes);
    return `${root}${suffix}${bassPc === null ? "" : `/${bass}`}`;
  });
}

export const capoShapePitchClass = (soundingPitchClass: number, capo: number) => (soundingPitchClass - capo + 12) % 12;
