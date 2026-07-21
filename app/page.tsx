"use client";

import { useEffect, useMemo, useState } from "react";
import ScanWorkbench from "./scan-workbench";
import { VERIFIED_CHORDS, VERIFIED_SLASH_CHORDS, type Fingering } from "./chord-fingerings";
import { CANONICAL_NOTES, FLAT_NOTES, KEYS, MODE_DATA, SHARP_NOTES, noteForDegree, parseDegrees, suffixForDegree, type Mode, type NoteStyle } from "./music-theory";
type SoundStyle = "acoustic" | "electric" | "piano";
type FingeringSource = "verified" | "movable" | "generated";
type FingeringOption = { fingering: Fingering; fingers: Array<number | null>; source: string; sourceType: FingeringSource; detail: string; score: number; toneCount: number; fingerCount: number };

let sharedAudioContext: AudioContext | null = null;


const DEGREE_NAMES = ["主音", "上主音", "中音", "下屬音", "屬音", "下中音", "導音／下主音"];
const DEGREE_JOBS = ["回家、穩定", "經過、醞釀", "延伸、柔和", "推進、展開", "張力、想回家", "抒情、相對調", "強烈導向／開放"];
const PRESETS = [
  { value: "1645", label: "流行 1645" }, { value: "4536", label: "華語常見 4536" },
  { value: "1564", label: "經典 1564" }, { value: "6415", label: "抒情 6415" },
  { value: "2m7 5(7) 1maj7", label: "爵士 Ⅱ–V–I" }, { value: "1451", label: "搖滾 1451" },
];


function audioIntervals(suffix: string) {
  if (suffix === "m") return [0, 3, 7];
  if (suffix === "dim") return [0, 3, 6];
  if (suffix === "m7") return [0, 3, 7, 10];
  if (suffix === "m7♭5") return [0, 3, 6, 10];
  if (suffix === "maj7") return [0, 4, 7, 11];
  if (suffix === "7") return [0, 4, 7, 10];
  if (suffix === "9") return [0, 4, 7, 10, 14];
  if (suffix === "sus2") return [0, 2, 7];
  if (suffix === "sus4") return [0, 5, 7];
  if (suffix === "add9") return [0, 4, 7, 14];
  if (suffix === "6") return [0, 4, 7, 9];
  if (suffix === "m6") return [0, 3, 7, 9];
  if (suffix === "m9") return [0, 3, 7, 10, 14];
  if (suffix === "maj9") return [0, 4, 7, 11, 14];
  if (suffix === "dim7") return [0, 3, 6, 9];
  if (suffix === "aug") return [0, 4, 8];
  if (suffix === "11") return [0, 4, 7, 10, 14, 17];
  if (suffix === "13") return [0, 4, 7, 10, 14, 21];
  if (suffix === "7♭9") return [0, 4, 7, 10, 13];
  if (suffix === "7♯9") return [0, 4, 7, 10, 15];
  if (suffix === "7♭5") return [0, 4, 6, 10];
  if (suffix === "7♯5") return [0, 4, 8, 10];
  return [0, 4, 7];
}

async function unlockAudioContext() {
  if (typeof window === "undefined") return;
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (!sharedAudioContext || sharedAudioContext.state === "closed") sharedAudioContext = new AudioContextClass();
      if (sharedAudioContext.state !== "running") await sharedAudioContext.resume();
      if (sharedAudioContext.state !== "running") throw new Error("Audio context did not resume");
      const silentBuffer = sharedAudioContext.createBuffer(1, 1, sharedAudioContext.sampleRate);
      const silentSource = sharedAudioContext.createBufferSource();
      silentSource.buffer = silentBuffer;
      silentSource.connect(sharedAudioContext.destination);
      silentSource.start();
      return sharedAudioContext;
    } catch {
      try { await sharedAudioContext?.close(); } catch { /* already unavailable */ }
      sharedAudioContext = null;
    }
  }
}

function chordVoicing(suffix: string, soundStyle: SoundStyle) {
  const intervals = audioIntervals(suffix);
  if (soundStyle === "piano") return [intervals[0], ...intervals.map((interval) => interval + 12)];
  const voicing = [intervals[0], intervals[2], intervals[0] + 12, intervals[1] + 12, intervals[2] + 12];
  if (intervals.length > 3) voicing.push(intervals[intervals.length - 1] + 12);
  return voicing;
}

function scheduleInstrumentNote(ctx: AudioContext, frequency: number, start: number, soundStyle: SoundStyle) {
  if (soundStyle === "piano") {
    [
      { multiple: 1, volume: 0.055, decay: 1.8 },
      { multiple: 2, volume: 0.022, decay: 1.15 },
      { multiple: 3, volume: 0.009, decay: 0.72 },
    ].forEach((partial) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency * partial.multiple, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(partial.volume, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, start + partial.decay);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + partial.decay + 0.05);
    });
    return;
  }

  const oscillator = ctx.createOscillator();
  const overtone = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  const overtoneGain = ctx.createGain();
  const isAcoustic = soundStyle === "acoustic";

  oscillator.type = isAcoustic ? "triangle" : "sawtooth";
  oscillator.frequency.setValueAtTime(frequency, start);
  overtone.type = "sine";
  overtone.frequency.setValueAtTime(frequency * (isAcoustic ? 2.01 : 1.005), start);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(isAcoustic ? 2800 : 1650, start);
  filter.frequency.exponentialRampToValueAtTime(isAcoustic ? 700 : 950, start + 0.9);
  overtoneGain.gain.setValueAtTime(isAcoustic ? 0.018 : 0.009, start);
  overtoneGain.gain.exponentialRampToValueAtTime(0.001, start + (isAcoustic ? 0.5 : 1.1));
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(isAcoustic ? 0.05 : 0.035, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.001, start + (isAcoustic ? 1.15 : 1.55));

  oscillator.connect(filter);
  overtone.connect(overtoneGain).connect(filter);
  filter.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  overtone.start(start);
  oscillator.stop(start + 1.65);
  overtone.stop(start + 1.65);
}

