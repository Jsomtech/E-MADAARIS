import { useParams } from 'react-router-dom';
import NotFound from '../NotFound.jsx';
import { SCHOOL_SECTIONS } from './index.js';

/** /school/:section — school-scoped pages that are not generic CRUD modules. */
export default function SchoolSectionPage() {
  const { section } = useParams();
  const Page = SCHOOL_SECTIONS[section];
  if (!Page) return <NotFound />;
  return <Page />;
}
