import type { Element, ElementType } from '../../../../shared/src/index';

interface Props {
  elements: Element[];
  selectedId?: string;
  onSelect: (elementId: string) => void;
  onAdd: (type: ElementType) => void;
  onMove: (elementId: string, direction: 1 | -1) => void;
  onToggleHidden: (elementId: string) => void;
  onDelete: (elementId: string) => void;
}

const ADDABLE: Array<[ElementType, string]> = [
  ['text', 'Text'],
  ['image', 'Image'],
  ['rect', 'Shape'],
  ['button', 'Button'],
];

export function LayersPanel({
  elements,
  selectedId,
  onSelect,
  onAdd,
  onMove,
  onToggleHidden,
  onDelete,
}: Props) {
  return (
    <div className="builder-panel">
      <div className="add-row">
        {ADDABLE.map(([type, label]) => (
          <button key={type} className="button small" onClick={() => onAdd(type)}>
            + {label}
          </button>
        ))}
      </div>
      <ol className="layers">
        {[...elements].reverse().map((element) => (
          <li key={element.id} className={element.id === selectedId ? 'selected' : undefined}>
            <button className="layer-name" onClick={() => onSelect(element.id)}>
              <span className="layer-type">{element.type}</span>
              {element.name ?? element.bind ?? element.id}
              {element.locked === true && <span className="muted"> (locked)</span>}
            </button>
            <span className="layer-actions">
              <button title="Bring forward" onClick={() => onMove(element.id, 1)}>
                Up
              </button>
              <button title="Send backward" onClick={() => onMove(element.id, -1)}>
                Dn
              </button>
              <button title="Show or hide" onClick={() => onToggleHidden(element.id)}>
                {element.hidden ? 'Show' : 'Hide'}
              </button>
              <button title="Delete" onClick={() => onDelete(element.id)}>
                Del
              </button>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