function scheduleChord(ctx: AudioContext, rootPc: number, suffix: string, soundStyle: SoundStyle, bassPc: number | null = null, start = ctx.currentTime) {
  const rootMidi = 48 + rootPc > 52 ? 36 + rootPc : 48 + rootPc;
  const strumDelay = soundStyle === "acoustic" ? 0.032 : soundStyle === "electric" ? 0.024 : 0.012;
  const midiNotes = chordVoicing(suffix, soundStyle).map((interval) => rootMidi + interval);
  if (bassPc !== null) {
    let bassMidi = 36 + bassPc;
    while (bassMidi >= midiNotes[0]) bassMidi -= 12;
    midiNotes.unshift(bassMidi);
  }
  midiNotes.forEach((midi, index) => {
    const frequency = 440 * Math.pow(2, (midi - 69) / 12);
    scheduleInstrumentNote(ctx, frequency, start + index * strumDelay, soundStyle);
  });
}

async function playChord(rootPc: number, suffix: string, soundStyle: SoundStyle, bassPc: number | null = null) {
  const ctx = await unlockAudioContext();
  if (!ctx) return false;
  scheduleChord(ctx, rootPc, suffix, soundStyle, bassPc, ctx.currentTime + 0.01);
  return true;
}

function getVerifiedFingering(rootPc: number, suffix: string, bassPc: number | null = null) {
  if (bassPc !== null) {
    const slashShape = VERIFIED_SLASH_CHORDS[`${rootPc}:${suffix}/${bassPc}`] ?? (suffix === "" ? VERIFIED_SLASH_CHORDS[`${rootPc}:/${bassPc}`] : undefined);
    if (slashShape) return { fingering: slashShape, source: "人工驗證 Slash Chord", sourceType: "verified" as const };
    return null;
  }
  const root = CANONICAL_NOTES[rootPc];
  const exact = VERIFIED_CHORDS[`${root}${suffix}`];
  if (exact) return { fingering: exact, source: "人工驗證標準按法", sourceType: "verified" as const };
  return null;
}

function getMovableFingering(rootPc: number, suffix: string, bassPc: number | null = null) {
  if (bassPc !== null) return null;
  const eFret = (rootPc - 4 + 12) % 12 || 12;
  const aFret = (rootPc - 9 + 12) % 12 || 12;
  const eShapes: Record<string, Fingering> = {
    "": [eFret, eFret + 2, eFret + 2, eFret + 1, eFret, eFret],
    m: [eFret, eFret + 2, eFret + 2, eFret, eFret, eFret],
    "7": [eFret, eFret + 2, eFret, eFret + 1, eFret, eFret],
    m7: [eFret, eFret + 2, eFret, eFret, eFret, eFret],
    maj7: [eFret, eFret + 2, eFret + 1, eFret + 1, eFret, eFret],
  };
  const aShapes: Record<string, Fingering> = {
    "": ["x", aFret, aFret + 2, aFret + 2, aFret + 2, aFret],
    m: ["x", aFret, aFret + 2, aFret + 2, aFret + 1, aFret],
    "7": ["x", aFret, aFret + 2, aFret, aFret + 2, aFret],
    m7: ["x", aFret, aFret + 2, aFret, aFret + 1, aFret],
    maj7: ["x", aFret, aFret + 2, aFret + 1, aFret + 2, aFret],
    "9": ["x", aFret, aFret - 1, aFret, aFret, aFret],
    "m7♭5": ["x", aFret, aFret + 1, aFret, aFret + 1, "x"],
  };

  if (suffix === "9") return { fingering: aShapes["9"], source: "已驗證 A9 移動形狀", sourceType: "movable" as const };
  if (suffix === "m7♭5") return { fingering: aShapes["m7♭5"], source: "已驗證半減七移動形狀", sourceType: "movable" as const };
  const useAShape = aFret < eFret;
  const fingering = useAShape ? aShapes[suffix] : eShapes[suffix];
  if (!fingering) return null;
  const shapeName = useAShape ? `A${suffix}` : `E${suffix}`;
  return { fingering, source: `已驗證 ${shapeName} 移動形狀`, sourceType: "movable" as const };
}

const STRING_MIDI = [40, 45, 50, 55, 59, 64];
const fingeringCache = new Map<string, FingeringOption[]>();

function chordToneIntervals(suffix: string) {
  if (suffix === "m") return [0, 3, 7];
  if (suffix === "dim") return [0, 3, 6];
  if (suffix === "m7") return [0, 3, 7, 10];
  if (suffix === "m7♭5") return [0, 3, 6, 10];
  if (suffix === "maj7") return [0, 4, 7, 11];
  if (suffix === "7") return [0, 4, 7, 10];
  if (suffix === "9") return [0, 4, 7, 10, 2];
  if (suffix === "sus2") return [0, 2, 7];
  if (suffix === "sus4") return [0, 5, 7];
  if (suffix === "add9") return [0, 4, 7, 2];
  if (suffix === "6") return [0, 4, 7, 9];
  if (suffix === "m6") return [0, 3, 7, 9];
  if (suffix === "m9") return [0, 3, 7, 10, 2];
  if (suffix === "maj9") return [0, 4, 7, 11, 2];
  if (suffix === "dim7") return [0, 3, 6, 9];
  if (suffix === "aug") return [0, 4, 8];
  if (suffix === "11") return [0, 4, 7, 10, 2, 5];
  if (suffix === "13") return [0, 4, 7, 10, 2, 9];
  if (suffix === "7♭9") return [0, 4, 7, 10, 1];
  if (suffix === "7♯9") return [0, 4, 7, 10, 3];
  if (suffix === "7♭5") return [0, 4, 6, 10];
  if (suffix === "7♯5") return [0, 4, 8, 10];
  return [0, 4, 7];
}

