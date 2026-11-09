import { useEffect, useState } from 'react';
import {
  contentForSize,
  sizesForChannel,
  SIZES,
  type Template,
} from '../../../../shared/src/index';
import { href } from '../../app/routes';
import { api, errorText } from '../../lib/api';
import { loadConfig } from '../../lib/config';
import type { BrandKit, Project, TemplateMeta } from '../../lib/types';
import { useLoad } from '../../lib/useLoad';
import { AdStage } from '../../renderer/AdStage';
import { ensureFonts } from '../../renderer/fonts';

const PREVIEW_BOX = 180;

function TemplatePreview({ template, assetBase }: { template: Template; assetBase: string }) {
  const sizes = sizesForChannel(template.channel);
  const size = sizes.includes('1080x1080') ? '1080x1080' : sizes[0];
  const scale = Math.min(PREVIEW_BOX / SIZES[size].width, PREVIEW_BOX / SIZES[size].height);
  return (
    <AdStage
      template={template}
      size={size}
      content={contentForSize(template.sample, size)}
      scale={scale}
      imageUrl={(src) => `${assetBase}/${src}`}
    />
  );
}

function NewProject({ clientId, onCancel }: { clientId: string; onCancel: () => void }) {
  const [templates, setTemplates] = useState<Template[] | undefined>();
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [assetBase, setAssetBase] = useState('');
  const [templateId, setTemplateId] = useState<string | undefined>();
  const [brandKitId, setBrandKitId] = useState('');
  const [name, setName] = useState('New ad set');
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    (async () => {
      const [list, kitList, config] = await Promise.all([
        api<{ templates: TemplateMeta[] }>(`/clients/${clientId}/templates`),
        api<{ brandKits: BrandKit[] }>(`/clients/${clientId}/brand-kits`),
        loadConfig(),
        ensureFonts(),
      ]);
      const bodies = await Promise.all(
        list.templates.map((meta) =>
          api<{ template: Template }>(`/clients/${clientId}/templates/${meta.templateId}`).then(
            (result) => result.template,
          ),
        ),
      );
      setAssetBase(config.siteUrl ?? window.location.origin);
      setKits(kitList.brandKits);
      setBrandKitId(kitList.brandKits[0]?.kitId ?? '');
      setTemplates(bodies);
    })().catch((reason) => setError(errorText(reason)));
  }, [clientId]);

  const create = async () => {
    setError(undefined);
    try {
      const project = await api<Project>(`/clients/${clientId}/projects`, {
        method: 'POST',
        body: { name, templateId, brandKitId: brandKitId || undefined },
      });
      window.location.hash = href.project(project.projectId);
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  return (
    <div className="panel">
      <h2>New ad set</h2>
      {error && <p className="error">{error}</p>}
      {!templates && !error && <p className="muted">Loading templates...</p>}
      {templates && templates.length === 0 && (
        <p className="muted">No templates are available yet.</p>
      )}
      <div className="template-grid">
        {(templates ?? []).map((template) => (
          <button
            key={template.id}
            className={`template-card${template.id === templateId ? ' chosen' : ''}`}
            onClick={() => setTemplateId(template.id)}
          >
            <span className="template-card-preview">
              <TemplatePreview template={template} assetBase={assetBase} />
            </span>
            <span className="template-card-name">{template.name}</span>
            <span className="muted">{template.tags.join(', ')}</span>
          </button>
        ))}
      </div>
      <div className="inline-form">
        <input aria-label="Name" value={name} onChange={(event) => setName(event.target.value)} />
        <select
          aria-label="Brand kit"
          value={brandKitId}
          onChange={(event) => setBrandKitId(event.target.value)}
        >
          <option value="">No brand kit</option>
          {kits.map((kit) => (
            <option key={kit.kitId} value={kit.kitId}>
              {kit.name}
            </option>
          ))}
        </select>
        <button className="button primary" disabled={!templateId || !name.trim()} onClick={create}>
          Create and edit
        </button>
        <button className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function ProjectsTab({ clientId }: { clientId: string }) {
  const { data, error, reload } = useLoad(
    () => api<{ projects: Project[] }>(`/clients/${clientId}/projects`),
    [clientId],
  );
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | undefined>();

  const duplicate = async (project: Project) => {
    setMessage(undefined);
    try {
      await api(`/projects/${project.projectId}/duplicate`, { method: 'POST' });
      await reload();
    } catch (reason) {
      setMessage(errorText(reason));
    }
  };

  return (
    <div>
      {creating ? (
        <NewProject clientId={clientId} onCancel={() => setCreating(false)} />
      ) : (
        <button className="button primary" onClick={() => setCreating(true)}>
          New ad set
        </button>
      )}
      {(error || message) && <p className="error">{error ?? message}</p>}
      {data && data.projects.length === 0 && <p className="muted">No ad sets yet.</p>}
      {data && data.projects.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Template</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.projects.map((project) => (
              <tr key={project.projectId}>
                <td>
                  <a href={href.project(project.projectId)}>{project.name}</a>
                </td>
                <td>
                  {project.templateId} v{project.templateVersion}
                </td>
                <td>{new Date(project.updatedAt).toLocaleString()}</td>
                <td>
                  <button className="link-button" onClick={() => duplicate(project)}>
                    Duplicate
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
