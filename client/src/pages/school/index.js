import UsersPage from './UsersPage.jsx';
import SchoolProfilePage from './SchoolProfilePage.jsx';
import SettingsPage from './SettingsPage.jsx';
import SubscriptionPage from './SubscriptionPage.jsx';
import ReportsPage from './ReportsPage.jsx';
import AuditPage from './AuditPage.jsx';
import SupportPage from './SupportPage.jsx';
import AdmissionsPage from './AdmissionsPage.jsx';
import IdCardsPage from './IdCardsPage.jsx';
import MyFeesPage from './MyFeesPage.jsx';
import MyChildrenPage from './MyChildrenPage.jsx';
import MyTimetablePage from './MyTimetablePage.jsx';
import TrashPage from './TrashPage.jsx';
import BackupsPage from './BackupsPage.jsx';
import TimetablePage from './TimetablePage.jsx';
import TransfersPage from './TransfersPage.jsx';
import StudentElectionsPage from './StudentElectionsPage.jsx';

/** Keys are the segment in /school/:section. */
export const SCHOOL_SECTIONS = {
  users: UsersPage,
  profile: SchoolProfilePage,
  settings: SettingsPage,
  subscription: SubscriptionPage,
  reports: ReportsPage,
  audit: AuditPage,
  support: SupportPage,
  admissions: AdmissionsPage,
  'id-cards': IdCardsPage,
  'my-fees': MyFeesPage,
  'my-children': MyChildrenPage,
  'my-timetable': MyTimetablePage,
  'student-elections': StudentElectionsPage,
  trash: TrashPage,
  backups: BackupsPage,
  timetable: TimetablePage,
  transfers: TransfersPage,
};
