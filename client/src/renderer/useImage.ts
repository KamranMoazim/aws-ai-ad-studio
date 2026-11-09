import { useEffect, useState } from 'react';

const images = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  let pending = images.get(url);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`could not load ${url}`));
      image.src = url;
    });
    images.set(url, pending);
    pending.catch(() => images.delete(url));
  }
  return pending;
}

export function useImage(url: string | undefined): HTMLImageElement | undefined {
  const [image, setImage] = useState<HTMLImageElement | undefined>();
  useEffect(() => {
    let active = true;
    setImage(undefined);
    if (url) {
      loadImage(url)
        .then((loaded) => active && setImage(loaded))
        .catch(() => active && setImage(undefined));
    }
    return () => {
      active = false;
    };
  }, [url]);
  return image;
}