function essentialIntervals(suffix: string, hasSlashBass: boolean) {
  if (suffix === "9") return hasSlashBass ? [4, 10, 2] : [0, 4, 10, 2];
  if (suffix === "maj7") return hasSlashBass ? [4, 11] : [0, 4, 11];
  if (suffix === "7") return hasSlashBass ? [4, 10] : [0, 4, 10];
  if (suffix === "m7") return hasSlashBass ? [3, 10] : [0, 3, 10];
  if (suffix === "m7♭5") return hasSlashBass ? [3, 6, 10] : [0, 3, 6, 10];
  if (suffix === "sus2") return hasSlashBass ? [2, 7] : [0, 2, 7];
  if (suffix === "sus4") return hasSlashBass ? [5, 7] : [0, 5, 7];
  if (suffix === "add9") return hasSlashBass ? [4, 2] : [0, 4, 2];
  if (suffix === "6") return hasSlashBass ? [4, 9] : [0, 4, 9];
  if (suffix === "m6") return hasSlashBass ? [3, 9] : [0, 3, 9];
  if (suffix === "m9") return hasSlashBass ? [3, 10, 2] : [0, 3, 10, 2];
  if (suffix === "maj9") return hasSlashBass ? [4, 11, 2] : [0, 4, 11, 2];
  if (suffix === "dim7") return hasSlashBass ? [3, 6, 9] : [0, 3, 6, 9];
  if (suffix === "aug") return hasSlashBass ? [4, 8] : [0, 4, 8];
  if (suffix === "11") return hasSlashBass ? [4, 10, 5] : [0, 4, 10, 5];
  if (suffix === "13") return hasSlashBass ? [4, 10, 9] : [0, 4, 10, 9];
  if (suffix === "7♭9") return hasSlashBass ? [4, 10, 1] : [0, 4, 10, 1];
  if (suffix === "7♯9") return hasSlashBass ? [4, 10, 3] : [0, 4, 10, 3];
  if (suffix === "7♭5") return hasSlashBass ? [4, 6, 10] : [0, 4, 6, 10];
  if (suffix === "7♯5") return hasSlashBass ? [4, 8, 10] : [0, 4, 8, 10];
  if (suffix === "dim") return hasSlashBass ? [3, 6] : [0, 3, 6];
  if (suffix === "m") return hasSlashBass ? [3] : [0, 3];
  return hasSlashBass ? [4] : [0, 4];
}

function analyzeFingering(fingering: Fingering, rootPc: number, suffix: string, bassPc: number | null) {
  const sounding = fingering.flatMap((fret, stringIndex) => fret === "x" ? [] : [{ midi: STRING_MIDI[stringIndex] + fret, pc: (STRING_MIDI[stringIndex] + fret) % 12, fret }]);
  if (sounding.length < 4) return null;
  const chordPcs = chordToneIntervals(suffix).map((interval) => (rootPc + interval) % 12);
  const allowedPcs = new Set([...chordPcs, ...(bassPc === null ? [] : [bassPc])]);
  if (sounding.some((note) => !allowedPcs.has(note.pc))) return null;
  const lowest = [...sounding].sort((a, b) => a.midi - b.midi)[0];
  if (bassPc !== null && lowest.pc !== bassPc) return null;
  if (bassPc === null && lowest.pc !== rootPc) return null;
  const present = new Set(sounding.map((note) => note.pc));
  const essentials = essentialIntervals(suffix, bassPc !== null).map((interval) => (rootPc + interval) % 12);
  if (essentials.some((pc) => !present.has(pc))) return null;
  const frets = sounding.map((note) => note.fret).filter((fret) => fret > 0);
  const span = frets.length ? Math.max(...frets) - Math.min(...frets) : 0;
  const hasOpenString = sounding.some((note) => note.fret === 0);
  if (hasOpenString && frets.some((fret) => fret > 5)) return null;
  if (span > 4 || new Set(frets).size > 4) return null;
  const frettedByPosition = new Map<number, number[]>();
  fingering.forEach((fret, stringIndex) => {
    if (typeof fret !== "number" || fret === 0) return;
    const indices = frettedByPosition.get(fret) ?? [];
    indices.push(stringIndex);
    frettedByPosition.set(fret, indices);
  });
  let fingerCount = 0;
  let barreCount = 0;
  const fingerGroups: Array<{ fret: number; strings: number[] }> = [];
  frettedByPosition.forEach((indices, fret) => {
    const sorted = [...indices].sort((a, b) => a - b);
    let currentGroup = sorted.length ? [sorted[0]] : [];
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      const canConnectBarre = fingering.slice(previous + 1, current).every((value) => typeof value === "number" && value >= fret);
      if (canConnectBarre) currentGroup.push(current);
      else { fingerGroups.push({ fret, strings: currentGroup }); currentGroup = [current]; }
    }
    if (currentGroup.length) fingerGroups.push({ fret, strings: currentGroup });
    const groups = fingerGroups.filter((group) => group.fret === fret).length;
    fingerCount += groups;
    barreCount += sorted.length - groups;
  });
  if (fingerCount > 4) return null;
  const fingers: Array<number | null> = Array(6).fill(null);
  fingerGroups.sort((a, b) => a.fret - b.fret || a.strings[0] - b.strings[0]).forEach((group, index) => group.strings.forEach((stringIndex) => { fingers[stringIndex] = index + 1; }));
  const toneCount = chordPcs.filter((pc) => present.has(pc)).length;
  const missing = chordPcs.filter((pc) => !present.has(pc));
  const openCount = sounding.filter((note) => note.fret === 0).length;
  const highestFret = frets.length ? Math.max(...frets) : 0;
  const internalMutes = fingering.filter((value, index) => value === "x" && fingering.slice(0, index).some((item) => item !== "x") && fingering.slice(index + 1).some((item) => item !== "x")).length;
  const lowFretStretch = (frets.length && Math.min(...frets) <= 3 ? span * 0.35 : 0);
  const score = highestFret * 0.15 + span * 0.8 + lowFretStretch + fingerCount * 1.25 + barreCount * 0.12 + internalMutes * 0.45 - openCount * 0.18 + missing.length * 0.8;
  const detail = missing.length
    ? `估計使用 ${fingerCount} 指；省略 ${missing.map((pc) => CANONICAL_NOTES[pc]).join("、")}，保留必要和弦音${bassPc === null ? "" : `；最低音為 ${CANONICAL_NOTES[bassPc]}`}`
    : `估計使用 ${fingerCount} 指；和弦音完整${bassPc === null ? "" : `；最低音為 ${CANONICAL_NOTES[bassPc]}`}`;
  return { score, toneCount, fingerCount, fingers, detail };
}

