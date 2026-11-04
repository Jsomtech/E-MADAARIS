import { useParams } from 'react-router-dom';
import NotFound from '../NotFound.jsx';
import { PLATFORM_SECTIONS } from './index.js';

/** /platform/* — platform-console pages (schools, plans, billing, users, analytics…). */
export default function PlatformSectionPage() {
  const params = useParams();
  const segments = (params['*'] || '').split('/').filter(Boolean);
  const Page = PLATFORM_SECTIONS[segments[0]];
  if (!Page) return <NotFound />;
  return <Page params={segments} />;
}
