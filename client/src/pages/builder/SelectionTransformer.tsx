import type Konva from 'konva';
import { useEffect, useRef } from 'react';
import { Transformer } from 'react-konva';
import type { Element, Frame } from '../../../../shared/src/index';

interface Props {
  element?: Element;
  onChange: (elementId: string, frame: Frame) => void;
}

export function SelectionTransformer({ element, onChange }: Props) {
  const ref = useRef<Konva.Transformer>(null);

  useEffect(() => {
    const transformer = ref.current;
    if (!transformer) {
      return;
    }
    const node = element ? transformer.getStage()?.findOne(`#${element.id}`) : undefined;
    transformer.nodes(node ? [node] : []);
    transformer.getLayer()?.batchDraw();
  });

  return (
    <Transformer
      ref={ref}
      rotateEnabled
      keepRatio={false}
      ignoreStroke
      boundBoxFunc={(oldBox, newBox) => (newBox.width < 4 || newBox.height < 4 ? oldBox : newBox)}
      onTransformEnd={() => {
        const node = ref.current?.nodes()[0];
        if (!node || !element) {
          return;
        }
        const frame: Frame = {
          x: Math.round(node.x()),
          y: Math.round(node.y()),
          w: Math.max(1, Math.round(element.frame.w * node.scaleX())),
          h: Math.max(1, Math.round(element.frame.h * node.scaleY())),
          rotation: Math.round(node.rotation() * 10) / 10 || undefined,
        };
        node.scaleX(1);
        node.scaleY(1);
        onChange(element.id, frame);
      }}
    />
  );
}
