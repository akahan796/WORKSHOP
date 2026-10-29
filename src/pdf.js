// PDF slide rendering with pdf.js (loaded on first use).
import { html, useEffect, useRef, useState } from './lib.js';

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/';
let lib = null;
async function pdfjs() {
  if (!lib) {
    lib = await import(PDFJS + 'pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
  }
  return lib;
}

const docs = new Map(); // url → Promise<PDFDocumentProxy>
function openDoc(url) {
  if (!docs.has(url)) docs.set(url, pdfjs().then((p) => p.getDocument(url).promise));
  return docs.get(url);
}

// Renders one page, scaled to fit its container.
export function PdfSlide({ url, page, onPageCount }) {
  const box = useRef(null);
  const canvas = useRef(null);
  const [error, setError] = useState('');
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  // The page count doesn't depend on the layout, so report it as soon as the file
  // opens (rendering waits for the box to be measured, which can be late).
  useEffect(() => {
    if (!url) return;
    let alive = true;
    openDoc(url).then((doc) => alive && onPageCount && onPageCount(doc.numPages)).catch(() => {});
    return () => { alive = false; };
  }, [url]);

  useEffect(() => {
    if (!url || !size.w) return;
    let task, cancelled = false;
    (async () => {
      try {
        const doc = await openDoc(url);
        if (cancelled) return;
        const p = await doc.getPage(Math.min(Math.max(1, page), doc.numPages));
        const base = p.getViewport({ scale: 1 });
        const scale = Math.min(size.w / base.width, size.h / base.height);
        const dpr = window.devicePixelRatio || 1;
        const vp = p.getViewport({ scale: scale * dpr });
        const c = canvas.current;
        c.width = vp.width; c.height = vp.height;
        c.style.width = vp.width / dpr + 'px'; c.style.height = vp.height / dpr + 'px';
        task = p.render({ canvasContext: c.getContext('2d'), viewport: vp });
        await task.promise;
        setError('');
      } catch (e) {
        if (e && e.name !== 'RenderingCancelledException' && !cancelled) setError('Could not load this PDF.');
      }
    })();
    return () => { cancelled = true; task && task.cancel(); };
  }, [url, page, size.w, size.h]);

  return html`<div class="pdf-box" ref=${box}>${error ? html`<p class="error">${error}</p>` : html`<canvas ref=${canvas}></canvas>`}</div>`;
}
