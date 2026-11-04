import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import EntityPage from '../components/EntityPage.jsx';
import { RESOURCES, humanize } from '../config/resources.jsx';
import { SPECIAL_MODULES } from './modules/index.js';
import NotFound from './NotFound.jsx';

/** Shared module route: /m/:resource renders a custom flow page or the config-driven CRUD page. */
export default function ModulePage() {
  const { resource } = useParams();
  const { t } = useTranslation();
  const [params] = useSearchParams();

  const Special = SPECIAL_MODULES[resource];
  if (Special) return <Special query={Object.fromEntries(params.entries())} />;

  const def = RESOURCES[resource];
  if (!def) return <NotFound />;

  const subtitle = resource === 'students'
    ? t('sections.studentsModuleSubtitle', {
      defaultValue: 'Register one student or import a whole class — school administrators and registrars use this same form.',
    })
    : undefined;

  return (
    <EntityPage
      config={{ ...def, key: resource }}
      title={t(`modules.${resource}`, { defaultValue: humanize(resource) })}
      subtitle={subtitle}
    />
  );
}
