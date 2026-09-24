import { API_BASE, getToken } from './api.js';

const MAX_SIDE = 1600; // px: sharp on a phone, a few hundred KB as JPEG
const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("That photo couldn't be opened"));
  img.src = src;
});
const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Shrink a picked photo before upload (drawing it also applies the camera's rotation) and make a tiny
 * blurred stand-in that shows while the real one loads. Small animated GIFs are sent as they are.
 */
export async function prepareImage(file) {
  const src = URL.createObjectURL(file);
  try {
    const img = await loadImage(src);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    let blob;
    if (file.type === 'image/gif' && file.size < 3e6) blob = file;
    else {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; // transparent PNGs get a white background instead of black
      g.fillRect(0, 0, w, h);
      g.drawImage(img, 0, 0, w, h);
      blob = await toBlob(c, 'image/jpeg', 0.8);
      if (!blob) throw new Error("That photo couldn't be prepared");
    }
    const t = document.createElement('canvas');
    t.width = 24; t.height = Math.max(1, Math.round((24 * h) / w));
    t.getContext('2d').drawImage(img, 0, 0, t.width, t.height);
    return { blob, w, h, thumb: t.toDataURL('image/jpeg', 0.5), local: URL.createObjectURL(blob) };
  } finally {
    URL.revokeObjectURL(src);
  }
}

/** Upload a file for a chat. Reports progress (0 to 1) and resolves to { id, url, type }. */
export function uploadMedia(convId, blob, onProgress, name) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', `${API_BASE}/api/media?conversation_id=${encodeURIComponent(convId)}${name ? `&name=${encodeURIComponent(name)}` : ''}`);
    const token = getToken();
    if (token) x.setRequestHeader('Authorization', `Bearer ${token}`);
    x.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onload = () => {
      let d = {};
      try { d = JSON.parse(x.responseText); } catch { /* not JSON */ }
      if (x.status >= 200 && x.status < 300 && d.media) resolve(d.media);
      else reject(new Error(d.error || `Upload failed (${x.status})`));
    };
    x.onerror = () => reject(new Error('No connection'));
    x.send(blob);
  });
}

export const mediaUrl = (u) => (u && u.startsWith('/') ? `${API_BASE}${u}` : u);

/** Save a photo: the share sheet on phones (it has "Save Image"), a download elsewhere. */
export async function savePhoto(url, name = 'linkup-photo.jpg') {
  const blob = await (await fetch(mediaUrl(url))).blob();
  const file = new File([blob], name, { type: blob.type || 'image/jpeg' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
