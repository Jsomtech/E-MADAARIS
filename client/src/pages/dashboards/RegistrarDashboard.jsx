import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  GraduationCap, UserPlus, Star, Users, ClipboardList, CreditCard, School,
} from 'lucide-react';
import { useApi } from '../../hooks/useApi.js';
import DataTable from '../../components/ui/DataTable.jsx';
import {
  PageHeader, StatCard, Spinner, ErrorState, EmptyState,
} from '../../components/ui/Basics.jsx';
import { ChartCard, BarView } from '../../components/ui/Charts.jsx';

/**
 * Registrar home: enrolment totals and the class spread from GET /school/dashboard, plus the
 * newest admissions. Quick links cover the day-to-day registrar workflow (admissions, students,
 * guardians, classes, ID cards).
 */
export default function RegistrarDashboard() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useApi('/school/dashboard');

  if (loading && !data) return <Spinner label={t('common.loading')} />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const byClass = Object.entries(data?.studentsByClass || {}).sort((a, b) => b[1] - a[1]);
  const recent = data?.recentStudents || [];

  const columns = [
    {
      key: 'first_name',
      label: t('common.name'),
      render: (r) => (
        <Link to="/m/students" className="text-decoration-none fw-semibold">
          {`${r.first_name || ''} ${r.last_name || ''}`.trim() || r.id}
        </Link>
      ),
    },
    { key: 'admission_number', label: t('dashboards.admissionNumber', { defaultValue: 'Admission no.' }) },
    {
      key: 'class_id',
      label: t('modules.classes'),
      render: (r) => r.classes?.name || r.class_name
        || (r.class_id ? t('dashboards.assigned', { defaultValue: 'Assigned' }) : t('dashboards.withoutClass', { defaultValue: 'without a class' })),
    },
    { key: 'status', label: t('common.status'), type: 'status' },
    { key: 'created_at', label: t('common.date'), type: 'date' },
  ];

  return (
    <>
      <PageHeader
        title={t('dashboards.registrarHome', { defaultValue: 'Registrar overview' })}
        subtitle={`${data?.school?.school_name || ''} · ${data?.subscription?.plan?.name || data?.subscription?.plan || ''}`}
        actions={(
          <>
            <Link to="/school/admissions" className="btn btn-sm btn-primary d-flex align-items-center gap-1">
              <Star size={14} /> {t('modules.admissions')}
            </Link>
            <Link to="/m/students" className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1">
              <GraduationCap size={14} /> {t('modules.students')}
            </Link>
          </>
        )}
      />

      <div className="row g-3 mb-1">
        <div className="col-6 col-lg-3">
          <StatCard label={t('dashboards.enrolledStudents', { defaultValue: 'Enrolled students' })} value={data?.totalStudents} icon={GraduationCap} />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard label={t('dashboards.pendingAdmissions', { defaultValue: 'Students without a class' })} value={data?.pendingAdmissions} icon={UserPlus} tone="warn"
            hint={t('dashboards.pendingAdmissionsHint', { defaultValue: 'Assign them a class' })} />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard label={t('dashboards.classListed', { defaultValue: 'Classes in use' })} value={byClass.length} icon={ClipboardList} />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard label={t('dashboards.newThisList', { defaultValue: 'Recently admitted' })} value={recent.length} icon={Star} />
        </div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12 col-lg-7">
          <ChartCard title={t('dashboards.studentsByClass', { defaultValue: 'Students per class' })}
            subtitle={t('dashboards.studentsByClassHint', { defaultValue: 'Active students, by class name' })}>
            {byClass.length === 0 && <EmptyState title={t('common.none')} hint={t('dashboards.noClassHint', { defaultValue: 'No class has students yet.' })} />}
            {byClass.length > 0 && (
              <BarView
                labels={byClass.map(([name]) => name)}
                datasets={[{ label: t('modules.students'), data: byClass.map(([, count]) => count) }]}
                height={260}
              />
            )}
            <Link to="/m/classes" className="btn btn-sm btn-outline-primary mt-2">{t('modules.classes')}</Link>
          </ChartCard>
        </div>

        <div className="col-12 col-lg-5">
          <div className="card-soft p-3 h-100">
            <div className="fw-semibold mb-2"><Users size={15} className="me-1" /> {t('dashboards.quickLinks', { defaultValue: 'Quick links' })}</div>
            <div className="list-group list-group-flush">
              <Link to="/school/admissions" className="list-group-item list-group-item-action d-flex align-items-center gap-2">
                <Star size={16} /> {t('modules.admissions')}
              </Link>
              <Link to="/m/students" className="list-group-item list-group-item-action d-flex align-items-center gap-2">
                <GraduationCap size={16} /> {t('modules.students')}
              </Link>
              <Link to="/m/guardians" className="list-group-item list-group-item-action d-flex align-items-center gap-2">
                <Users size={16} /> {t('modules.guardians')}
              </Link>
              <Link to="/m/classes" className="list-group-item list-group-item-action d-flex align-items-center gap-2">
                <School size={16} /> {t('modules.classes')}
              </Link>
              <Link to="/school/id-cards" className="list-group-item list-group-item-action d-flex align-items-center gap-2">
                <CreditCard size={16} /> {t('dashboards.idCards', { defaultValue: 'ID cards' })}
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="row g-3 mt-1">
        <div className="col-12">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <div className="fw-semibold"><GraduationCap size={15} className="me-1" /> {t('dashboards.recentStudents', { defaultValue: 'Recently admitted students' })}</div>
            <Link to="/m/students" className="small">{t('common.viewAll')}</Link>
          </div>
          <DataTable columns={columns} rows={recent} dense empty={t('dashboards.noRecentStudents', { defaultValue: 'No admissions recorded yet' })} />
          <div className="small text-muted mt-2">{t('dashboards.rowsLimited', { defaultValue: 'Showing the latest admissions only.' })}</div>
        </div>
      </div>
    </>
  );
}