function generateFingerings(rootPc: number, suffix: string, bassPc: number | null) {
  const chordPcs = new Set(chordToneIntervals(suffix).map((interval) => (rootPc + interval) % 12));
  if (bassPc !== null) chordPcs.add(bassPc);
  const candidates = new Map<string, FingeringOption>();
  for (let baseFret = 1; baseFret <= 9; baseFret += 1) {
    const choices = STRING_MIDI.map((openMidi) => {
      const values: Array<number | "x"> = ["x"];
      if (chordPcs.has(openMidi % 12)) values.push(0);
      for (let fret = baseFret; fret <= baseFret + 4; fret += 1) if (chordPcs.has((openMidi + fret) % 12)) values.push(fret);
      return values;
    });
    const shape: Fingering = [];
    const visit = (stringIndex: number) => {
      if (stringIndex === 6) {
        const analysis = analyzeFingering(shape, rootPc, suffix, bassPc);
        if (!analysis) return;
        const key = shape.join(",");
        candidates.set(key, { fingering: [...shape], source: "樂理自動生成（請自行確認）", sourceType: "generated", ...analysis });
        return;
      }
      choices[stringIndex].forEach((value) => { shape.push(value); visit(stringIndex + 1); shape.pop(); });
    };
    visit(0);
  }
  return [...candidates.values()].sort((a, b) => a.score - b.score);
}

function getFingerings(rootPc: number, suffix: string, bassPc: number | null = null) {
  const cacheKey = `${rootPc}:${suffix}:${bassPc ?? "none"}`;
  const cached = fingeringCache.get(cacheKey);
  if (cached) return cached;
  const trusted = [getVerifiedFingering(rootPc, suffix, bassPc), getMovableFingering(rootPc, suffix, bassPc)]
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .flatMap((entry) => {
      const analysis = analyzeFingering(entry.fingering, rootPc, suffix, bassPc);
      return analysis ? [{ ...entry, ...analysis }] : [];
    });
  const generated = generateFingerings(rootPc, suffix, bassPc);
  const uniqueTrusted = [...new Map(trusted.map((option) => [option.fingering.join(","), option])).values()];
  const trustedKeys = new Set(uniqueTrusted.map((option) => option.fingering.join(",")));
  const generatedOnly = generated.filter((option) => !trustedKeys.has(option.fingering.join(",")));
  // A verified database entry is always the primary answer. Generated shapes
  // may fill missing variants, but can never outrank a standard guitar shape.
  const primary = uniqueTrusted[0] ?? generatedOnly[0];
  const complete = [...uniqueTrusted.slice(1), ...generatedOnly]
    .sort((a, b) => b.toneCount - a.toneCount || a.score - b.score)
    .find((option) => option !== primary);
  const alternative = [...uniqueTrusted.slice(1), ...generatedOnly]
    .find((option) => option !== primary && option !== complete && Math.max(...option.fingering.filter((fret): fret is number => typeof fret === "number")) >= 5);
  const result = [primary, complete, alternative].filter((option): option is FingeringOption => Boolean(option));
  fingeringCache.set(cacheKey, result);
  return result;
}

function getFingering(rootPc: number, suffix: string, bassPc: number | null = null) {
  return getFingerings(rootPc, suffix, bassPc)[0] ?? null;
}

function transitionCost(from: FingeringOption | null, to: FingeringOption) {
  if (!from) return 0;
  return to.fingering.reduce<number>((sum, fret, index) => {
    const previous = from.fingering[index];
    if (fret === "x" || previous === "x") return sum + (fret === previous ? 0 : .55);
    if (fret === 0 || previous === 0) return sum + Math.abs(Number(fret) - Number(previous)) * .18;
    return sum + Math.abs(fret - previous) * .32;
  }, 0);
}

