const DRAFT_PHOTOS = 8;
const AD_LABELS = ['product', 'team', 'place', 'hero', 'work', 'other'];

export interface LabelledPhoto {
  index: number;
  label?: string;
  quality?: number;
}

export function draftPhotoIndexes(photos: LabelledPhoto[]): number[] {
  const byQuality = [...photos].sort((left, right) => (right.quality ?? 3) - (left.quality ?? 3));
  const suited = byQuality.filter((photo) => !photo.label || AD_LABELS.includes(photo.label));
  // A kit without photos only fits text templates, so offer the best of the rest for review
  const chosen = suited.length ? suited : byQuality.filter((photo) => photo.label !== 'icon');
  return chosen.slice(0, DRAFT_PHOTOS).map((photo) => photo.index);
}
