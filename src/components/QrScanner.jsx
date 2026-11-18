import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

// قارئ QR بالكاميرا: بيقرا الكاميرا الخلفية، ولما يلاقي QR بيرجّع النص
export default function QrScanner({ onResult, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let stream = null;
    let frame = null;
    let done = false;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        const video = videoRef.current;
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        await video.play();
        tick();
      } catch (e) {
        console.error(e);
        setErr('ما قدرناش نفتح الكاميرا. اسمح للموقع بالكاميرا من إعدادات المتصفح.');
      }
    }

    function tick() {
      if (done) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        const w = video.videoWidth;
        const h = video.videoHeight;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
        if (code && code.data) {
          done = true;
          onResult(code.data);
          return;
        }
      }
      frame = requestAnimationFrame(tick);
    }

    start();
    return () => {
      done = true;
      if (frame) cancelAnimationFrame(frame);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} className="w-full" muted />
        <canvas ref={canvasRef} className="hidden" />
        <div className="pointer-events-none absolute inset-8 rounded-xl border-4 border-amber-400" />
      </div>
      {err && <p className="text-sm font-semibold text-red-600">{err}</p>}
      <p className="text-center text-sm text-slate-500">وجّه الكاميرا على الـ QR اللي على الكارت</p>
      <button type="button" onClick={onClose} className="w-full rounded-xl bg-slate-200 py-2 font-semibold">
        إلغاء
      </button>
    </div>
  );
}
