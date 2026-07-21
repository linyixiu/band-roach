"use client";
/* eslint-disable @next/next/no-img-element -- score images are local Blob URLs chosen by the user */

import { useEffect, useRef, useState } from "react";

type OverlayLayer = "chord" | "note";
type Overlay = { id: string; groupId: string; rawToken: string; degree: string; chord: string; x: number; y: number; width: number; height: number; confidence: number; layer: OverlayLayer; showOnScore: boolean };
type ScorePoint = { x: number; y: number };
type ChordBand = { id: string; y1: number; y2: number };
type OcrMessage = { progress?: number; status?: string };
type OcrWorker = {
  setParameters: (parameters: Record<string, string>) => Promise<void>;
  recognize: (image: string, options: Record<string, never>, output: { blocks: boolean; text: boolean }) => Promise<{ data: { blocks?: Array<{ paragraphs: Array<{ lines: Array<{ words: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number }; confidence: number }> }> }> }> } }>;
  terminate: () => Promise<void>;
};
type TesseractBrowser = { createWorker: (language: string, oem: number, options: { logger: (message: OcrMessage) => void }) => Promise<OcrWorker>; PSM: { SPARSE_TEXT: string } };
type SavedScanSession = { id: "current"; image: Blob; imageSize: { width: number; height: number }; overlays: Overlay[]; candidates: Overlay[]; overrides: Record<string, Partial<Overlay>>; selectedBands: ChordBand[]; hasRecognized: boolean; keyLabel: string; savedAt: number };

const SCAN_DB = "band-roach-scan";
const SCAN_STORE = "sessions";

const openScanDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = window.indexedDB.open(SCAN_DB, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(SCAN_STORE)) request.result.createObjectStore(SCAN_STORE, { keyPath: "id" });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const readScanSession = async () => {
  const db = await openScanDb();
  return new Promise<SavedScanSession | null>((resolve, reject) => {
    const request = db.transaction(SCAN_STORE, "readonly").objectStore(SCAN_STORE).get("current");
    request.onsuccess = () => { db.close(); resolve((request.result as SavedScanSession | undefined) ?? null); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
};

const writeScanSession = async (session: SavedScanSession) => {
  const db = await openScanDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(SCAN_STORE, "readwrite");
    transaction.objectStore(SCAN_STORE).put(session);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
};

const deleteScanSession = async () => {
  const db = await openScanDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(SCAN_STORE, "readwrite");
    transaction.objectStore(SCAN_STORE).delete("current");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
};

const loadOcrEngine = () => new Promise<TesseractBrowser>((resolve, reject) => {
  const browserWindow = window as typeof window & { Tesseract?: TesseractBrowser };
  if (browserWindow.Tesseract) return resolve(browserWindow.Tesseract);
  const existing = document.querySelector<HTMLScriptElement>('script[data-band-roach-ocr]');
  const script = existing ?? document.createElement("script");
  const finish = () => browserWindow.Tesseract ? resolve(browserWindow.Tesseract) : reject(new Error("OCR engine unavailable"));
  script.addEventListener("load", finish, { once: true });
  script.addEventListener("error", () => reject(new Error("OCR engine failed to load")), { once: true });
  if (!existing) {
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.min.js";
    script.async = true;
    script.dataset.bandRoachOcr = "true";
    document.head.appendChild(script);
  }
});

const DEGREE_PATTERN = /[#b]?[1-7](?:\((?:maj9|maj7|m9|m7|add9|sus2|sus4|dim7|aug|13|11|9|7|6|m6|7b9|7#9)\)|maj9|maj7|m9|m7|add9|sus2|sus4|dim7|aug|13|11|9|7|6|m6|7b9|7#9)?(?:\/[#b]?[1-7])?/gi;

export function classifyScoreLayers(items: Overlay[], imageHeight: number) {
  if (!items.length) return items;
  const groups = [...new Map(items.map((item) => [item.groupId, item])).values()];
  const typicalHeight = groups.map((item) => item.height).sort((a, b) => a - b)[Math.floor(groups.length / 2)] ?? 18;
  // Keep rows separate: the old generous tolerance merged a chord row with
  // the melody immediately below it, which made nearly every note look valid.
  const rowTolerance = Math.min(28, Math.max(10, typicalHeight * .9));
  const rows: Array<{ center: number; groups: Overlay[] }> = [];
  [...groups].sort((a, b) => (a.y + a.height / 2) - (b.y + b.height / 2)).forEach((item) => {
    const center = item.y + item.height / 2;
    const row = rows.find((candidate) => Math.abs(candidate.center - center) <= rowTolerance);
    if (row) {
      row.groups.push(item);
      row.center = row.groups.reduce((sum, entry) => sum + entry.y + entry.height / 2, 0) / row.groups.length;
    } else rows.push({ center, groups: [item] });
  });
  rows.sort((a, b) => a.center - b.center);
  const chordGroupIds = new Set<string>();
  rows.forEach((row, index) => {
    const next = rows[index + 1];
    const hasChordQuality = row.groups.some((item) => /(?:m|maj|sus|add|dim|aug|\(|\)|\/)/i.test(item.rawToken));
    const isCompactHarmonyRow = row.groups.length <= 12;
    const gap = next ? next.center - row.center : Infinity;
    const followedByDenseNotation = Boolean(next)
      && gap > rowTolerance * .8
      && gap < Math.max(imageHeight * .15, typicalHeight * 7)
      && next!.groups.length >= Math.max(6, row.groups.length * 1.7);
    if (isCompactHarmonyRow && (hasChordQuality || followedByDenseNotation)) {
      row.groups.forEach((item) => chordGroupIds.add(item.groupId));
    }
  });
  return items.map((item) => {
    const layer: OverlayLayer = chordGroupIds.has(item.groupId) ? "chord" : "note";
    return { ...item, layer, showOnScore: layer === "chord" };
  });
}

export function mergeOcrChordSevenths(items: Overlay[], convertDegree: (token: string) => string) {
  const groups = new Map<string, Overlay[]>();
  items.forEach((item) => groups.set(item.groupId, [...(groups.get(item.groupId) ?? []), item]));
  const mergedGroupIds = new Set<string>();
  const merged: Overlay[] = [];
  groups.forEach((group, groupId) => {
    const ordered = [...group].sort((a, b) => a.x - b.x);
    const rawToken = ordered[0]?.rawToken ?? "";
    const isChordSeventh = ordered.length === 2 && /^[1-7]7$/.test(rawToken) && ordered.every((item) => item.layer === "chord");
    if (!isChordSeventh) return;
    const degree = `${rawToken[0]}(7)`;
    const left = Math.min(...ordered.map((item) => item.x));
    const right = Math.max(...ordered.map((item) => item.x + item.width));
    mergedGroupIds.add(groupId);
    merged.push({
      ...ordered[0],
      id: `${groupId}-seventh`,
      degree,
      chord: convertDegree(degree),
      x: left,
      width: right - left,
      confidence: Math.min(...ordered.map((item) => item.confidence)),
      layer: "chord",
      showOnScore: true,
    });
  });
  return [...items.filter((item) => !mergedGroupIds.has(item.groupId)), ...merged].sort((a, b) => a.y - b.y || a.x - b.x);
}

export default function ScanWorkbench({ convertDegree, keyLabel }: { convertDegree: (token: string) => string; keyLabel: string }) {
  const [imageUrl, setImageUrl] = useState("");
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("等待上傳樂譜");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [hasRecognized, setHasRecognized] = useState(false);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [rowSelectMode, setRowSelectMode] = useState(false);
  const [selectedBands, setSelectedBands] = useState<ChordBand[]>([]);
  const [selectionStart, setSelectionStart] = useState<ScorePoint | null>(null);
  const [selectionCurrent, setSelectionCurrent] = useState<ScorePoint | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const selectionStartRef = useRef<ScorePoint | null>(null);
  const rowSelectModeRef = useRef(false);
  const ocrCandidatesRef = useRef<Overlay[]>([]);
  const selectedBandsRef = useRef<ChordBand[]>([]);
  const imageRef = useRef<HTMLImageElement>(null);
  const currentImageBlobRef = useRef<Blob | null>(null);
  const overlayOverridesRef = useRef<Record<string, Partial<Overlay>>>({});
  const lastKeyLabelRef = useRef(keyLabel);
  const convertDegreeRef = useRef(convertDegree);

  useEffect(() => { convertDegreeRef.current = convertDegree; }, [convertDegree]);

  useEffect(() => {
    let cancelled = false;
    void readScanSession().then((saved) => {
      if (cancelled || !saved?.image) return;
      const url = URL.createObjectURL(saved.image);
      currentImageBlobRef.current = saved.image;
      ocrCandidatesRef.current = saved.candidates ?? [];
      overlayOverridesRef.current = saved.overrides ?? {};
      selectedBandsRef.current = saved.selectedBands ?? [];
      lastKeyLabelRef.current = saved.keyLabel || lastKeyLabelRef.current;
      setImageUrl(url);
      setImageSize(saved.imageSize);
      setOverlays(saved.overlays ?? []);
      setSelectedBands(saved.selectedBands ?? []);
      setHasRecognized(saved.hasRecognized);
      setStatus(`已復原上次進度${saved.keyLabel ? ` · ${saved.keyLabel}` : ""}`);
      setSaveState("saved");
    }).catch(() => setSaveState("error")).finally(() => { if (!cancelled) setSessionReady(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!sessionReady || !imageUrl || !currentImageBlobRef.current) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      void writeScanSession({ id: "current", image: currentImageBlobRef.current!, imageSize, overlays, candidates: ocrCandidatesRef.current, overrides: overlayOverridesRef.current, selectedBands, hasRecognized, keyLabel, savedAt: Date.now() })
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [sessionReady, imageUrl, imageSize, overlays, selectedBands, hasRecognized, keyLabel]);

  useEffect(() => {
    if (!sessionReady || lastKeyLabelRef.current === keyLabel) return;
    lastKeyLabelRef.current = keyLabel;
    setOverlays((items) => {
      const updated = items.map((item) => ({ ...item, chord: convertDegreeRef.current(item.degree) }));
      overlayOverridesRef.current = Object.fromEntries(Object.entries(overlayOverridesRef.current).map(([id, changes]) => [id, { ...changes, chord: convertDegreeRef.current(changes.degree ?? items.find((item) => item.id === id)?.degree ?? "1") }]));
      return updated;
    });
    ocrCandidatesRef.current = ocrCandidatesRef.current.map((item) => ({ ...item, chord: convertDegreeRef.current(item.degree) }));
    setStatus(`已依 ${keyLabel} 更新和弦`);
  }, [keyLabel, sessionReady]);

  const loadFile = (file?: File) => {
    if (!file) return;
    currentImageBlobRef.current = file;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      setImageUrl(url);
      setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
      setOverlays([]);
      setSelectedBands([]);
      setHasRecognized(false);
      setIsRecognizing(false);
      ocrCandidatesRef.current = [];
      overlayOverridesRef.current = {};
      selectedBandsRef.current = [];
      setRowSelectMode(false);
      rowSelectModeRef.current = false;
      selectionStartRef.current = null;
      setSelectionStart(null);
      setSelectionCurrent(null);
      setStatus("圖片已載入，可以開始辨識");
      setSaveState("saving");
    };
    image.src = url;
  };

  const addMatches = (text: string, bbox: { x0: number; y0: number; x1: number; y1: number }, confidence: number, bucket: Overlay[]) => {
    const cleaned = text.replace(/♭/g, "b").replace(/♯/g, "#").replace(/\s/g, "");
    const compact = /^[1-7]{2,}$/.test(cleaned) ? cleaned.split("") : (cleaned.match(DEGREE_PATTERN) ?? []);
    const groupId = `${bbox.x0}-${bbox.y0}-${bbox.x1}-${bbox.y1}-${cleaned}`;
    compact.forEach((degree, index) => {
      const segmentWidth = (bbox.x1 - bbox.x0) / compact.length;
      bucket.push({
        id: `${bbox.x0}-${bbox.y0}-${index}-${degree}`,
        groupId,
        rawToken: cleaned,
        degree,
        chord: convertDegree(degree),
        x: bbox.x0 + segmentWidth * index,
        y: bbox.y0,
        width: Math.max(18, segmentWidth),
        height: Math.max(18, bbox.y1 - bbox.y0),
        confidence,
        layer: "note",
        showOnScore: false,
      });
    });
  };

  const recognize = async () => {
    if (!imageUrl || isRecognizing) return;
    setIsRecognizing(true);
    setStatus("正在載入本機辨識引擎…");
    setProgress(0.03);
    try {
      // Keep this browser-only engine outside the server bundle. It is loaded
      // only after the player explicitly starts recognition.
      const { createWorker, PSM } = await loadOcrEngine();
      const worker = await createWorker("eng", 1, { logger: (message) => {
        if (typeof message.progress === "number") setProgress(message.progress);
        if (message.status) setStatus(message.status === "recognizing text" ? "正在辨識級數位置…" : "正在準備辨識引擎…");
      }});
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        tessedit_char_whitelist: "1234567#b()/majsudig+9",
        preserve_interword_spaces: "1",
      });
      const result = await worker.recognize(imageUrl, {}, { blocks: true, text: true });
      const found: Overlay[] = [];
      result.data.blocks?.forEach((block) => block.paragraphs.forEach((paragraph) => paragraph.lines.forEach((line) => line.words.forEach((word) => addMatches(word.text, word.bbox, word.confidence, found)))));
      await worker.terminate();
      const candidates = found.map((item) => ({ ...item, layer: "note" as const, showOnScore: false }));
      ocrCandidatesRef.current = candidates;
      overlayOverridesRef.current = {};
      selectedBandsRef.current = [];
      setOverlays(candidates);
      setSelectedBands([]);
      setHasRecognized(candidates.length > 0);
      setRowSelectMode(false);
      rowSelectModeRef.current = false;
      selectionStartRef.current = null;
      setSelectionStart(null);
      setSelectionCurrent(null);
      setStatus(found.length ? `辨識完成，下一步請點選「框選」` : "沒有可靠辨識結果，請換清晰照片或手動新增");
      setProgress(1);
    } catch {
      setStatus("辨識引擎載入失敗；仍可手動新增標記");
      setProgress(0);
    } finally {
      setIsRecognizing(false);
    }
  };

  const applyOverlayOverrides = (items: Overlay[]) => items.map((item) => ({ ...item, ...(overlayOverridesRef.current[item.id] ?? {}) })).filter((item) => item.showOnScore);

  const updateOverlay = (id: string, changes: Partial<Overlay>) => {
    overlayOverridesRef.current[id] = { ...(overlayOverridesRef.current[id] ?? {}), ...changes };
    setOverlays((items) => items.map((item) => item.id === id ? { ...item, ...changes } : item));
  };

  const activeOverlay = overlays.find((item) => item.id === activeId) ?? null;

  const updateActiveDegree = (degree: string) => {
    if (!activeId) return;
    updateOverlay(activeId, { degree, rawToken: degree, chord: convertDegree(degree) });
  };

  const nudgeActiveOverlay = (dx: number, dy: number) => {
    if (!activeOverlay) return;
    updateOverlay(activeOverlay.id, {
      x: Math.max(0, Math.min(imageSize.width, activeOverlay.x + dx)),
      y: Math.max(0, Math.min(imageSize.height, activeOverlay.y + dy)),
    });
  };

  const removeActiveOverlay = () => {
    if (!activeId) return;
    overlayOverridesRef.current[activeId] = { ...(overlayOverridesRef.current[activeId] ?? {}), showOnScore: false };
    setOverlays((items) => items.filter((item) => item.id !== activeId));
    setActiveId(null);
    setStatus("已刪除標記");
  };

  const moveActiveOverlay = (event: React.MouseEvent<HTMLDivElement>) => {
    if (rowSelectMode || !activeId || !imageSize.width) return;
    if ((event.target as HTMLElement).closest(".score-overlay")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    updateOverlay(activeId, { x: (event.clientX - rect.left) / rect.width * imageSize.width, y: (event.clientY - rect.top) / rect.height * imageSize.height });
  };

  const pointerPosition = (event: React.PointerEvent<HTMLDivElement>): ScorePoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(imageSize.width, (event.clientX - rect.left) / rect.width * imageSize.width)),
      y: Math.max(0, Math.min(imageSize.height, (event.clientY - rect.top) / rect.height * imageSize.height)),
    };
  };

  const beginBandSelection = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!rowSelectModeRef.current || !imageSize.height || (event.target as HTMLElement).closest(".score-overlay")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointerPosition(event);
    selectionStartRef.current = point;
    setSelectionStart(point);
    setSelectionCurrent(point);
  };

  const continueBandSelection = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!rowSelectModeRef.current || !selectionStartRef.current) return;
    event.preventDefault();
    setSelectionCurrent(pointerPosition(event));
  };

  const finishBandSelection = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = selectionStartRef.current;
    if (!rowSelectModeRef.current || !start) return;
    event.preventDefault();
    const end = pointerPosition(event);
    const minimumHeight = Math.max(24, imageSize.height * .025);
    const rawTop = Math.min(start.y, end.y);
    const rawBottom = Math.max(start.y, end.y);
    const centerY = (rawTop + rawBottom) / 2;
    const y1 = Math.max(0, rawBottom - rawTop < minimumHeight ? centerY - minimumHeight / 2 : rawTop);
    const y2 = Math.min(imageSize.height, rawBottom - rawTop < minimumHeight ? centerY + minimumHeight / 2 : rawBottom);
    // A live PWA can retain component state while its JavaScript bundle is
    // refreshed. Fall back to the live state when the newer ref cache has not
    // been populated yet, so the first selection never needs a second OCR run.
    const sourceCandidates = ocrCandidatesRef.current.length
      ? ocrCandidatesRef.current
      : overlays.map((item) => ({ ...item, layer: "note" as const, showOnScore: false }));
    if (!sourceCandidates.length) {
      selectionStartRef.current = null;
      setSelectionStart(null);
      setSelectionCurrent(null);
      setStatus("尚未有辨識資料，請先按「辨識級數」");
      return;
    }
    if (!ocrCandidatesRef.current.length) ocrCandidatesRef.current = sourceCandidates;
    const bands = [...selectedBandsRef.current, { id: `band-${Date.now()}`, y1, y2 }];
    selectedBandsRef.current = bands;
    setSelectedBands(bands);
    const visibleCandidates = sourceCandidates.map((item) => {
      const itemCenter = item.y + item.height / 2;
      const showOnScore = bands.some((band) => itemCenter >= band.y1 && itemCenter <= band.y2);
      return { ...item, layer: showOnScore ? "chord" as const : "note" as const, showOnScore };
    });
    const manualItems = overlays.filter((item) => item.id.startsWith("manual-"));
    setOverlays([...applyOverlayOverrides(mergeOcrChordSevenths(visibleCandidates, convertDegree)), ...manualItems]);
    selectionStartRef.current = null;
    setSelectionStart(null);
    setSelectionCurrent(null);
    setStatus(`已框選 ${bands.length} 條和弦列；可繼續框選，完成後按「完成框選」`);
  };

  const undoLastSelection = () => {
    const bands = selectedBandsRef.current.slice(0, -1);
    selectedBandsRef.current = bands;
    setSelectedBands(bands);
    const candidates = ocrCandidatesRef.current.map((item) => {
      const itemCenter = item.y + item.height / 2;
      const showOnScore = bands.some((band) => itemCenter >= band.y1 && itemCenter <= band.y2);
      return { ...item, layer: showOnScore ? "chord" as const : "note" as const, showOnScore };
    });
    const manualItems = overlays.filter((item) => item.id.startsWith("manual-"));
    setOverlays([...applyOverlayOverrides(mergeOcrChordSevenths(candidates, convertDegree)), ...manualItems]);
    selectionStartRef.current = null;
    setActiveId(null);
    setStatus(bands.length ? `已回到上一步，目前保留 ${bands.length} 條框選` : "已撤銷框選，可重新選取");
  };

  const addManual = () => {
    if (!imageSize.width) return;
    const id = `manual-${Date.now()}`;
    const item: Overlay = { id, groupId: id, rawToken: "1", degree: "1", chord: convertDegree("1"), x: imageSize.width * .08, y: imageSize.height * .12, width: 60, height: 28, confidence: 100, layer: "chord", showOnScore: true };
    setOverlays((items) => [...items, item]);
    setActiveId(item.id);
  };

  const clearSavedWork = async () => {
    if (!window.confirm("要清除目前照片與所有框選、修正嗎？")) return;
    await deleteScanSession();
    currentImageBlobRef.current = null;
    ocrCandidatesRef.current = [];
    overlayOverridesRef.current = {};
    selectedBandsRef.current = [];
    setImageUrl("");
    setImageSize({ width: 0, height: 0 });
    setOverlays([]);
    setSelectedBands([]);
    setHasRecognized(false);
    setRowSelectMode(false);
    rowSelectModeRef.current = false;
    setActiveId(null);
    setStatus("等待上傳樂譜");
    setSaveState("idle");
  };

  const renderExport = async () => {
    const image = imageRef.current;
    if (!image) return null;
    const canvas = document.createElement("canvas");
    canvas.width = imageSize.width;
    canvas.height = imageSize.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const fontSize = Math.max(20, Math.round(canvas.width / 42));
    ctx.font = `900 ${fontSize}px system-ui, sans-serif`;
    ctx.textBaseline = "bottom";
    overlays.filter((item) => item.showOnScore).forEach((item) => {
      const labelWidth = ctx.measureText(item.chord).width + 18;
      const labelY = Math.max(fontSize + 8, item.y - 4);
      ctx.fillStyle = "rgba(247,241,232,.94)";
      ctx.fillRect(item.x - 5, labelY - fontSize - 7, labelWidth, fontSize + 10);
      ctx.fillStyle = "#1f1e1b";
      ctx.fillText(item.chord, item.x + 4, labelY);
    });
    return canvas;
  };

  const exportPng = async () => {
    const canvas = await renderExport();
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `Band-Roach-${keyLabel}-覆蓋譜.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const exportPdf = async () => {
    const canvas = await renderExport();
    if (!canvas) return;
    const { jsPDF } = await import("jspdf");
    const landscape = canvas.width > canvas.height;
    const pdf = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "px", format: [canvas.width, canvas.height] });
    pdf.addImage(canvas.toDataURL("image/jpeg", .92), "JPEG", 0, 0, canvas.width, canvas.height);
    pdf.save(`Band-Roach-${keyLabel}-覆蓋譜.pdf`);
  };

  const receiveDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragActive(false);
    loadFile(event.dataTransfer.files?.[0]);
  };

  const previewBand = selectionStart === null || selectionCurrent === null ? null : {
    y1: Math.min(selectionStart.y, selectionCurrent.y), y2: Math.max(selectionStart.y, selectionCurrent.y),
  };
  const visibleOverlays = overlays.filter((item) => item.showOnScore);
  const stepTitle = isRecognizing
    ? "正在辨識級數，請稍候…"
    : !hasRecognized
      ? "請先點選「辨識級數」，完成後再框選"
      : rowSelectMode
        ? "按住並上下拖曳，決定和弦列的厚度"
        : visibleOverlays.length
          ? `已顯示 ${visibleOverlays.length} 個和弦；可繼續框選或匯出`
          : "辨識完成，點選「框選」後才會出現和弦";

  return <section className={`scan-workbench ${dragActive ? "drag-active" : ""}`} id="scan-score" onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false); }} onDrop={receiveDrop}>
    <div className="scan-heading"><div><span className="eyebrow">PHOTO SCORE BETA</span><h2>拍照，把級數直接蓋成和弦。</h2><p>辨識後先框選譜面上方的和弦列，只有框內的級數會顯示成和弦。</p></div><div className="upload-options"><label className="upload-score">直接拍照<input type="file" accept="image/*" capture="environment" onChange={(event) => loadFile(event.target.files?.[0])} /></label><label className="upload-score secondary">選擇照片<input type="file" accept="image/*" onChange={(event) => loadFile(event.target.files?.[0])} /></label></div></div>
    {!imageUrl ? <div className="scan-empty"><strong>{dragActive ? "放開即可加入" : "拖曳圖片到這裡"}</strong><span>也可以拍照或從手機照片／檔案中選擇。建議使用角度平整的單頁級數譜。</span></div> : <>
      <div className={`scan-step-callout ${rowSelectMode ? "active" : ""}`}><span>{isRecognizing ? "辨識中" : rowSelectMode ? "正在框選" : hasRecognized ? "下一步" : "步驟 1"}</span><strong>{stepTitle}</strong><small>流程：辨識級數 → 框選和弦列 → 顯示和弦。框選固定橫跨整張圖片。</small></div>
      <div className="scan-actions"><button className={!hasRecognized ? "primary" : ""} onClick={recognize} disabled={isRecognizing}>{hasRecognized ? "重新辨識" : "辨識級數"}</button><button className={rowSelectMode ? "active" : ""} disabled={!hasRecognized || isRecognizing} onClick={() => { rowSelectModeRef.current = true; setRowSelectMode(true); setActiveId(null); selectionStartRef.current = null; setSelectionStart(null); setSelectionCurrent(null); setStatus("框選已開啟，請在圖片上按住並上下拖曳"); }}>框選</button><button disabled={!selectedBands.length} onClick={undoLastSelection}>回上一步</button><button onClick={addManual}>＋ 手動新增</button><span>{status}</span>{progress > 0 && progress < 1 && <progress value={progress} max="1" />}</div>
      <div className="scan-layout"><div className={`score-stage ${rowSelectMode ? "selecting-rows" : ""}`} onClick={moveActiveOverlay} onPointerDown={beginBandSelection} onPointerMove={continueBandSelection} onPointerUp={finishBandSelection} onPointerCancel={() => { selectionStartRef.current = null; setSelectionStart(null); setSelectionCurrent(null); }}>{/* User-selected local image blobs cannot use framework image optimization. */}<img ref={imageRef} src={imageUrl} alt="上傳的級數譜" draggable={false} onDragStart={(event) => event.preventDefault()} />{selectedBands.map((band) => <span key={band.id} className="chord-selection-band" style={{ top: `${band.y1 / imageSize.height * 100}%`, height: `${(band.y2 - band.y1) / imageSize.height * 100}%` }} />)}{previewBand && <span className="chord-selection-band preview" style={{ top: `${previewBand.y1 / imageSize.height * 100}%`, height: `${Math.max(1, (previewBand.y2 - previewBand.y1) / imageSize.height * 100)}%` }} />}{visibleOverlays.map((item) => <button key={item.id} className={`score-overlay ${item.confidence < 70 ? "low-confidence" : ""} ${activeId === item.id ? "active" : ""}`} style={{ left: `${item.x / imageSize.width * 100}%`, top: `${item.y / imageSize.height * 100}%` }} onClick={(event) => { event.stopPropagation(); setActiveId(item.id); }}><strong>{item.chord}</strong><small>{item.degree}</small></button>)}</div></div>
      {activeOverlay && <div className="overlay-quick-editor">
        <strong>修正和弦</strong>
        <label>級數<input value={activeOverlay.degree} onChange={(event) => updateActiveDegree(event.target.value)} /></label>
        <label>顯示和弦<input value={activeOverlay.chord} onChange={(event) => updateOverlay(activeOverlay.id, { chord: event.target.value })} /></label>
        <div className="overlay-nudges" aria-label="微調和弦位置"><button onClick={() => nudgeActiveOverlay(0, -8)} aria-label="向上移動">↑</button><button onClick={() => nudgeActiveOverlay(-8, 0)} aria-label="向左移動">←</button><button onClick={() => nudgeActiveOverlay(8, 0)} aria-label="向右移動">→</button><button onClick={() => nudgeActiveOverlay(0, 8)} aria-label="向下移動">↓</button></div>
        <button className="overlay-delete" onClick={removeActiveOverlay}>刪除</button>
        <button className="overlay-done" onClick={() => setActiveId(null)}>完成</button>
      </div>}
      <div className="export-actions"><button onClick={exportPng}>匯出 PNG</button><button onClick={exportPdf}>匯出 PDF</button><button className="clear-saved-work" onClick={() => void clearSavedWork()}>清除目前樂譜</button><span>目前調性：{keyLabel} · 選取標記後點圖片可移動位置</span><span className={`save-indicator ${saveState}`}>{saveState === "saving" ? "儲存中…" : saveState === "saved" ? "✓ 已自動保存" : saveState === "error" ? "無法保存，請先匯出" : ""}</span></div>
    </>}
  </section>;
}
