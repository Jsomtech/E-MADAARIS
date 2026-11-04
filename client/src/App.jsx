import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import PublicLayout from './components/layout/PublicLayout.jsx';
import RoleLayout from './components/layout/RoleLayout.jsx';
import { RequireAuth, RequirePlatform, RequireSchool } from './components/RouteGuards.jsx';
import { Spinner } from './components/ui/Basics.jsx';
import ModulePage from './pages/ModulePage.jsx';
import SchoolSectionPage from './pages/school/SchoolSectionPage.jsx';
import PlatformSectionPage from './pages/platform/PlatformSectionPage.jsx';

const Home = lazy(() => import('./pages/public/Home.jsx'));
const Features = lazy(() => import('./pages/public/Features.jsx'));
const Pricing = lazy(() => import('./pages/public/Pricing.jsx'));
const About = lazy(() => import('./pages/public/About.jsx'));
const Contact = lazy(() => import('./pages/public/Contact.jsx'));
const Faq = lazy(() => import('./pages/public/Faq.jsx'));
const Terms = lazy(() => import('./pages/public/Terms.jsx'));
const Privacy = lazy(() => import('./pages/public/Privacy.jsx'));
const Verify = lazy(() => import('./pages/public/Verify.jsx'));

const Login = lazy(() => import('./pages/auth/Login.jsx'));
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword.jsx'));
const AcceptInvite = lazy(() => import('./pages/auth/AcceptInvite.jsx'));

const AccountPage = lazy(() => import('./pages/AccountPage.jsx'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));

const PlatformSuperAdminDashboard = lazy(() => import('./pages/dashboards/PlatformSuperAdminDashboard.jsx'));
const PlatformSupportDashboard = lazy(() => import('./pages/dashboards/PlatformSupportDashboard.jsx'));
const SchoolAdminDashboard = lazy(() => import('./pages/dashboards/SchoolAdminDashboard.jsx'));
const PrincipalDashboard = lazy(() => import('./pages/dashboards/PrincipalDashboard.jsx'));
const VicePrincipalDashboard = lazy(() => import('./pages/dashboards/VicePrincipalDashboard.jsx'));
const RegistrarDashboard = lazy(() => import('./pages/dashboards/RegistrarDashboard.jsx'));
const TeacherDashboard = lazy(() => import('./pages/dashboards/TeacherDashboard.jsx'));
const AccountantDashboard = lazy(() => import('./pages/dashboards/AccountantDashboard.jsx'));
const ExamOfficerDashboard = lazy(() => import('./pages/dashboards/ExamOfficerDashboard.jsx'));
const InvigilatorDashboard = lazy(() => import('./pages/dashboards/InvigilatorDashboard.jsx'));
const StudentDashboard = lazy(() => import('./pages/dashboards/StudentDashboard.jsx'));
const ParentDashboard = lazy(() => import('./pages/dashboards/ParentDashboard.jsx'));
const StaffDashboard = lazy(() => import('./pages/dashboards/StaffDashboard.jsx'));

const LibrarianDashboard = lazy(() => import('./pages/dashboards/LibrarianDashboard.jsx'));
const HrDashboard = lazy(() => import('./pages/dashboards/HrDashboard.jsx'));
const ReceptionDashboard = lazy(() => import('./pages/dashboards/ReceptionDashboard.jsx'));
const DisciplineDashboard = lazy(() => import('./pages/dashboards/DisciplineDashboard.jsx'));
const TransportDashboard = lazy(() => import('./pages/dashboards/TransportDashboard.jsx'));
const LabDashboard = lazy(() => import('./pages/dashboards/LabDashboard.jsx'));

const STAFF_DASHBOARDS = {
  librarian: LibrarianDashboard, hr: HrDashboard, reception: ReceptionDashboard,
  discipline: DisciplineDashboard, transport: TransportDashboard, lab: LabDashboard,
};

/** Signed-in users land on the dashboard their primary role owns. */
function DashboardRedirect() {
  const { profile } = useAuth();
  return <Navigate to={profile?.dashboardRoute || '/login'} replace />;
}

function StaffRoleDashboard() {
  const { section } = useParams();
  const Page = STAFF_DASHBOARDS[section];
  return Page ? <Page /> : <NotFound />;
}

export default function App() {
  const { profile } = useAuth();
  // A new sign-in (different user or school) must remount the whole tree so no
  // component state from the previous tenant survives in this tab.
  const sessionScope = profile ? `${profile.school?.id || 'platform'}:${profile.userId || profile.email || ''}` : 'public';
  return (
    <Suspense key={sessionScope} fallback={<div className="p-5 text-center"><Spinner /></div>}>
      <Routes>
        {/* ── Public marketing site ─────────────────────────────── */}
        <Route element={<PublicLayout />}>
          <Route index element={<Home />} />
          <Route path="features" element={<Features />} />
          <Route path="pricing" element={<Pricing />} />
          <Route path="about" element={<About />} />
          <Route path="contact" element={<Contact />} />
          <Route path="faq" element={<Faq />} />
          <Route path="terms" element={<Terms />} />
          <Route path="privacy" element={<Privacy />} />
          <Route path="verify" element={<Verify />} />
          <Route path="verify/:kind/:value" element={<Verify />} />
          <Route path="login" element={<Login />} />
          <Route path="auth/reset-password" element={<ResetPassword />} />
          <Route path="auth/accept-invite" element={<AcceptInvite />} />
        </Route>

        {/* ── Authenticated application ─────────────────────────── */}
        <Route path="/" element={<RequireAuth><RoleLayout /></RequireAuth>}>
          <Route path="account" element={<AccountPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="dashboard" element={<DashboardRedirect />} />

          <Route path="super-admin" element={<RequirePlatform><PlatformSuperAdminDashboard /></RequirePlatform>} />
          <Route path="platform-support" element={<RequirePlatform><PlatformSupportDashboard /></RequirePlatform>} />
          <Route path="platform/*" element={<RequirePlatform><PlatformSectionPage /></RequirePlatform>} />

          <Route path="school-admin" element={<RequireSchool><SchoolAdminDashboard /></RequireSchool>} />
          <Route path="principal" element={<RequireSchool><PrincipalDashboard /></RequireSchool>} />
          <Route path="vice-principal" element={<RequireSchool><VicePrincipalDashboard /></RequireSchool>} />
          <Route path="registrar" element={<RequireSchool><RegistrarDashboard /></RequireSchool>} />
          <Route path="teacher" element={<RequireSchool><TeacherDashboard /></RequireSchool>} />
          <Route path="accountant" element={<RequireSchool><AccountantDashboard /></RequireSchool>} />
          <Route path="exam-officer" element={<RequireSchool><ExamOfficerDashboard /></RequireSchool>} />
          <Route path="invigilator" element={<RequireSchool><InvigilatorDashboard /></RequireSchool>} />
          <Route path="student" element={<RequireSchool><StudentDashboard /></RequireSchool>} />
          <Route path="parent" element={<RequireSchool><ParentDashboard /></RequireSchool>} />
          <Route path="staff" element={<RequireSchool><StaffDashboard /></RequireSchool>} />
          <Route path="staff/:section" element={<RequireSchool><StaffRoleDashboard /></RequireSchool>} />

          <Route path="school/:section" element={<RequireSchool><SchoolSectionPage /></RequireSchool>} />
          <Route path="m/:resource" element={<ModulePage />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
