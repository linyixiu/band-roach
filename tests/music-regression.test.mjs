import assert from "node:assert/strict";
import test from "node:test";
import { capoShapePitchClass, parseDegrees, resolveProgression } from "../app/music-theory.ts";
import { VERIFIED_CHORDS, VERIFIED_SLASH_CHORDS } from "../app/chord-fingerings.ts";

test("C major keeps the seven basic chords correct", () => {
  assert.deepEqual(resolveProgression("1 2 3 4 5 6 7", 0, "major"), ["C", "Dm", "Em", "F", "G", "Am", "Bdim"]);
});

test("natural minor keeps its diatonic qualities", () => {
  assert.deepEqual(resolveProgression("1 2 3 4 5 6 7", 9, "minor"), ["Am", "Bdim", "C", "Dm", "Em", "F", "G"]);
});

test("bare degree six is minor, not a sixth chord", () => {
  assert.deepEqual(resolveProgression("2 3 6", 0, "major"), ["Dm", "Em", "Am"]);
  assert.equal(parseDegrees("6")[0].extension, "");
  assert.deepEqual(resolveProgression("6(6)", 0, "major"), ["A6"]);
});

test("extensions and altered dominants are not split", () => {
  assert.deepEqual(resolveProgression("5(7) 1maj7 2m7 5(9) 5(7b9)", 0, "major"), ["G7", "Cmaj7", "Dm7", "G9", "G7♭9"]);
});

test("altered degrees use readable enharmonic spelling", () => {
  assert.deepEqual(resolveProgression("b3 b6 b7 #4", 0, "major"), ["E♭", "A♭", "B♭", "F♯"]);
});

test("slash chords preserve the requested bass", () => {
  assert.deepEqual(resolveProgression("5(9)/2 1/3 4/6", 0, "major"), ["G9/D", "C/E", "F/A"]);
});

test("flat keys stay readable by default", () => {
  assert.deepEqual(resolveProgression("1645", 5, "major"), ["F", "Dm", "B♭", "C"]);
  assert.deepEqual(resolveProgression("1645", 10, "major"), ["B♭", "Gm", "E♭", "F"]);
});

test("capo conversion preserves sounding pitch class", () => {
  for (let sounding = 0; sounding < 12; sounding += 1) {
    for (let capo = 0; capo < 12; capo += 1) {
      const shape = capoShapePitchClass(sounding, capo);
      assert.equal((shape + capo) % 12, sounding);
    }
  }
});

test("verified open chords cannot silently regress", () => {
  assert.deepEqual(VERIFIED_CHORDS.C, ["x", 3, 2, 0, 1, 0]);
  assert.deepEqual(VERIFIED_CHORDS.Am, ["x", 0, 2, 2, 1, 0]);
  assert.deepEqual(VERIFIED_CHORDS.G7, [3, 2, 0, 0, 0, 1]);
  assert.deepEqual(VERIFIED_CHORDS.Bm, ["x", 2, 4, 4, 3, 2]);
  assert.deepEqual(VERIFIED_SLASH_CHORDS["7:/2"], ["x", "x", 0, 0, 0, 3]);
});
