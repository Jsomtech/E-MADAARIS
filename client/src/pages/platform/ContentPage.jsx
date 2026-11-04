import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { ExternalLink, Plus, RefreshCw, RotateCcw, Save, ShieldAlert, Trash2 } from 'lucide-react';
import { apiDelete, apiGet, apiPut } from '../../api/client.js';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../../components/ui/Basics.jsx';
import { invalidateSiteContent } from '../../hooks/useSiteContent.js';
import { SITE_DEFAULTS } from '../../content/siteDefaults.js';

const PAGES = [
  { key: 'home', label: 'Home', path: '/' },
  { key: 'faq', label: 'FAQ', path: '/faq' },
  { key: 'terms', label: 'Terms', path: '/terms' },
  { key: 'privacy', label: 'Privacy', path: '/privacy' },
];

const clone = (value) => JSON.parse(JSON.stringify(value));

/** Super-admin editor for the public site copy stored through /platform/content. */
export default function ContentPage() {
  const { t } = useTranslation();
  const [active, setActive] = useState('home');
  const [drafts, setDrafts] = useState(() => Object.fromEntries(PAGES.map((p) => [p.key, clone(SITE_DEFAULTS[p.key])])));
  const [saved, setSaved] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body = await apiGet('/platform/content');
      const stored = body.data || {};
      setSaved(stored);
      setDrafts(Object.fromEntries(PAGES.map((p) => [p.key, clone(stored[p.key]?.content || SITE_DEFAULTS[p.key])])));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const draft = drafts[active];
  const baseline = saved[active]?.content || SITE_DEFAULTS[active];
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline]);
  const pageMeta = PAGES.find((p) => p.key === active);

  const set = useCallback((path, value) => {
    setDrafts((prev) => {
      const nextPage = clone(prev[active]);
      let node = nextPage;
      for (let i = 0; i < path.length - 1; i += 1) node = node[path[i]];
      node[path[path.length - 1]] = value;
      return { ...prev, [active]: nextPage };
    });
  }, [active]);

  const save = async () => {
    setBusy(true);
    try {
      await apiPut(`/platform/content/${active}`, { content: draft });
      setSaved((prev) => ({ ...prev, [active]: { content: clone(draft), updated_at: new Date().toISOString() } }));
      invalidateSiteContent();
      toast.success(t('platform.contentSaved', { defaultValue: '{{page}} content saved.', page: pageMeta.label }));
      await load();
    } catch (e) {
      toast.error(e.status === 403
        ? t('platform.superAdminOnly', { defaultValue: 'Super Admin access is required for this action.' })
        : e.message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await apiDelete(`/platform/content/${active}`);
      setSaved((prev) => {
        const next = { ...prev };
        delete next[active];
        return next;
      });
      setDrafts((prev) => ({ ...prev, [active]: clone(SITE_DEFAULTS[active]) }));
      invalidateSiteContent();
      setResetOpen(false);
      toast.success(t('platform.contentReset', { defaultValue: '{{page}} content reset to the built-in copy.', page: pageMeta.label }));
    } catch (e) {
      toast.error(e.status === 403
        ? t('platform.superAdminOnly', { defaultValue: 'Super Admin access is required for this action.' })
        : e.message);
    } finally {
      setBusy(false);
    }
  };

  const Editor = EDITORS[active];

  return (
    <>
      <PageHeader
        title={t('platform.siteContent', { defaultValue: 'Site content' })}
        subtitle={t('platform.siteContentSub', { defaultValue: 'Edit the public Home, FAQ, Terms and Privacy copy. Saved pages replace the built-in text; resetting restores it.' })}
        actions={(
          <>
            <button className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={load} disabled={loading}>
              <RefreshCw size={14} /> {t('common.refresh')}
            </button>
            <a className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" href={pageMeta.path} target="_blank" rel="noreferrer">
              <ExternalLink size={14} /> {t('common.preview', { defaultValue: 'Preview' })}
            </a>
            {saved[active] ? (
              <button className="btn btn-sm btn-outline-danger d-flex align-items-center gap-1" onClick={() => setResetOpen(true)} disabled={busy}>
                <RotateCcw size={14} /> {t('platform.resetToDefault', { defaultValue: 'Reset' })}
              </button>
            ) : null}
            <button className="btn btn-sm btn-primary d-flex align-items-center gap-1" onClick={save} disabled={busy || loading || !dirty}>
              <Save size={14} /> {busy ? '…' : t('common.save')}
            </button>
          </>
        )}
      />

      {error ? (
        <div className="card-soft p-4">
          {error.status === 403 ? (
            <EmptyState icon={ShieldAlert}
              title={t('platform.superAdminOnlyTitle', { defaultValue: 'Super Admin only' })}
              hint={t('platform.contentSuperOnly', { defaultValue: 'Website copy is edited only by platform Super Admins.' })} />
          ) : (
            <ErrorState error={error} onRetry={load} />
          )}
        </div>
      ) : loading ? (
        <Spinner label={t('common.loading')} />
      ) : (
        <>
          <div className="card-soft p-2 mb-3 d-flex flex-wrap align-items-center gap-2">
            <div className="nav nav-pills gap-1 flex-wrap">
              {PAGES.map((page) => {
                const isDirty = drafts[page.key] && JSON.stringify(drafts[page.key]) !== JSON.stringify(saved[page.key]?.content || SITE_DEFAULTS[page.key]);
                return (
                  <button key={page.key}
                    className={`btn btn-sm ${active === page.key ? 'btn-dark' : 'btn-outline-secondary'}`}
                    onClick={() => setActive(page.key)}>
                    {page.label}{isDirty ? ' •' : ''}
                  </button>
                );
              })}
            </div>
            <div className="ms-auto small text-muted">
              {saved[active]?.updated_at
                ? `${t('platform.lastSaved', { defaultValue: 'Last saved' })}: ${new Date(saved[active].updated_at).toLocaleString()}`
                : t('platform.usingDefaults', { defaultValue: 'Using the built-in copy — no saved version yet.' })}
            </div>
          </div>

          <div className="card-soft p-4">
            <Editor content={draft} set={set} />
          </div>

          <div className="small text-muted mt-3">
            {t('platform.contentHelp', { defaultValue: 'Saved copy is shown verbatim on the public page in every language. Leave a page unsaved to keep the translated built-in text.' })}
          </div>
        </>
      )}

      <ConfirmDialog open={resetOpen} title={t('platform.resetContent', { defaultValue: 'Reset page copy' })}
        message={t('platform.resetContentMessage', { defaultValue: 'Discard the saved {{page}} copy and show the built-in text again?', page: pageMeta.label })}
        busy={busy} onClose={() => setResetOpen(false)} onConfirm={reset} />
    </>
  );
}

