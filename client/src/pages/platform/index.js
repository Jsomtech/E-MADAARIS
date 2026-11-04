import SchoolsPage from './SchoolsPage.jsx';
import ApplicationsPage from './ApplicationsPage.jsx';
import PlansPage from './PlansPage.jsx';
import SubscriptionsPage from './SubscriptionsPage.jsx';
import InvoicesPage from './InvoicesPage.jsx';
import PaymentsPage from './PaymentsPage.jsx';
import PlatformUsersPage from './PlatformUsersPage.jsx';
import AnalyticsPage from './AnalyticsPage.jsx';
import TicketsPage from './TicketsPage.jsx';
import AuditPage from './AuditPage.jsx';
import BackupsPage from './BackupsPage.jsx';
import TrashPage from './TrashPage.jsx';
import ContentPage from './ContentPage.jsx';
import TransfersPage from './TransfersPage.jsx';
import PlatformElectionsPage from './ElectionsPage.jsx';

/** Keys are the first segment of /platform/*. */
export const PLATFORM_SECTIONS = {
  schools: SchoolsPage,
  applications: ApplicationsPage,
  plans: PlansPage,
  subscriptions: SubscriptionsPage,
  invoices: InvoicesPage,
  payments: PaymentsPage,
  users: PlatformUsersPage,
  analytics: AnalyticsPage,
  tickets: TicketsPage,
  backups: BackupsPage,
  trash: TrashPage,
  audit: AuditPage,
  content: ContentPage,
  transfers: TransfersPage,
  elections: PlatformElectionsPage,
};
