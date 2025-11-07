import React, { useRef, useState, useEffect, useMemo } from "react";
import JSZip from "jszip";
import saveAs from "file-saver";

// ---------------- Utility helpers ----------------
// Robust download helper (FileSaver fallback if unavailable)
function triggerDownload(blobOrFile, filename) {
  try {
    if (typeof saveAs === "function") {
      saveAs(blobOrFile, filename);
      return true;
    }
  } catch (_) {}
  try {
    const url = URL.createObjectURL(blobOrFile);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "download";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (e) {
    console.error("Download failed", e);
    return false;
  }
}
// Synchronous click-only download to keep all clicks within a single user gesture
function triggerDownloadSync(blobOrFile, filename) {
  try {
    const url = URL.createObjectURL(blobOrFile);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "download";
    // Important: append & click synchronously to preserve user activation
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return true;
  } catch (e) {
    console.error("Sync download failed", e);
    return false;
  }
}

// Map a position (0-based among FILLED tiles) to Amazon type
const imageTypeForIndex = (i) => (i === 0 ? "MAIN" : `PT${String(i).padStart(2, "0")}`);
// Sanitize strings for filenames
const normalize = (s) => (s || "").trim().toUpperCase().replace(/\s+/g, "_").replace(/[^A-Z0-9_]/g, "_");
// Safe extension extractor
const getExt = (name) => {
  const m = /\.([^.]+)$/.exec(name || "");
  return (m ? m[1] : "jpg").toLowerCase();
};

// Dev-time sanity checks (lightweight "tests")
function runDevTestsOnce() {
  if (typeof window === "undefined") return;
  if (window.__RENAMER_TESTS__) return;
  window.__RENAMER_TESTS__ = true;
  try {
    console.assert(imageTypeForIndex(0) === "MAIN", "index 0 → MAIN");
    console.assert(imageTypeForIndex(1) === "PT01", "index 1 → PT01");
    console.assert(imageTypeForIndex(2) === "PT02", "index 2 → PT02");
    console.assert(imageTypeForIndex(9) === "PT09", "index 9 → PT09");
    console.assert(imageTypeForIndex(10) === "PT10", "index 10 → PT10");
    console.assert(normalize("Tw Nose Kit!") === "TW_NOSE_KIT_", "normalize strips specials");
    console.assert(normalize("women refresh") === "WOMEN_REFRESH", "normalize underscores spaces");
    console.assert(normalize("") === "", "normalize empty stays empty");
    console.assert(getExt("photo.JPG") === "jpg", "getExt handles JPG");
    console.assert(getExt("asset.png") === "png", "getExt handles png");
    console.assert(getExt("") === "jpg", "getExt fallback");
    console.assert(/^[0-9]{6}$/.test("202511"), "YYYYMM passes");
    console.assert(!/^[0-9]{6}$/.test("2025-11"), "YYYYMM rejects hyphen");
    console.assert(typeof triggerDownload === 'function', 'triggerDownload present');
    console.assert(typeof triggerDownloadSync === 'function', 'triggerDownloadSync present');
  } catch (e) {
    // ignore test failures in production
  }
}

export default function ImageRenamerApp() {
  runDevTestsOnce();

  // fixed 10 slots; each slot is either null or {id, file, url, error}
  const [files, setFiles] = useState(Array(10).fill(null));
  const [product, setProduct] = useState("TW-NOSEKIT");
  const [date, setDate] = useState("202511");
  const [diff, setDiff] = useState("WOMENREFRESH");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pendingLinks, setPendingLinks] = useState([]); // [{name, url}]
  const [status, setStatus] = useState("");
  const inputRef = useRef(null);
  const dragIndex = useRef(null);

  const filled = useMemo(() => files.filter(Boolean), [files]);
  const normalizedProduct = useMemo(() => normalize(product), [product]);
  const normalizedDiff = useMemo(() => normalize(diff), [diff]);

  const buildFilename = (index, item) => {
    const type = imageTypeForIndex(index);
    const ext = getExt(item?.file?.name);
    return `${normalizedProduct}_${date}_${normalizedDiff}_${type}.${ext}`;
  };

  // Cleanup object/data URLs and pending links on unmount/update
  useEffect(() => () => {
    files.forEach((it) => {
      if (it && typeof it.url === "string" && it.url.startsWith("blob:")) {
        URL.revokeObjectURL(it.url);
      }
    });
    try {
      pendingLinks.forEach((l) => l?.url?.startsWith?.("blob:") && URL.revokeObjectURL(l.url));
    } catch(_) {}
  }, [files, pendingLinks]);

  // ---------------- File ingestion ----------------
  const onPickFiles = async (e) => {
    const picked = Array.from(e.target.files || []);
    if (!picked.length) return;
    await addFiles(picked);
    e.target.value = "";
  };

  async function fileToPreview(file) {
    // Use DataURL for maximum compatibility (Opera, sandboxed iframes, etc.)
    return await new Promise((resolve) => {
      try {
        const fr = new FileReader();
        fr.onload = () => {
          const result = typeof fr.result === "string" ? fr.result : "";
          const ok = result.startsWith("data:");
          resolve({ id: crypto.randomUUID(), file, url: ok ? result : "", error: !ok });
        };
        fr.onerror = () => resolve({ id: crypto.randomUUID(), file, url: "", error: true });
        fr.readAsDataURL(file);
      } catch (_) {
        resolve({ id: crypto.randomUUID(), file, url: "", error: true });
      }
    });
  }

  async function addFiles(fileList, targetIndex = null) {
    const imgs = fileList
      .filter((f) => f && ((f.type && f.type.startsWith("image/")) || \.\(jpe?g|png)$/.test(f.name || "")))
      .slice(0, 10);

    if (!imgs.length) return;

    const prepared = await Promise.all(imgs.map(fileToPreview));

    setFiles((prev) => {
      const next = [...prev];
      if (targetIndex != null) {
        next[targetIndex] = prepared[0] || null;
      } else {
        let k = 0;
        for (let i = 0; i < next.length && k < prepared.length; i++) {
          if (!next[i]) next[i] = prepared[k++];
        }
      }
      return next;
    });
  }

  // ---------------- Downloads ----------------
  const downloadZip = async () => {
    if (!filled.length) return alert("Add images first.");
    setBusy(true);
    setStatus("Preparing ZIP…");
    try {
      const zip = new JSZip();
      await Promise.all(
        filled.map(async (item, i) => {
          if (!item?.file) return;
          const buf = await item.file.arrayBuffer();
          zip.file(buildFilename(i, item), buf);
        })
      );
      const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
      const name = `${normalizedProduct}_${date}_${normalizedDiff}.zip`;

      // Always prepare a manual link first (visible regardless of auto success)
      const manualUrl = URL.createObjectURL(blob);
      setPendingLinks((prev) => [{ name, url: manualUrl }, ...prev.filter((l) => l.name !== name)]);

      // Try auto download
      const ok = triggerDownload(blob, name);
      setStatus(ok ? "ZIP download triggered." : "Browser blocked ZIP download — manual link shown below.");
      if (!ok) {
        alert("Your browser blocked the ZIP download. Click the manual link below.");
      }
    } catch (e) {
      console.error(e);
      setStatus("Error while creating ZIP.");
      alert("Something went wrong while creating the ZIP. Check console for details.");
    } finally { setBusy(false); }
  };

  const downloadIndividually = async () => {
    if (!filled.length) return alert("Add images first.");
    setBusy(true);
    setStatus("Triggering individual downloads…");
    try {
      const manual = [];

      // Fire all clicks synchronously in a single user gesture (Slack-style)
      for (let i = 0; i < filled.length; i++) {
        const item = filled[i];
        if (!item || !item.file) continue;
        const filename = buildFilename(i, item);

        const ok = triggerDownloadSync(item.file, filename);
        if (!ok) {
          // Prepare manual fallback for ones that didn't fire
          const manualUrl = URL.createObjectURL(item.file);
          manual.push({ name: filename, url: manualUrl });
        }
      }

      if (manual.length) {
        setPendingLinks((prev) => [...manual, ...prev]);
        setStatus("Your browser limited multiple automatic downloads — manual links are shown below.");
      } else {
        setStatus("All downloads triggered. If prompted, allow multiple downloads for this site.");
      }
    } catch (e) {
      console.error(e);
      setStatus("Error while starting individual downloads.");
      alert("Something went wrong while starting the downloads. Check console for details.");
    } finally { setBusy(false); }
  };

  // Preview of final filenames
  const computeFinalNames = () => filled.map((item, i) => buildFilename(i, item));

  const handleRemove = (index) => {
    setFiles((prev) => prev.map((item, i) => (i === index ? null : item)));
  };

  const swapFiles = (from, to) => {
    if (from === null || from === to) return;
    setFiles((prev) => {
      const next = [...prev];
      const temp = next[from];
      next[from] = next[to];
      next[to] = temp;
      return next;
    });
  };

  const openSlotPicker = (slotIndex) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const picked = Array.from(e.target.files || []);
      if (picked.length) await addFiles(picked.slice(0, 1), slotIndex);
    };
    input.click();
  };

  // ---------------- Render ----------------
  return (
    <div className="min-h-screen w-full bg-gray-50 text-gray-900">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-semibold mb-6">Amazon Image Renamer — Drag, Map & Download</h1>

        {/* Name Fields */}
        <div className="grid md:grid-cols-4 gap-4 bg-white p-4 rounded-2xl shadow mb-6">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Product Name</label>
            <input value={product} onChange={(e) => setProduct(e.target.value)} className="border rounded-xl px-3 py-2" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Date (YYYYMM)</label>
            <input value={date} onChange={(e) => setDate(e.target.value)} className="border rounded-xl px-3 py-2" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Differentiator</label>
            <input value={diff} onChange={(e) => setDiff(e.target.value)} className="border rounded-xl px-3 py-2" />
          </div>
          <div className="flex items-end flex-wrap gap-2">
            <button onClick={downloadZip} disabled={busy} className={`px-4 py-2 rounded-xl text-white ${busy ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}> 
              {busy ? 'Building ZIP…' : 'Download ZIP'}
            </button>
            <button onClick={downloadIndividually} disabled={busy} className={`px-4 py-2 rounded-xl text-white ${busy ? 'bg-gray-400' : 'bg-green-600 hover:bg-green-700'}`}> 
              {busy ? 'Saving…' : 'Download Individually'}
            </button>
          </div>
        </div>

        {/* Upload Area */}
        <div className="bg-white border-2 border-dashed rounded-2xl p-6 text-center shadow">
          <input ref={inputRef} type="file" multiple accept="image/*" onChange={onPickFiles} className="hidden" />
          <p className="mb-2">Drop up to 10 images here or</p>
          <button onClick={() => inputRef.current?.click()} className="px-4 py-2 rounded-xl bg-gray-900 text-white hover:bg-black">Browse Files</button>
        </div>

        {/* Clear all button container */}
        <div className="flex justify-end mt-4">
          <button onClick={() => setFiles(Array(10).fill(null))} className="px-3 py-2 rounded-xl border hover:bg-gray-50" disabled={busy}>Clear all</button>
        </div>
        <div className="mt-1 text-xs text-gray-500">Drag to reorder. Click an empty tile to add a single image, or drop a file onto a specific tile.</div>

        {/* Status */}
        {status && (
          <div className="mt-3 text-sm text-gray-700">{status}</div>
        )}

        {/* Manual download fallback links, if needed */}
        {pendingLinks.length > 0 && (
          <div className="mt-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <strong>Manual download links</strong>
              <button
                className="text-xs px-2 py-1 rounded border border-amber-300 hover:bg-amber-100"
                onClick={() => {
                  try { pendingLinks.forEach((l) => l?.url?.startsWith?.('blob:') && URL.revokeObjectURL(l.url)); } catch(_) {}
                  setPendingLinks([]);
                }}
              >
                Clear links
              </button>
            </div>
            <ul className="text-sm list-disc pl-5 space-y-1">
              {pendingLinks.map((l, i) => (
                <li key={i}>
                  <a href={l.url} download={l.name} className="underline">{l.name}</a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Image Grid: always 10 placeholders */}
        <div className="mt-6">
          <ul className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {files.map((item, idx) => {
              const rank = item ? filled.indexOf(item) : null;
              const badge = (typeof rank === 'number' && rank >= 0) ? imageTypeForIndex(rank) : null;
              const isError = !!(item && item.error);
              return (
                <li
                  key={idx}
                  draggable={!!item}
                  onDragStart={(e) => {
                    if (!item) return;
                    dragIndex.current = idx;
                    try { e.dataTransfer.effectAllowed = 'move'; } catch(_){}}
                  onDragOver={(e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch(_){} }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const dropped = Array.from(e.dataTransfer.files || []);
                    if (dropped.length && !item) {
                      addFiles(dropped.slice(0, 1), idx);
                    } else {
                      const from = dragIndex.current;
                      swapFiles(from, idx);
                    }
                    dragIndex.current = null;
                  }}
                  className="relative bg-white rounded-2xl shadow border overflow-hidden"
                >
                  {item && item.url ? (
                    <img src={item.url} alt="preview" className="max-h-44 w-full object-contain bg-gray-100 pointer-events-none" />
                  ) : item ? (
                    <div className="h-44 w-full flex flex-col items-center justify-center bg-red-50 text-red-700 text-xs p-3 text-center">
                      <div className="font-semibold mb-1">Preview failed</div>
                      <div className="opacity-80">File will still be renamed & downloaded.</div>
                      <button
                        type="button"
                        onClick={() => openSlotPicker(idx)}
                        className="mt-2 px-2 py-1 text-xs rounded border border-red-300 hover:bg-red-100"
                      >
                        Replace image
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openSlotPicker(idx)}
                      className="h-44 w-full flex items-center justify-center bg-gray-100 text-gray-500 text-sm hover:bg-gray-200"
                    >
                      Click here to upload image
                    </button>
                  )}

                  {/* Error badge */}
                  {isError && (
                    <div className="absolute top-2 left-2 text-xs font-semibold bg-red-600 text-white px-2 py-1 rounded-full">Preview error</div>
                  )}

                  {/* MAIN/PTxx badge (top-left) */}
                  {badge && (
                    /* Match the pill look of the Remove button but keep orange colour */
                    <div className="absolute top-2 left-2 text-xs bg-orange-600 text-white px-2 py-1 rounded-full">
                      {badge}
                    </div>
                  )}

                  {item && (
                    <button
                      onClick={() => handleRemove(idx)}
                      className="absolute top-2 right-2 text-xs bg-red-600 text-white hover:bg-red-700 px-2 py-1 rounded-full"
                    >
                      Remove
                    </button>
                  )}

                  <div className="p-3 text-xs text-gray-600">
                    {item ? (
                      <>
                        <div className="text-[10px] uppercase text-gray-500 mb-0.5">Original file name:</div>
                        <div className="font-mono break-all" title={item?.file?.name || ''}>{item?.file?.name || 'Unknown'}</div>
                      </>
                    ) : (
                      <div className="text-gray-400 text-center">Slot empty</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Final filenames preview */}
        <div className="mt-8 bg-white rounded-2xl shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-medium">Final filenames preview</h2>
            <button
              onClick={async () => {
                const names = computeFinalNames().join('\n');
                try { await navigator.clipboard.writeText(names); setCopied(true); setTimeout(() => setCopied(false), 1200);} catch(_){} 
              }
              disabled={!filled.length}
              className="px-3 py-2 rounded-xl border hover:bg-gray-50"
            >
              {copied ? 'Copied!' : 'Copy list'}
            </button>
          </div>
          {filled.length ? (
            <pre className="text-xs bg-gray-50 p-3 rounded-xl overflow-auto">{computeFinalNames().join('\n')}</pre>
          ) : (
            <p className="text-sm text-gray-500">Add images to see the generated names.</p>
          )}
        </div>
      </div>
    </div>
  );
}