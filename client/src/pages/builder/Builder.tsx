import type Konva from 'konva';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  contentForSize,
  hasErrors,
  SIZES,
  sizesForChannel,
  type ElementType,
  type LintIssue,
  type SafeZone,
  type SizeKey,
  type Template,
} from '../../../../shared/src/index';
import { href } from '../../app/routes';
import { api, errorText } from '../../lib/api';
import { loadConfig } from '../../lib/config';
import type { TemplateMeta } from '../../lib/types';
import { AdStage } from '../../renderer/AdStage';
import { ensureFonts } from '../../renderer/fonts';
import { lintInBrowser } from './browser-lint';
import { adaptToAllSizes, newElement, updateElement, updateLayout } from './edit';
import { LayersPanel } from './LayersPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { SamplePanel } from './SamplePanel';
import { SelectionTransformer } from './SelectionTransformer';
import { SlotsPanel } from './SlotsPanel';

interface Loaded {
  meta: TemplateMeta;
  template: Template;
  safeZone: SafeZone;
}

type Tab = 'layers' | 'slots' | 'sample';

const CANVAS_WIDTH = 620;
const CANVAS_HEIGHT = 560;
const THUMB_WIDTH = 120;
const THUMB_HEIGHT = 80;
const NUDGE = 1;
const BIG_NUDGE = 10;

const fitScale = (size: SizeKey, maxWidth: number, maxHeight: number) =>
  Math.min(maxWidth / SIZES[size].width, maxHeight / SIZES[size].height, 1);

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);

