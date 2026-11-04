/**
 * Flow pages that need more than generic CRUD. Anything not listed here falls back
 * to the config-driven EntityPage in ../ModulePage.jsx.
 */
import AttendancePage from './AttendancePage.jsx';
import MarksPage from './MarksPage.jsx';
import ResultsPage from './ResultsPage.jsx';
import ReportCardPage from './ReportCardPage.jsx';
import ExaminationsPage from './ExaminationsPage.jsx';
import FinancePaymentsPage from './FinancePaymentsPage.jsx';
import FeeCollectionPage from './FeeCollectionPage.jsx';
import FinanceSummaryPage from './FinanceSummaryPage.jsx';
import ClearancesPage from './ClearancesPage.jsx';
import LibraryLoansPage from './LibraryLoansPage.jsx';
import ClassManagementPage from './ClassManagementPage.jsx';
import LessonsPage from './LessonsPage.jsx';
import ElectionsPage from './ElectionsPage.jsx';

export const SPECIAL_MODULES = {
  classes: ClassManagementPage,
  attendance: AttendancePage,
  marks: MarksPage,
  results: ResultsPage,
  'report-card': ReportCardPage,
  examinations: ExaminationsPage,
  'finance-payments': FinancePaymentsPage,
  'fee-collection': FeeCollectionPage,
  'finance-summary': FinanceSummaryPage,
  clearances: ClearancesPage,
  'library-loans': LibraryLoansPage,
  'learning-materials': LessonsPage,
  elections: ElectionsPage,
};