function bestTransitionOption(options: FingeringOption[], previous: FingeringOption | null, next: FingeringOption | null) {
  return [...options].sort((a, b) => (a.score * .22 + transitionCost(previous, a) + transitionCost(next, a)) - (b.score * .22 + transitionCost(previous, b) + transitionCost(next, b)))[0] ?? null;
}

function fingeringDifficulty(rootPc: number, suffix: string, bassPc: number | null = null) {
  const shape = getFingering(rootPc, suffix, bassPc);
  if (!shape) return 10;
  return shape.score;
}

function getCapoSuggestion(chords: Array<{ rootPc: number; suffix: string; bassPc: number | null }>, notes: string[]) {
  if (!chords.length) return null;
  const candidates = Array.from({ length: 10 }, (_, capo) => {
    const shapes = chords.map((chord) => ({
      rootPc: (chord.rootPc - capo + 12) % 12,
      suffix: chord.suffix,
      bassPc: chord.bassPc === null ? null : (chord.bassPc - capo + 12) % 12,
    }));
    const difficulty = shapes.reduce((sum, shape) => sum + fingeringDifficulty(shape.rootPc, shape.suffix, shape.bassPc), 0);
    const heightPenalty = capo * 0.12;
    return { capo, score: difficulty + heightPenalty, difficulty, shapes };
  });
  const current = candidates[0];
  const best = [...candidates].sort((a, b) => a.score - b.score)[0];
  const suggestion = current.difficulty - best.difficulty >= 0.8 ? best : current;
  return {
    ...suggestion,
    shapeNames: suggestion.shapes.map((shape) => `${notes[shape.rootPc]}${shape.suffix}${shape.bassPc === null ? "" : `/${notes[shape.bassPc]}`}`),
    savedDifficulty: Math.max(0, current.difficulty - suggestion.difficulty),
  };
}

function ChordDiagram({ fingering, fingers }: { fingering: Fingering; fingers?: Array<number | null> }) {
  const fretted = fingering.filter((fret): fret is number => typeof fret === "number" && fret > 0);
  const hasOpenString = fingering.some((fret) => fret === 0);
  const minFret = fretted.length ? Math.min(...fretted) : 1;
  const baseFret = !hasOpenString && minFret > 1 ? minFret : 1;
  return (
    <div className="diagram-wrap">
      <div className="diagram-position">{baseFret > 1 ? `從第 ${baseFret} 格開始` : "第 1 格起"}</div>
      <div className="string-status">
        {fingering.map((fret, index) => <span key={index}>{fret === "x" ? "×" : fret === 0 ? "○" : ""}</span>)}
      </div>
      <div className="chord-diagram" aria-label={`吉他指法 ${fingering.join(" ")}`}>
        {Array.from({ length: 6 }).map((_, stringIndex) => <i className="string-line" style={{ left: `${stringIndex * 20}%` }} key={`s${stringIndex}`} />)}
        {Array.from({ length: 6 }).map((_, fretIndex) => <i className="fret-line" style={{ top: `${fretIndex * 20}%` }} key={`f${fretIndex}`} />)}
        {Array.from({ length: 5 }).map((_, fretIndex) => <span className="fret-number" style={{ top: `${(fretIndex + .5) * 20}%` }} key={`n${fretIndex}`}>{baseFret + fretIndex}</span>)}
        {fingering.map((fret, stringIndex) => {
          if (fret === "x" || fret === 0) return null;
          const relative = fret - baseFret + 1;
          if (relative < 1 || relative > 5) return null;
          return <b className="finger-dot" style={{ left: `${stringIndex * 20}%`, top: `${(relative - .5) * 20}%` }} key={`d${stringIndex}`}>{fingers?.[stringIndex] ?? ""}</b>;
        })}
      </div>
      <div className="string-names"><span>E</span><span>A</span><span>D</span><span>G</span><span>B</span><span>e</span></div>
    </div>
  );
}

