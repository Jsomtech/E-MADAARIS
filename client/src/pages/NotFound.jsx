import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Compass } from 'lucide-react';

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="text-center py-5">
      <Compass size={38} className="text-brand mb-2" style={{ color: '#6027ff' }} />
      <h1 className="h4">404</h1>
      <p className="text-muted">{t('errors.notFound', { defaultValue: 'This page does not exist or is not available for your role.' })}</p>
      <Link to="/" className="btn btn-primary btn-sm">{t('public.backHome', { defaultValue: 'Back to dashboard' })}</Link>
    </div>
  );
}
