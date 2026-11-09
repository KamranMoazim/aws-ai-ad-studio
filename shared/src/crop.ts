export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function coverCrop(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
  focalX = 0.5,
  focalY = 0.5,
): Box {
  const scale = Math.max(frameWidth / imageWidth, frameHeight / imageHeight);
  const width = Math.min(imageWidth, frameWidth / scale);
  const height = Math.min(imageHeight, frameHeight / scale);
  return {
    x: clamp(focalX * imageWidth - width / 2, 0, imageWidth - width),
    y: clamp(focalY * imageHeight - height / 2, 0, imageHeight - height),
    width,
    height,
  };
}

export function containBox(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
): Box {
  const scale = Math.min(frameWidth / imageWidth, frameHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return { x: (frameWidth - width) / 2, y: (frameHeight - height) / 2, width, height };
}

export const intersects = (first: Box, second: Box) =>
  first.x < second.x + second.width &&
  second.x < first.x + first.width &&
  first.y < second.y + second.height &&
  second.y < first.y + first.height;