const EDITORS = { home: HomeEditor, faq: FaqEditor, terms: TermsEditor, privacy: PrivacyEditor };

function Block({ title, hint, children }) {
  return (
    <fieldset className="border rounded-3 p-3 mb-4">
      <legend className="float-none w-auto px-2 h6 fw-bold mb-1">{title}</legend>
      {hint ? <div className="small text-muted mb-3">{hint}</div> : null}
      {children}
    </fieldset>
  );
}

function TextRow({ label, value, onChange, area, rows = 3, col = 12, placeholder }) {
  return (
    <div className={`col-12 col-md-${col} mb-3`}>
      <label className="form-label small fw-semibold mb-1">{label}</label>
      {area ? (
        <textarea className="form-control form-control-sm" rows={rows} value={value ?? ''} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="form-control form-control-sm" value={value ?? ''} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

function StringList({ label, items, onChange, multiline, rows = 2, addLabel = 'Add item', placeholder }) {
  return (
    <div className="mb-3">
      <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
        <label className="form-label small fw-semibold mb-0">{label}</label>
        <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
          onClick={() => onChange([...(items || []), ''])}>
          <Plus size={13} /> {addLabel}
        </button>
      </div>
      {(items || []).map((item, i) => (
        <div className="d-flex align-items-start gap-2 mb-2" key={i}>
          {multiline ? (
            <textarea className="form-control form-control-sm" rows={rows} value={item} placeholder={placeholder}
              onChange={(e) => onChange(items.map((v, idx) => (idx === i ? e.target.value : v)))} />
          ) : (
            <input className="form-control form-control-sm" value={item} placeholder={placeholder}
              onChange={(e) => onChange(items.map((v, idx) => (idx === i ? e.target.value : v)))} />
          )}
          <button type="button" className="btn btn-sm btn-outline-danger" title="Remove"
            onClick={() => onChange(items.filter((_, idx) => idx !== i))}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function HomeEditor({ content: c, set }) {
  return (
    <>
      <Block title="Hero" hint="The first screen: badge, headline, tagline, lead and both buttons.">
        <div className="row">
          <TextRow label="Badge" value={c.badge} col={6} onChange={(v) => set(['badge'], v)} />
          <TextRow label="Headline" value={c.headline} col={6} onChange={(v) => set(['headline'], v)} />
          <TextRow label="Somali tagline" value={c.tagline} col={6} onChange={(v) => set(['tagline'], v)} />
          <TextRow label="Primary button" value={c.primaryCta} col={3} onChange={(v) => set(['primaryCta'], v)} />
          <TextRow label="Secondary button" value={c.secondaryCta} col={3} onChange={(v) => set(['secondaryCta'], v)} />
          <TextRow label="Lead paragraph" value={c.lead} area rows={3} onChange={(v) => set(['lead'], v)} />
        </div>
        <StringList label="Hero highlights" items={c.meta} addLabel="Add highlight"
          onChange={(v) => set(['meta'], v)} />
        <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
          <label className="form-label small fw-semibold mb-0">Statistics band</label>
          <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
            onClick={() => set(['stats'], [...c.stats, { value: '', label: '' }])}>
            <Plus size={13} /> Add statistic
          </button>
        </div>
        {c.stats.map((stat, i) => (
          <div className="d-flex align-items-start gap-2 mb-2" key={i}>
            <input className="form-control form-control-sm" style={{ maxWidth: 120 }} value={stat.value} placeholder="Value"
              onChange={(e) => set(['stats', i, 'value'], e.target.value)} />
            <input className="form-control form-control-sm" value={stat.label} placeholder="Label"
              onChange={(e) => set(['stats', i, 'label'], e.target.value)} />
            <button type="button" className="btn btn-sm btn-outline-danger" title="Remove"
              onClick={() => set(['stats'], c.stats.filter((_, idx) => idx !== i))}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </Block>

      <Block title="School-day workflow">
        <div className="row">
          <TextRow label="Eyebrow" value={c.workflow.eyebrow} col={4} onChange={(v) => set(['workflow', 'eyebrow'], v)} />
          <TextRow label="Title" value={c.workflow.title} col={8} onChange={(v) => set(['workflow', 'title'], v)} />
          <TextRow label="Subtitle" value={c.workflow.sub} area rows={2} onChange={(v) => set(['workflow', 'sub'], v)} />
        </div>
        <StringList label="Steps" items={c.workflow.steps} multiline addLabel="Add step"
          onChange={(v) => set(['workflow', 'steps'], v)} />
      </Block>

      <Block title="Security panel">
        <div className="row">
          <TextRow label="Eyebrow" value={c.security.eyebrow} col={4} onChange={(v) => set(['security', 'eyebrow'], v)} />
          <TextRow label="Title" value={c.security.title} col={8} onChange={(v) => set(['security', 'title'], v)} />
          <TextRow label="Subtitle" value={c.security.sub} area rows={2} onChange={(v) => set(['security', 'sub'], v)} />
        </div>
        <StringList label="Trust points" items={c.security.items} multiline addLabel="Add point"
          onChange={(v) => set(['security', 'items'], v)} />
      </Block>

      <Block title="Pricing intro">
        <div className="row">
          <TextRow label="Eyebrow" value={c.pricing.eyebrow} col={4} onChange={(v) => set(['pricing', 'eyebrow'], v)} />
          <TextRow label="Title" value={c.pricing.title} col={8} onChange={(v) => set(['pricing', 'title'], v)} />
          <TextRow label="Subtitle" value={c.pricing.sub} area rows={2} onChange={(v) => set(['pricing', 'sub'], v)} />
        </div>
      </Block>

      <Block title="FAQ teaser">
        <div className="row">
          <TextRow label="Title" value={c.faq.title} col={6} onChange={(v) => set(['faq', 'title'], v)} />
          <TextRow label="Link label" value={c.faq.allLabel} col={6} onChange={(v) => set(['faq', 'allLabel'], v)} />
        </div>
        <StringList label="Questions" items={c.faq.items} multiline addLabel="Add question"
          onChange={(v) => set(['faq', 'items'], v)} />
      </Block>

      <Block title="Closing call to action">
        <div className="row">
          <TextRow label="Title" value={c.cta.title} col={6} onChange={(v) => set(['cta', 'title'], v)} />
          <TextRow label="Primary button" value={c.cta.primaryCta} col={3} onChange={(v) => set(['cta', 'primaryCta'], v)} />
          <TextRow label="Secondary button" value={c.cta.secondaryCta} col={3} onChange={(v) => set(['cta', 'secondaryCta'], v)} />
          <TextRow label="Body" value={c.cta.body} area rows={2} onChange={(v) => set(['cta', 'body'], v)} />
        </div>
      </Block>

      <Block title="Trust strip">
        <StringList label="Items" items={c.trust} addLabel="Add item" onChange={(v) => set(['trust'], v)} />
      </Block>
    </>
  );
}

function FaqEditor({ content: c, set }) {
  return (
    <>
      <Block title="Page heading">
        <div className="row">
          <TextRow label="Title" value={c.title} col={6} onChange={(v) => set(['title'], v)} />
          <TextRow label="Subtitle" value={c.sub} col={6} onChange={(v) => set(['sub'], v)} />
          <TextRow label="Still-unanswered title" value={c.still.title} col={6} onChange={(v) => set(['still', 'title'], v)} />
          <TextRow label="Still-unanswered body" value={c.still.body} area rows={2} col={6} onChange={(v) => set(['still', 'body'], v)} />
        </div>
      </Block>

      {c.groups.map((group, gi) => (
        <Block key={gi} title={`Group ${gi + 1}`}>
          <div className="d-flex align-items-center gap-2 mb-3">
            <input className="form-control form-control-sm fw-semibold" value={group.title} placeholder="Group title"
              onChange={(e) => set(['groups', gi, 'title'], e.target.value)} />
            <button type="button" className="btn btn-sm btn-outline-danger" title="Remove group"
              onClick={() => set(['groups'], c.groups.filter((_, idx) => idx !== gi))}>
              <Trash2 size={14} />
            </button>
          </div>
          {group.items.map((item, ii) => (
            <div className="border rounded-2 p-2 mb-2" key={ii}>
              <div className="d-flex align-items-start gap-2 mb-2">
                <input className="form-control form-control-sm" value={item.q} placeholder="Question"
                  onChange={(e) => set(['groups', gi, 'items', ii, 'q'], e.target.value)} />
                <button type="button" className="btn btn-sm btn-outline-danger" title="Remove question"
                  onClick={() => set(['groups', gi, 'items'], group.items.filter((_, idx) => idx !== ii))}>
                  <Trash2 size={14} />
                </button>
              </div>
              <textarea className="form-control form-control-sm" rows={2} value={item.a} placeholder="Answer"
                onChange={(e) => set(['groups', gi, 'items', ii, 'a'], e.target.value)} />
            </div>
          ))}
          <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1"
            onClick={() => set(['groups', gi, 'items'], [...group.items, { key: `custom-${Date.now()}`, q: '', a: '' }])}>
            <Plus size={13} /> Add question
          </button>
        </Block>
      ))}

      <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
        onClick={() => set(['groups'], [...c.groups, { key: `group-${Date.now()}`, title: 'New group', items: [] }])}>
        <Plus size={14} /> Add group
      </button>
    </>
  );
}

function TermsEditor({ content: c, set }) {
  return (
    <>
      <Block title="Page heading">
        <div className="row">
          <TextRow label="Title" value={c.title} col={4} onChange={(v) => set(['title'], v)} />
          <TextRow label="Updated label" value={c.updatedLabel} col={4} onChange={(v) => set(['updatedLabel'], v)} />
          <TextRow label="Contents label" value={c.contentsLabel} col={4} onChange={(v) => set(['contentsLabel'], v)} />
          <TextRow label="Article label" value={c.articleLabel} col={4} onChange={(v) => set(['articleLabel'], v)} />
          <TextRow label="Intro" value={c.intro} area rows={3} col={8} onChange={(v) => set(['intro'], v)} />
        </div>
      </Block>

      {c.articles.map((article, ai) => (
        <Block key={ai} title={`Article ${ai + 1}`}>
          <div className="d-flex align-items-center gap-2 mb-3">
            <input className="form-control form-control-sm fw-semibold" value={article.title} placeholder="Article title"
              onChange={(e) => set(['articles', ai, 'title'], e.target.value)} />
            <button type="button" className="btn btn-sm btn-outline-danger" title="Remove article"
              onClick={() => set(['articles'], c.articles.filter((_, idx) => idx !== ai))}>
              <Trash2 size={14} />
            </button>
          </div>
          <StringList label="Clauses" items={article.clauses} multiline addLabel="Add clause"
            onChange={(v) => set(['articles', ai, 'clauses'], v)} />
        </Block>
      ))}

      <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1 mb-4"
        onClick={() => set(['articles'], [...c.articles, { key: `article-${Date.now()}`, title: 'New article', clauses: [''] }])}>
        <Plus size={14} /> Add article
      </button>

      <Block title="Closing block">
        <div className="row">
          <TextRow label="Title" value={c.questionsTitle} col={6} onChange={(v) => set(['questionsTitle'], v)} />
          <TextRow label="Body" value={c.questionsBody} area rows={2} col={6} onChange={(v) => set(['questionsBody'], v)} />
        </div>
      </Block>
    </>
  );
}

function PrivacyEditor({ content: c, set }) {
  return (
    <>
      <Block title="Page heading">
        <div className="row">
          <TextRow label="Title" value={c.title} col={6} onChange={(v) => set(['title'], v)} />
          <TextRow label="Updated label" value={c.updatedLabel} col={6} onChange={(v) => set(['updatedLabel'], v)} />
          <TextRow label="Intro" value={c.intro} area rows={3} onChange={(v) => set(['intro'], v)} />
        </div>
        <StringList label="Promise chips" items={c.promises} addLabel="Add promise"
          onChange={(v) => set(['promises'], v)} />
      </Block>

      {c.sections.map((section, si) => (
        <Block key={si} title={`Section ${si + 1}`}>
          <div className="d-flex align-items-center gap-2 mb-3">
            <input className="form-control form-control-sm fw-semibold" value={section.title} placeholder="Section title"
              onChange={(e) => set(['sections', si, 'title'], e.target.value)} />
            <button type="button" className="btn btn-sm btn-outline-danger" title="Remove section"
              onClick={() => set(['sections'], c.sections.filter((_, idx) => idx !== si))}>
              <Trash2 size={14} />
            </button>
          </div>
          <StringList label="Paragraphs" items={section.body} multiline addLabel="Add paragraph"
            onChange={(v) => set(['sections', si, 'body'], v)} />
        </Block>
      ))}

      <button type="button" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1 mb-4"
        onClick={() => set(['sections'], [...c.sections, { key: `section-${Date.now()}`, title: 'New section', body: [''] }])}>
        <Plus size={14} /> Add section
      </button>

      <Block title="Contact block">
        <div className="row">
          <TextRow label="Title" value={c.contactTitle} col={6} onChange={(v) => set(['contactTitle'], v)} />
          <TextRow label="Body" value={c.contactBody} area rows={2} col={6} onChange={(v) => set(['contactBody'], v)} />
        </div>
      </Block>
    </>
  );
}