export default function Home() {
  const [keyPc, setKeyPc] = useState(0);
  const [mode, setMode] = useState<Mode>("major");
  const [noteStyle, setNoteStyle] = useState<NoteStyle>("auto");
  const [progression, setProgression] = useState("1645");
  const [soundStyle, setSoundStyle] = useState<SoundStyle>("acoustic");
  const [capo, setCapo] = useState(0);
  const [selectedChord, setSelectedChord] = useState(0);
  const [fingeringChoice, setFingeringChoice] = useState(0);
  const [fingeringFeedback, setFingeringFeedback] = useState<Record<string, number>>({});
  const [audioMessage, setAudioMessage] = useState("");
  const [settingsReady, setSettingsReady] = useState(false);

  const key = KEYS.find((item) => item.pc === keyPc) ?? KEYS[0];
  const useFlats = noteStyle === "flat" || (noteStyle === "auto" && key.style === "flat");
  const notes = useFlats ? FLAT_NOTES : SHARP_NOTES;
  const data = MODE_DATA[mode];
  const parsed = useMemo(() => parseDegrees(progression), [progression]);

  const degreeChords = data.intervals.map((interval, index) => {
    const rootPc = (keyPc + interval) % 12;
    return { degree: index + 1, rootPc, chord: `${notes[rootPc]}${data.qualities[index]}`, suffix: data.qualities[index], quality: data.qualities[index], roman: data.roman[index] };
  });

  const result = parsed.map((item) => {
    const base = degreeChords[item.degree - 1];
    const rootPc = (base.rootPc + item.accidental + 12) % 12;
    const suffix = suffixForDegree(base.quality, item.accidental, item.extension);
    const accidentalLabel = item.accidental === 1 ? "♯" : item.accidental === -1 ? "♭" : "";
    const shapePc = (rootPc - capo + 12) % 12;
    const bassPc = item.bassDegree === null ? null : (keyPc + data.intervals[item.bassDegree - 1] + item.bassAccidental + 12) % 12;
    const shapeBassPc = bassPc === null ? null : (bassPc - capo + 12) % 12;
    const bassAccidentalLabel = item.bassAccidental === 1 ? "♯" : item.bassAccidental === -1 ? "♭" : "";
    const slashDegree = item.bassDegree === null ? "" : `/${bassAccidentalLabel}${item.bassDegree}`;
    const chordRootName = noteForDegree(rootPc, item.accidental, notes);
    const bassName = bassPc === null ? "" : noteForDegree(bassPc, item.bassAccidental, notes);
    const alteredRoman = item.accidental === 0 ? base.roman : `${accidentalLabel}${["I", "II", "III", "IV", "V", "VI", "VII"][item.degree - 1]}`;
    return {
      ...base, rootPc, suffix, bassPc, shapePc, shapeBassPc,
      roman: alteredRoman,
      displayDegree: `${accidentalLabel}${item.degree}${item.extension ? `(${item.extension})` : ""}${slashDegree}`,
      chord: `${chordRootName}${suffix}${bassPc === null ? "" : `/${bassName}`}`,
      shapeChord: `${notes[shapePc]}${suffix}${shapeBassPc === null ? "" : `/${notes[shapeBassPc]}`}`,
    };
  });

  const activeIndex = Math.min(selectedChord, Math.max(0, result.length - 1));
  const active = result[activeIndex];
  const rawFingeringOptions = active ? getFingerings(active.shapePc, active.suffix, active.shapeBassPc) : [];
  const feedbackKey = (option: FingeringOption) => `${active?.shapePc}:${active?.suffix}:${active?.shapeBassPc ?? "none"}:${option.fingering.join(",")}`;
  const easyOption = rawFingeringOptions[0]?.sourceType !== "generated"
    ? rawFingeringOptions[0]
    : [...rawFingeringOptions].sort((a, b) => (a.score + (fingeringFeedback[feedbackKey(a)] ?? 0) * 1.8) - (b.score + (fingeringFeedback[feedbackKey(b)] ?? 0) * 1.8))[0];
  const previousShape = activeIndex > 0 ? getFingering(result[activeIndex - 1].shapePc, result[activeIndex - 1].suffix, result[activeIndex - 1].shapeBassPc) : null;
  const nextShape = activeIndex < result.length - 1 ? getFingering(result[activeIndex + 1].shapePc, result[activeIndex + 1].suffix, result[activeIndex + 1].shapeBassPc) : null;
  const transitionShape = result.length > 1 ? bestTransitionOption(rawFingeringOptions, previousShape, nextShape) : null;
  const fingerTabs = [
    easyOption && { label: easyOption.sourceType === "verified" ? "標準" : easyOption.sourceType === "movable" ? "可靠移調" : "自動生成", option: easyOption },
    rawFingeringOptions[1] && { label: rawFingeringOptions[1].sourceType === "generated" ? "生成備選" : "可靠移調", option: rawFingeringOptions[1] },
    rawFingeringOptions[2] && { label: rawFingeringOptions[2].sourceType === "generated" ? "其他生成" : "其他把位", option: rawFingeringOptions[2] },
    transitionShape && { label: "好切換", option: transitionShape },
  ].filter((entry): entry is { label: string; option: FingeringOption } => Boolean(entry));
  const shape = fingerTabs[Math.min(fingeringChoice, Math.max(0, fingerTabs.length - 1))]?.option ?? null;
  const capoSuggestion = getCapoSuggestion(result.map((chord) => ({ rootPc: chord.rootPc, suffix: chord.suffix, bassPc: chord.bassPc })), notes);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = window.localStorage.getItem("band-roach-sound");
      if (saved === "acoustic" || saved === "electric" || saved === "piano") setSoundStyle(saved);
      try { setFingeringFeedback(JSON.parse(window.localStorage.getItem("band-roach-fingering-feedback") ?? "{}")); } catch { setFingeringFeedback({}); }
      try {
        const settings = JSON.parse(window.localStorage.getItem("band-roach-workbench") ?? "null") as { keyPc?: number; mode?: Mode; noteStyle?: NoteStyle; progression?: string; capo?: number } | null;
        if (settings) {
          if (Number.isInteger(settings.keyPc) && settings.keyPc! >= 0 && settings.keyPc! <= 11) setKeyPc(settings.keyPc!);
          if (settings.mode === "major" || settings.mode === "minor") setMode(settings.mode);
          if (settings.noteStyle === "auto" || settings.noteStyle === "sharp" || settings.noteStyle === "flat") setNoteStyle(settings.noteStyle);
          if (typeof settings.progression === "string") setProgression(settings.progression);
          if (Number.isInteger(settings.capo) && settings.capo! >= 0 && settings.capo! <= 11) setCapo(settings.capo!);
        }
      } catch { /* Keep safe defaults when an older saved value is malformed. */ }
      setSettingsReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!settingsReady) return;
    window.localStorage.setItem("band-roach-workbench", JSON.stringify({ keyPc, mode, noteStyle, progression, capo }));
  }, [keyPc, mode, noteStyle, progression, capo, settingsReady]);

  const rateFingering = (delta: number) => {
    if (!shape) return;
    setFingeringFeedback((current) => {
      const next = { ...current, [feedbackKey(shape)]: (current[feedbackKey(shape)] ?? 0) + delta };
      window.localStorage.setItem("band-roach-fingering-feedback", JSON.stringify(next));
      return next;
    });
  };

  const changeSoundStyle = (style: SoundStyle) => {
    setSoundStyle(style);
    window.localStorage.setItem("band-roach-sound", style);
  };

  const playProgression = async () => {
    const ctx = await unlockAudioContext();
    if (!ctx) { setAudioMessage("音訊被瀏覽器暫停，請再按一次播放"); return; }
    setAudioMessage("");
    const start = ctx.currentTime + 0.04;
    result.forEach((chord, index) => scheduleChord(ctx, chord.rootPc, chord.suffix, soundStyle, chord.bassPc, start + index * 0.72));
  };

  const playSingleChord = async (rootPc: number, suffix: string, bassPc: number | null) => {
    const played = await playChord(rootPc, suffix, soundStyle, bassPc);
    setAudioMessage(played ? "" : "音訊被瀏覽器暫停，請再點一次和弦");
  };
  const keyName = notes[keyPc];
  const convertDegree = (token: string) => {
    const item = parseDegrees(token)[0];
    if (!item) return token;
    const base = degreeChords[item.degree - 1];
    const rootPc = (base.rootPc + item.accidental + 12) % 12;
    const suffix = suffixForDegree(base.quality, item.accidental, item.extension);
    const bassPc = item.bassDegree === null ? null : (keyPc + data.intervals[item.bassDegree - 1] + item.bassAccidental + 12) % 12;
    const chordRootName = noteForDegree(rootPc, item.accidental, notes);
    const bassName = bassPc === null ? "" : noteForDegree(bassPc, item.bassAccidental, notes);
    return `${chordRootName}${suffix}${bassPc === null ? "" : `/${bassName}`}`;
  };

  return (
    <main>
      <header className="topbar"><a className="brand" href="#top"><span className="brand-mark">🪳</span><span>Band Roach</span></a><span className="header-note">蟑螂也要學會自己改譜。</span></header>

      <section className="hero" id="top"><div className="eyebrow">CHORD DEGREE TRANSLATOR</div><h1>樂理不夠。<br />蟑螂來湊。</h1><p>把級數譜即時翻成和弦，換調、Capo 與吉他指法一次看懂。</p></section>

      <section className="workbench" aria-label="和弦級數轉換器">
        <div className="controls-panel controls-primary">
          <div className="control-group"><label htmlFor="key-select">1. 選調</label><div className="select-row"><select id="key-select" value={keyPc} onChange={(e) => { setKeyPc(Number(e.target.value)); setFingeringChoice(0); }}>{KEYS.map((item) => <option key={item.label} value={item.pc}>{item.label}</option>)}</select><div className="segmented"><button className={mode === "major" ? "active" : ""} onClick={() => { setMode("major"); setFingeringChoice(0); }}>大調</button><button className={mode === "minor" ? "active" : ""} onClick={() => { setMode("minor"); setFingeringChoice(0); }}>小調</button></div></div></div>
          <div className="control-group"><label htmlFor="progression">2. 輸入級數</label><div className="degree-input-wrap"><input id="progression" value={progression} onChange={(e) => { setProgression(e.target.value); setSelectedChord(0); setFingeringChoice(0); }} placeholder="1645、5(7♭9)、4sus2、1add9、5/2" autoComplete="off" /><span className="input-badge">級數</span></div><p className="input-help">延伸：<b>sus2</b>、<b>sus4</b>、<b>add9</b>、<b>6</b>、<b>m9</b>、<b>maj9</b>、<b>dim7</b>、<b>aug</b>、<b>11</b>、<b>13</b>、<b>7♭9</b>；Slash Chord：<b>5(9)/2</b>。</p></div>
        </div>

        <div className={`result-panel ${capo ? "capo-active" : ""}`}>
          <div className="result-heading"><div><span className="result-kicker">{capo ? `Capo 第 ${capo} 格 · 手型譜` : `實際音高 · ${keyName} ${data.label}`}</span><h2>{parsed.length ? parsed.map((item) => item.raw.replace("b", "♭").replace("#", "♯")).join(" · ") : "輸入級數"}</h2></div><div className="play-controls"><label>音色<select className="sound-select" aria-label="播放音色" value={soundStyle} onChange={(event) => changeSoundStyle(event.target.value as SoundStyle)}><option value="acoustic">木吉他</option><option value="electric">電吉他</option><option value="piano">柔和鋼琴</option></select></label><button className="play-all" onClick={playProgression} disabled={!result.length}><span>▶</span> 播放</button>{audioMessage && <small role="status">{audioMessage}</small>}</div></div>
          {capo > 0 && result.length > 0 && <div className="play-this-row" aria-live="polite"><span>你的手按這排</span><strong>{result.map((item) => item.shapeChord).join(" → ")}</strong><small>Capo 已夾第 {capo} 格</small></div>}
          <div className="chord-results" aria-live="polite">{result.length ? result.map((item, index) => <button className={`chord-card ${selectedChord === index ? "selected" : ""}`} key={`${item.displayDegree}-${index}`} onClick={() => { setSelectedChord(index); setFingeringChoice(0); void playSingleChord(item.rootPc, item.suffix, item.bassPc); }}><span className="degree-pill">{item.displayDegree}</span>{capo > 0 && <em>要按</em>}<strong>{capo > 0 ? item.shapeChord : item.chord}</strong><span>{item.roman}</span>{capo > 0 && <small className="sounding-chord">實際發聲 {item.chord}</small>}<small>點擊看指法</small></button>) : <div className="empty-state">輸入 1–7，就會在這裡看到和弦。</div>}</div>
          <div className="result-summary"><span>{capo ? "實際發聲（樂理對照）" : "快速念法"}</span><strong>{result.length ? (capo ? result.map((item) => item.chord).join(" → ") : `${keyName} ${data.label}：${result.map((item) => item.chord).join(" → ")}`) : "—"}</strong></div>
        </div>

        <div className="controls-panel controls-secondary">
          <div className="preset-list">{PRESETS.map((preset) => <button key={preset.value} onClick={() => { setProgression(preset.value); setSelectedChord(0); setFingeringChoice(0); }}><strong>{preset.value}</strong><span>{preset.label.replace(preset.value, "")}</span></button>)}</div>
          <div className="capo-control"><div><label htmlFor="capo-range">3. Capo</label><strong>{capo === 0 ? "不夾" : `第 ${capo} 格`}</strong></div><input id="capo-range" type="range" min="0" max="11" value={capo} onChange={(e) => { setCapo(Number(e.target.value)); setFingeringChoice(0); }} />
            {capoSuggestion && <div className="capo-suggestion"><span>初學者建議</span><strong>{capoSuggestion.capo === 0 ? "目前不夾最好按" : `建議夾第 ${capoSuggestion.capo} 格`}</strong><p>{capoSuggestion.capo === 0 ? "這組已經以常用開放和弦為主。" : `改按 ${capoSuggestion.shapeNames.join(" → ")}，可減少封閉和弦。`}</p>{capoSuggestion.capo !== capo && <button onClick={() => { setCapo(capoSuggestion.capo); setFingeringChoice(0); }}>套用建議</button>}</div>}
          </div>
          <div className="notation-row"><span>記譜偏好</span><div className="tiny-segmented">{(["auto", "sharp", "flat"] as NoteStyle[]).map((style) => <button key={style} className={noteStyle === style ? "active" : ""} onClick={() => setNoteStyle(style)}>{style === "auto" ? "自動" : style === "sharp" ? "升號" : "降號"}</button>)}</div></div>
        </div>
      </section>

      {active && shape && <section className="fingering-section">
        <div className="fingering-copy"><span className="eyebrow">GUITAR FINGERING</span><h2>{active.chord} 吉他指法</h2><p>{capo ? <>歌曲實際要聽到 <strong>{active.chord}</strong>；Capo 夾第 {capo} 格時，請按 <strong>{active.shapeChord}</strong> 的手型。</> : <>目前不使用 Capo，直接按 <strong>{active.chord}</strong>。</>}</p>{fingerTabs.length > 1 && <div className="fingering-tabs" aria-label="選擇和弦指法">{fingerTabs.map((tab, index) => <button key={`${tab.label}-${index}`} className={fingeringChoice === index ? "active" : ""} onClick={() => setFingeringChoice(index)}>{tab.label}</button>)}</div>}<div className="fingering-meta"><span>{shape.source}</span><code>{shape.fingering.join(" · ")}</code></div><p className="voicing-detail">✓ 已核對實際音：{shape.detail}</p><div className="fingering-feedback"><span>這個按法實際如何？</span><button onClick={() => rateFingering(-1)}>👍 好按</button><button onClick={() => rateFingering(1)}>👎 太難</button></div><p className="diagram-tip">× 不彈　○ 空弦　圓點數字為建議手指（1 食指、4 小指）。左側是實際琴格。</p></div>
        <div className="diagram-card"><div className="diagram-title"><span>{capo ? "手型" : "和弦"}</span><strong>{active.shapeChord}</strong></div><ChordDiagram fingering={shape.fingering} fingers={shape.fingers} /></div>
      </section>}

      {active && !shape && <section className="fingering-unavailable"><span className="eyebrow">GUITAR FINGERING</span><h2>{active.chord} 暫無可靠指法</h2><p>系統沒有找到同時符合和弦音、指定低音與可按跨度的答案，因此不會用其他和弦代替。</p></section>}

      <section className="extension-guide"><div><span className="eyebrow">7、9 與 Slash Chord 怎麼輸入？</span><h2>括號寫延伸，斜線寫指定低音。</h2></div><div className="syntax-cards"><article><code>57</code><strong>5 → 7</strong><span>兩個級數</span></article><article><code>5(7)</code><strong>V7 和弦</strong><span>屬七和弦</span></article><article><code>1maj7</code><strong>Imaj7</strong><span>大七和弦</span></article><article><code>2m7</code><strong>iim7</strong><span>小七和弦</span></article><article><code>5(9)</code><strong>V9</strong><span>屬九和弦</span></article><article><code>5/2</code><strong>G/D</strong><span>指定低音</span></article></div></section>

      <ScanWorkbench convertDegree={convertDegree} keyLabel={`${keyName} ${data.label}`} />

      <section className="degree-map"><div className="section-heading"><div><span className="eyebrow">YOUR CHEAT SHEET</span><h2>{keyName} {data.label}級數表</h2></div><p>先認出級數，再慢慢記住它在音樂裡的工作。</p></div><div className="degree-grid">{degreeChords.map((item, index) => <button key={item.degree} onClick={() => void playChord(item.rootPc, item.suffix, soundStyle)}><span className="map-number">{item.degree}</span><strong>{item.chord}</strong><span>{item.roman}</span><small>{DEGREE_NAMES[index]}</small><em>{DEGREE_JOBS[index]}</em></button>)}</div></section>

      <footer><strong>Band Roach · Friends Beta 1.0</strong><span>標準按法優先，樂理引擎負責補位。</span></footer>
    </main>
  );
}
