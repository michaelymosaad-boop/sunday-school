import QRCode from 'qrcode';

const W = 600;
const H = 820;
const FONT = 'Cairo, Tahoma, "Segoe UI", Arial, sans-serif';

// شيل العلامات الممنوعة في أسماء الملفات على ويندوز/موبايل
export function safeFileName(s) {
  return String(s ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// بيصغّر الخط لحد ما النص يدخل في العرض المتاح
function fitText(ctx, text, weight, maxSize, minSize, maxWidth) {
  let size = maxSize;
  ctx.font = `${weight} ${size}px ${FONT}`;
  while (size > minSize && ctx.measureText(text).width > maxWidth) {
    size -= 2;
    ctx.font = `${weight} ${size}px ${FONT}`;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function renderCardBlob({ link, name, className, code }) {
  const qrUrl = await QRCode.toDataURL(link, { width: 460, margin: 1 });
  const qr = await loadImage(qrUrl);
  // الكانفاس مش بيستنى خطوط الويب لوحده، فلازم نحمّل Cairo الأول عشان العربي يظهر صح
  if (document.fonts?.load) {
    await Promise.all([
      document.fonts.load(`800 44px Cairo`, name),
      document.fonts.load(`600 30px Cairo`, className || 'ا'),
    ]).catch(() => {});
  }

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#c7d2fe';
  ctx.lineWidth = 6;
  roundRect(ctx, 12, 12, W - 24, H - 24, 28);
  ctx.stroke();

  ctx.drawImage(qr, (W - 460) / 2, 50, 460, 460);

  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = '#1e1b4b';
  fitText(ctx, name, 800, 44, 22, W - 70);
  ctx.fillText(name, W / 2, 580);

  if (className) {
    ctx.fillStyle = '#475569';
    fitText(ctx, className, 600, 30, 18, W - 70);
    ctx.fillText(className, W / 2, 640);
  }

  ctx.direction = 'ltr';
  ctx.fillStyle = '#64748b';
  ctx.font = `700 34px ui-monospace, Menlo, Consolas, monospace`;
  ctx.fillText(String(code ?? '').split('').join(' '), W / 2, 715);

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('فشل إنشاء الصورة'))), 'image/png')
  );
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// أسماء فريدة حتى لو اتنين ليهم نفس الاسم والكود
export function uniqueNames(names) {
  const seen = new Map();
  return names.map((n) => {
    const count = seen.get(n) ?? 0;
    seen.set(n, count + 1);
    if (count === 0) return n;
    const dot = n.lastIndexOf('.');
    return `${n.slice(0, dot)} (${count + 1})${n.slice(dot)}`;
  });
}
