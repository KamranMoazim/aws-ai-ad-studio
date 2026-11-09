import { useState, type FormEvent } from 'react';
import { href } from '../app/routes';
import { api, errorText } from '../lib/api';
import type { Me, TemplateMeta } from '../lib/types';
import { useLoad } from '../lib/useLoad';

const CHANNELS: Array<[TemplateMeta['channel'], string]> = [
  ['both', 'Display and Meta (8 sizes)'],
  ['display', 'Display (5 sizes)'],
  ['meta', 'Meta (3 sizes)'],
];

export function TemplatesPage({ me }: { me: Me }) {
  const { data, error } = useLoad(() => api<{ templates: TemplateMeta[] }>('/templates'), []);
  const [name, setName] = useState('');
  const [channel, setChannel] = useState<TemplateMeta['channel']>('both');
  const [formError, setFormError] = useState<string | undefined>();

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(undefined);
    try {
      const { meta } = await api<{ meta: TemplateMeta }>('/templates', {
        method: 'POST',
        body: { name, channel },
      });
      window.location.hash = href.template(meta.templateId);
    } catch (reason) {
      setFormError(errorText(reason));
    }
  };

  const templates = [...(data?.templates ?? [])].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  return (
    <section>
      <header className="page-header">
        <h1>Templates</h1>
      </header>
      {me.can.includes('template:create') && (
        <form className="inline-form" onSubmit={create}>
          <input
            placeholder="New template name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <select
            value={channel}
            onChange={(event) => setChannel(event.target.value as TemplateMeta['channel'])}
          >
            {CHANNELS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button className="button primary">Create template</button>
          {formError && <p className="error">{formError}</p>}
        </form>
      )}
      {error && <p className="error">{error}</p>}
      {data && templates.length === 0 && <p className="muted">No templates yet.</p>}
      {templates.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Channel</th>
              <th>Status</th>
              <th>Tags</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((template) => (
              <tr key={template.templateId}>
                <td>
                  <a href={href.template(template.templateId)}>{template.name}</a>
                </td>
                <td>{template.channel}</td>
                <td>
                  <span className={`badge ${template.status === 'published' ? 'active' : ''}`}>
                    {template.status === 'published' ? `v${template.latestVersion}` : 'draft'}
                  </span>
                </td>
                <td>{template.tags.join(', ')}</td>
                <td>{new Date(template.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
