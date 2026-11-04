import { env } from '../config/env.js';

/**
 * Public-site copy is stored in the existing email_templates key/value table under a reserved
 * prefix. The prefix keeps website content out of the email template list and avoids a schema
 * change on already-provisioned tenants.
 */
export const SITE_CONTENT_PAGES = ['home', 'faq', 'terms', 'privacy'];
export const SITE_CONTENT_PREFIX = 'site_content_';

export const siteContentKey = (page) => `${SITE_CONTENT_PREFIX}${page}`;
export const isSiteContentKey = (key) => String(key || '').startsWith(SITE_CONTENT_PREFIX);

export function parseSiteContent(row) {
  try {
    const content = JSON.parse(row.body_html);
    return content && typeof content === 'object' && !Array.isArray(content) ? content : null;
  } catch {
    return null;
  }
}

/** Stored pages keyed by page name, each with its own timestamp. Missing pages are simply absent. */
export async function readSiteContent(supabase) {
  if (!env.configured) return {};
  const { data, error } = await supabase.from('email_templates')
    .select('template_key, body_html, updated_at')
    .in('template_key', SITE_CONTENT_PAGES.map(siteContentKey));
  if (error) throw new Error(error.message);
  const pages = {};
  for (const row of data || []) {
    const content = parseSiteContent(row);
    if (!content) continue;
    pages[row.template_key.slice(SITE_CONTENT_PREFIX.length)] = { content, updated_at: row.updated_at };
  }
  return pages;
}

export async function writeSiteContent(supabase, page, content) {
  const { error } = await supabase.from('email_templates').upsert({
    template_key: siteContentKey(page),
    subject: `Site content · ${page}`,
    body_html: JSON.stringify(content),
    variables: [],
    updated_at: new Date().toISOString(),
  }, { onConflict: 'template_key' });
  if (error) throw new Error(error.message);
}

export async function clearSiteContent(supabase, page) {
  const { error } = await supabase.from('email_templates').delete().eq('template_key', siteContentKey(page));
  if (error) throw new Error(error.message);
}

/** Reject oversized or non-object payloads before they reach JSON.stringify. */
export function assertSiteContent(content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return 'Page content must be an object.';
  }
  if (JSON.stringify(content).length > 400_000) return 'This page is too large to save (400 KB limit).';
  return null;
}
