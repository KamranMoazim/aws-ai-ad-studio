import type Konva from 'konva';
import { forwardRef, type ReactNode } from 'react';
import { Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from 'react-konva';
import {
  containBox,
  coverCrop,
  cssFamily,
  DEFAULT_LINE_HEIGHT,
  elementText,
  fitElement,
  resolveColor,
  safeRect,
  STORY_SIZE,
  textBox,
  type Element,
  type ResolvedContent,
  type SafeZone,
  type SizeKey,
  type Template,
} from '../../../shared/src/index';
import { measureText } from './measure';
import { useImage } from './useImage';

const PLACEHOLDER_FILL = '#d0d5dd';
const PLACEHOLDER_TEXT = '#475467';
const OVERFLOW = '#d92d20';
const NO_GO = 'rgba(217, 45, 32, 0.18)';

export interface Interaction {
  selectedId?: string;
  onSelect: (elementId: string | undefined) => void;
  onMove: (elementId: string, x: number, y: number) => void;
}

interface AdStageProps {
  template: Template;
  size: SizeKey;
  content: ResolvedContent;
  scale: number;
  assetBase: string;
  safeZone?: SafeZone;
  interaction?: Interaction;
  overlay?: ReactNode;
}

interface NodeProps {
  template: Template;
  element: Element;
  content: ResolvedContent;
  assetBase: string;
  editing: boolean;
}

function TextNode({ template, element, content, editing }: NodeProps) {
  const text = elementText(element, content);
  const fit = fitElement(template, element, text, measureText);
  const box = textBox(element);
  const style = element.style;
  const isButton = element.type === 'button';
  return (
    <>
      {isButton && (
        <Rect
          width={element.frame.w}
          height={element.frame.h}
          fill={resolveColor(style.fill, content.colors)}
          cornerRadius={style.radius ?? 0}
        />
      )}
      <Text
        x={box.padding}
        y={box.padding}
        width={box.width}
        height={box.height}
        text={fit.lines.join('\n')}
        fontSize={fit.fontSize}
        fontFamily={cssFamily(style.fontFamily)}
        fontStyle={String(style.fontWeight ?? 400)}
        lineHeight={style.lineHeight ?? DEFAULT_LINE_HEIGHT}
        letterSpacing={style.letterSpacing ?? 0}
        align={style.align ?? (isButton ? 'center' : 'left')}
        verticalAlign={style.verticalAlign ?? (isButton ? 'middle' : 'top')}
        fill={resolveColor(style.color, content.colors)}
        wrap="none"
      />
      {editing && !fit.fits && (
        <Rect
          width={element.frame.w}
          height={element.frame.h}
          stroke={OVERFLOW}
          strokeWidth={2}
          dash={[6, 4]}
          strokeScaleEnabled={false}
        />
      )}
    </>
  );
}

function ImageNode({ element, content, assetBase }: NodeProps) {
  const value = element.bind ? content.images[element.bind] : undefined;
  const image = useImage(value ? `${assetBase}/${value.src}` : undefined);
  const { w, h } = element.frame;
  const radius = element.style.radius ?? 0;
  if (!image) {
    return (
      <>
        <Rect width={w} height={h} fill={PLACEHOLDER_FILL} cornerRadius={radius} />
        <Text
          width={w}
          height={h}
          text={element.bind ?? 'image'}
          align="center"
          verticalAlign="middle"
          fontSize={Math.max(8, Math.min(w, h) * 0.18)}
          fill={PLACEHOLDER_TEXT}
          fontFamily={cssFamily('Inter')}
        />
      </>
    );
  }
  if (element.crop === 'contain') {
    const box = containBox(image.naturalWidth, image.naturalHeight, w, h);
    return (
      <KonvaImage
        image={image}
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        cornerRadius={radius}
      />
    );
  }
  const crop = coverCrop(
    image.naturalWidth,
    image.naturalHeight,
    w,
    h,
    value!.focalX,
    value!.focalY,
  );
  return <KonvaImage image={image} width={w} height={h} crop={crop} cornerRadius={radius} />;
}

function ElementNode(props: NodeProps & { interaction?: Interaction }) {
  const { element, interaction, content } = props;
  if (element.hidden && !interaction) {
    return null;
  }
  const selected = interaction?.selectedId === element.id;
  return (
    <Group
      id={element.id}
      x={element.frame.x}
      y={element.frame.y}
      rotation={element.frame.rotation ?? 0}
      opacity={(element.style.opacity ?? 1) * (element.hidden ? 0.25 : 1)}
      draggable={Boolean(interaction) && selected}
      onMouseDown={(event) => {
        if (interaction) {
          event.cancelBubble = true;
          interaction.onSelect(element.id);
        }
      }}
      onTap={() => interaction?.onSelect(element.id)}
      onDragEnd={(event) => interaction?.onMove(element.id, event.target.x(), event.target.y())}
    >
      {element.type === 'rect' && (
        <Rect
          width={element.frame.w}
          height={element.frame.h}
          fill={resolveColor(element.style.fill, content.colors)}
          cornerRadius={element.style.radius ?? 0}
        />
      )}
      {element.type === 'image' && <ImageNode {...props} />}
      {(element.type === 'text' || element.type === 'button') && (
        <TextNode {...props} editing={Boolean(interaction)} />
      )}
    </Group>
  );
}

function SafeZoneOverlay({
  width,
  height,
  zone,
}: {
  width: number;
  height: number;
  zone: SafeZone;
}) {
  const safe = safeRect(width, height, zone);
  const areas = [
    [0, 0, width, safe.y],
    [0, safe.y + safe.height, width, height - safe.y - safe.height],
    [0, safe.y, safe.x, safe.height],
    [safe.x + safe.width, safe.y, width - safe.x - safe.width, safe.height],
  ];
  return (
    <Group listening={false}>
      {areas.map(([x, y, w, h], index) => (
        <Rect key={index} x={x} y={y} width={w} height={h} fill={NO_GO} />
      ))}
      <Line
        points={[
          safe.x,
          safe.y,
          safe.x + safe.width,
          safe.y,
          safe.x + safe.width,
          safe.y + safe.height,
          safe.x,
          safe.y + safe.height,
        ]}
        closed
        stroke={OVERFLOW}
        strokeWidth={2}
        dash={[10, 8]}
        strokeScaleEnabled={false}
      />
    </Group>
  );
}

export const AdStage = forwardRef<Konva.Stage, AdStageProps>(function AdStage(
  { template, size, content, scale, assetBase, safeZone, interaction, overlay },
  ref,
) {
  const layout = template.layouts[size];
  if (!layout) {
    return null;
  }
  return (
    <Stage
      ref={ref}
      width={Math.round(layout.width * scale)}
      height={Math.round(layout.height * scale)}
      scaleX={scale}
      scaleY={scale}
      onMouseDown={(event) => {
        if (interaction && event.target === event.target.getStage()) {
          interaction.onSelect(undefined);
        }
      }}
    >
      <Layer>
        <Rect width={layout.width} height={layout.height} fill="#ffffff" listening={false} />
        {layout.elements.map((element) => (
          <ElementNode
            key={element.id}
            template={template}
            element={element}
            content={content}
            assetBase={assetBase}
            editing={Boolean(interaction)}
            interaction={interaction}
          />
        ))}
        {safeZone && size === STORY_SIZE && (
          <SafeZoneOverlay width={layout.width} height={layout.height} zone={safeZone} />
        )}
        {overlay}
      </Layer>
    </Stage>
  );
});
