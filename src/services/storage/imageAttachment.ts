export interface ProcessedImageAttachment {
  name: string;
  mimeType: string;
  base64: string;
}

const MAX_DIMENSION = 1440;

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('No se pudo leer la imagen'));
      }
    };
    reader.onerror = () => reject(new Error('Error al leer la imagen'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo decodificar la imagen'));
    img.src = src;
  });
}

export async function processImageFileToAttachment(
  file: File
): Promise<ProcessedImageAttachment> {
  const safeBase =
    file.name
      ?.replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 24) || 'pizarron';
  const suffix = Date.now().toString(36).slice(-5);

  const rawDataUrl = await fileToDataUrl(file);

  // Compress/resize large photos on canvas when running in a browser DOM
  if (typeof document !== 'undefined' && file.type !== 'image/svg+xml') {
    try {
      const img = await loadImage(rawDataUrl);
      const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
      if (scale < 1 || file.size > 350 * 1024) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const targetMime = file.type === 'image/png' && file.size <= 350 * 1024
            ? 'image/png'
            : 'image/jpeg';
          const outUrl = canvas.toDataURL(targetMime, 0.84);
          const ext = targetMime === 'image/png' ? 'png' : 'jpg';
          const base64 = outUrl.split(',')[1] ?? '';
          return {
            name: `${safeBase}_${suffix}.${ext}`,
            mimeType: targetMime,
            base64,
          };
        }
      }
    } catch {
      // Fallback to raw image bytes below
    }
  }

  const mimeType = file.type || 'image/png';
  const ext = mimeType.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'png';
  const base64 = rawDataUrl.split(',')[1] ?? '';
  return {
    name: `${safeBase}_${suffix}.${ext}`,
    mimeType,
    base64,
  };
}