export function TemplateBuilder({
  templateId,
  canPublish,
}: {
  templateId: string;
  canPublish: boolean;
}) {
  const [loaded, setLoaded] = useState<Loaded | undefined>();
  const [template, setTemplate] = useState<Template | undefined>();
  const [assetBase, setAssetBase] = useState('');
  const [size, setSize] = useState<SizeKey>('300x250');
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [tab, setTab] = useState<Tab>('layers');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [report, setReport] = useState<{ revision: number; issues: LintIssue[] } | undefined>();
  const stages = useRef<Partial<Record<SizeKey, Konva.Stage | null>>>({});

  useEffect(() => {
    Promise.all([
      api<Loaded>(`/templates/${encodeURIComponent(templateId)}`),
      loadConfig(),
      ensureFonts(),
    ])
      .then(([data, config]) => {
        setLoaded(data);
        setTemplate(data.template);
        setAssetBase(config.siteUrl ?? window.location.origin);
        setSize(sizesForChannel(data.template.channel)[0]);
      })
      .catch((reason) => setError(errorText(reason)));
  }, [templateId]);

  const change = useCallback((next: Template) => {
    setTemplate(next);
    setDirty(true);
    setReport(undefined);
  }, []);

  const layout = template?.layouts[size];
  const selected = layout?.elements.find((element) => element.id === selectedId);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!template || !selectedId || isTyping(event.target)) {
        return;
      }
      const step = event.shiftKey ? BIG_NUDGE : NUDGE;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        change(
          updateLayout(template, size, (current) => ({
            ...current,
            elements: current.elements.filter((element) => element.id !== selectedId),
          })),
        );
        setSelectedId(undefined);
      } else if (moves[event.key]) {
        event.preventDefault();
        const [dx, dy] = moves[event.key];
        change(
          updateElement(template, size, selectedId, (element) => ({
            ...element,
            frame: { ...element.frame, x: element.frame.x + dx, y: element.frame.y + dy },
          })),
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [template, selectedId, size, change]);

  const issuesBySize = useMemo(() => {
    const counts: Partial<Record<SizeKey, number>> = {};
    for (const issue of report?.issues ?? []) {
      if (issue.size && issue.severity === 'error') {
        counts[issue.size] = (counts[issue.size] ?? 0) + 1;
      }
    }
    return counts;
  }, [report]);

  if (error && !template) {
    return <p className="error">{error}</p>;
  }
  if (!loaded || !template || !layout) {
    return <p className="muted">Loading builder...</p>;
  }

  const sizes = sizesForChannel(template.channel);
  const content = contentForSize(template.sample, size);
  const scale = fitScale(size, CANVAS_WIDTH, CANVAS_HEIGHT);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await action();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      const { meta } = await api<{ meta: TemplateMeta }>(`/templates/${template.id}`, {
        method: 'PUT',
        body: { revision: loaded.meta.revision, template },
      });
      setLoaded({ ...loaded, meta, template });
      setDirty(false);
      setMessage('Saved.');
    });

  const lint = () =>
    run(async () => {
      const issues = await lintInBrowser(template, loaded.safeZone, stages.current);
      setReport({ revision: loaded.meta.revision, issues });
      if (hasErrors(issues)) {
        setError('Lint found errors. Fix them, save and lint again.');
      } else {
        setMessage(
          `Lint passed at all ${sizes.length} sizes${issues.length ? ' with warnings' : ''}.`,
        );
      }
    });

  const publish = () =>
    run(async () => {
      const { meta } = await api<{ meta: TemplateMeta }>(`/templates/${template.id}/publish`, {
        method: 'POST',
        body: { revision: loaded.meta.revision, report: { issues: report!.issues } },
      });
      setLoaded({ ...loaded, meta });
      setMessage(`Published version ${meta.latestVersion}.`);
    });

  const addElement = (type: ElementType) => {
    const element = newElement(type, layout);
    change(
      updateLayout(template, size, (current) => ({
        ...current,
        elements: [...current.elements, element],
      })),
    );
    setSelectedId(element.id);
  };

  const moveLayer = (elementId: string, direction: 1 | -1) =>
    change(
      updateLayout(template, size, (current) => {
        const elements = [...current.elements];
        const index = elements.findIndex((element) => element.id === elementId);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= elements.length) {
          return current;
        }
        [elements[index], elements[target]] = [elements[target], elements[index]];
        return { ...current, elements };
      }),
    );

  const lintReady = report && !dirty && report.revision === loaded.meta.revision;
  const unchanged = loaded.meta.publishedRevision === loaded.meta.revision;
  const canPublishNow = canPublish && lintReady && !hasErrors(report.issues) && !unchanged;

  return (
    <section className="builder">
      <header className="builder-bar">
        <a href={href.templates()} className="muted">
          Templates
        </a>
        <input
          className="builder-name"
          value={template.name}
          aria-label="Template name"
          onChange={(event) => change({ ...template, name: event.target.value })}
        />
        <input
          className="builder-tags"
          placeholder="tags, comma separated"
          aria-label="Tags"
          value={template.tags.join(', ')}
          onChange={(event) =>
            change({
              ...template,
              tags: event.target.value
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean),
            })
          }
        />
        <span className={`badge ${loaded.meta.status === 'published' ? 'active' : ''}`}>
          {loaded.meta.status === 'published' ? `v${loaded.meta.latestVersion} published` : 'draft'}
        </span>
        <span className="builder-actions">
          <button
            className="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Replace every other size with a scaled copy of ${size}?`)) {
                change(adaptToAllSizes(template, size));
              }
            }}
          >
            Adapt {size} to all sizes
          </button>
          <button className="button" disabled={busy || !dirty} onClick={save}>
            Save
          </button>
          <button
            className="button"
            disabled={busy || dirty}
            onClick={lint}
            title={dirty ? 'Save first' : undefined}
          >
            Lint
          </button>
          {canPublish && (
            <button className="button primary" disabled={busy || !canPublishNow} onClick={publish}>
              Publish
            </button>
          )}
        </span>
      </header>
      {(message || error) && <p className={error ? 'error' : 'notice'}>{error ?? message}</p>}

      <nav className="size-strip">
        {sizes.map((key) => {
          const thumbScale = fitScale(key, THUMB_WIDTH, THUMB_HEIGHT);
          return (
            <button
              key={key}
              className={`size-thumb${key === size ? ' active' : ''}`}
              onClick={() => {
                setSize(key);
                setSelectedId(undefined);
              }}
            >
              <span className="size-thumb-canvas">
                <AdStage
                  ref={(stage) => {
                    stages.current[key] = stage;
                  }}
                  template={template}
                  size={key}
                  content={contentForSize(template.sample, key)}
                  scale={thumbScale}
                  imageUrl={(src) => `${assetBase}/${src}`}
                />
              </span>
              <span className="size-thumb-label">
                {key.replace('x', ' x ')}
                {issuesBySize[key] ? (
                  <span className="badge disabled">{issuesBySize[key]}</span>
                ) : null}
                {report && !issuesBySize[key] ? <span className="badge active">ok</span> : null}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="builder-body">
        <aside className="builder-left">
          <div className="tabs">
            {(['layers', 'slots', 'sample'] as Tab[]).map((name) => (
              <button
                key={name}
                className={tab === name ? 'active' : undefined}
                onClick={() => setTab(name)}
              >
                {name === 'layers'
                  ? 'Layers'
                  : name === 'slots'
                    ? 'Slots and colors'
                    : 'Sample content'}
              </button>
            ))}
          </div>
          {tab === 'layers' && (
            <LayersPanel
              elements={layout.elements}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onAdd={addElement}
              onMove={moveLayer}
              onToggleHidden={(elementId) =>
                change(
                  updateElement(template, size, elementId, (element) => ({
                    ...element,
                    hidden: !element.hidden || undefined,
                  })),
                )
              }
              onDelete={(elementId) => {
                change(
                  updateLayout(template, size, (current) => ({
                    ...current,
                    elements: current.elements.filter((element) => element.id !== elementId),
                  })),
                );
                setSelectedId(undefined);
              }}
            />
          )}
          {tab === 'slots' && <SlotsPanel template={template} onChange={change} />}
          {tab === 'sample' && <SamplePanel template={template} size={size} onChange={change} />}
        </aside>

        <div className="builder-canvas">
          <div className="canvas-frame">
            <AdStage
              template={template}
              size={size}
              content={content}
              scale={scale}
              imageUrl={(src) => `${assetBase}/${src}`}
              safeZone={loaded.safeZone}
              interaction={{
                selectedId,
                onSelect: setSelectedId,
                onMove: (elementId, x, y) =>
                  change(
                    updateElement(template, size, elementId, (element) => ({
                      ...element,
                      frame: { ...element.frame, x: Math.round(x), y: Math.round(y) },
                    })),
                  ),
              }}
              overlay={
                <SelectionTransformer
                  element={selected}
                  onChange={(elementId, frame) =>
                    change(
                      updateElement(template, size, elementId, (element) => ({
                        ...element,
                        frame,
                      })),
                    )
                  }
                />
              }
            />
          </div>
          <p className="muted canvas-caption">
            {SIZES[size].width} x {SIZES[size].height} at {Math.round(scale * 100)}%. Arrow keys
            nudge, Shift moves 10px, Delete removes.
          </p>
          {report && (
            <div className="lint-list">
              <h3>Lint ({report.issues.length} issues)</h3>
              {report.issues.length === 0 && <p className="notice">No issues.</p>}
              <ul>
                {report.issues.map((issue, index) => (
                  <li key={index} className={issue.severity}>
                    <button
                      className="link-button"
                      onClick={() => {
                        if (issue.size) {
                          setSize(issue.size);
                        }
                        setSelectedId(issue.elementId);
                      }}
                    >
                      {issue.severity === 'error' ? 'Error' : 'Warning'}
                      {issue.size ? ` ${issue.size}` : ''}
                    </button>{' '}
                    {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <aside className="builder-right">
          {selected ? (
            <PropertiesPanel
              template={template}
              element={selected}
              onChange={(update) => change(updateElement(template, size, selected.id, update))}
            />
          ) : (
            <p className="muted">Select an element to edit it.</p>
          )}
        </aside>
      </div>
    </section>
  );
}
