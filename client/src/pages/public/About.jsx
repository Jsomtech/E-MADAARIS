import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Building2, HeartHandshake, Languages, Lightbulb, Lock, ShieldCheck, Target, Users, ArrowRight } from 'lucide-react';

const BRAND = '#6027ff';

const VALUES = [
  { icon: Target, key: 'focus', title: 'School-first thinking', body: 'Every screen starts from a real workflow — the register, the cashier desk, the exam board — not from a generic database table.' },
  { icon: Languages, key: 'language', title: 'Somali and English', body: 'Heads of schools, bursars and teachers should not fight an English-only interface to do their job. Both languages ship together.' },
  { icon: Lock, key: 'privacy', title: 'Data is the school’s', body: 'One tenant per school, isolated reads and writes, exports on demand and a clear retention promise.' },
  { icon: HeartHandshake, key: 'support', title: 'Humans answer', body: 'Support tickets are read by the platform team, and invitations, approvals and billing questions have a named owner.' },
  { icon: Lightbulb, key: 'practical', title: 'Practical over flashy', body: 'Works on modest hardware and modest bandwidth, prints the paperwork schools still need, and never hides a required field.' },
  { icon: ShieldCheck, key: 'trust', title: 'Trust is engineered', body: 'Role permissions checked server-side, audit trails on sensitive actions, subscription limits enforced at write time.' },
];

const MILESTONES = [
  { key: 'origin', title: 'The problem', body: 'Schools were keeping enrolment in a notebook, fees in an Excel file, results in a drawer and transport in someone’s memory.' },
  { key: 'build', title: 'The build', body: 'JSOM TECH designed E-MADAARIS as a multi-tenant platform: one shared codebase, strictly separated school data, role dashboards for nineteen job types.' },
  { key: 'modules', title: 'The modules', body: 'Admissions, attendance, exams and results, finance, library, transport, HR, reception, discipline, labs and digital learning — released as one system.' },
  { key: 'today', title: 'Today', body: 'Registration is self-service, plans are published, certificates carry verifiable reference numbers, and the platform team reviews each new school.' },
];

/** Company and product story for JSOM TECH / E-MADAARIS. */
export default function About() {
  const { t } = useTranslation();

  return (
    <>
      <section className="public-hero py-5">
        <div className="container">
          <h1 className="h2 fw-bold mb-2">{t('about.title', { defaultValue: 'About E-MADAARIS' })}</h1>
          <p className="mb-0" style={{ color: '#d9d2f7', maxWidth: '48rem' }}>
            {t('about.sub', { defaultValue: 'A school-management platform built by JSOM TECH for schools that want one system instead of five spreadsheets.' })}
          </p>
        </div>
      </section>

      <section className="public-section">
        <div className="container">
          <div className="row g-5">
            <div className="col-12 col-lg-7">
              <h2 className="h4 fw-bold mb-3" style={{ color: '#130c2d' }}>
                {t('about.storyTitle', { defaultValue: 'Why we built it' })}
              </h2>
              <p className="text-muted">
                {t('about.story1', { defaultValue: 'E-MADAARIS — “the schools” — began with a simple observation: a growing school does not fail because its staff are unmotivated, it loses hours because information is scattered. The registrar had one list, the bursar another, and the principal heard the difference at the end of the term.' })}
              </p>
              <p className="text-muted">
                {t('about.story2', { defaultValue: 'We rebuilt that school as a single platform. One login for every role, one academic year that drives every report, one fee structure that produces both the receipt at the desk and the balance the bursar reports. Each school runs in its own tenant, so adding a new school never puts another school’s records at risk.' })}
              </p>
              <p className="text-muted mb-0">
                {t('about.story3', { defaultValue: 'JSOM TECH builds and operates the platform: we publish the plans, review each registration, provision the administrator account, and keep the modules working through admission day, exam week and the fee season that follows.' })}
              </p>
            </div>
            <div className="col-12 col-lg-5">
              <div className="card-soft p-4 h-100">
                <div className="d-flex align-items-center gap-2 mb-3">
                  <span className="stat-icon"><Building2 size={18} /></span>
                  <div className="fw-semibold">{t('about.missionTitle', { defaultValue: 'Our mission' })}</div>
                </div>
                <p className="mb-3">
                  {t('about.mission', { defaultValue: 'To give every school — primary, secondary, integrated or branch network — an affordable, bilingual, secure system that runs admissions, academics, finance and operations in one place, so staff spend their time on students instead of paperwork.' })}
                </p>
                <div className="row g-3">
                  <Facts icon={Users} value={19} label={t('about.rolesCount', { defaultValue: 'Role dashboards' })} />
                  <Facts icon={Lightbulb} value={16} label={t('about.modulesCount', { defaultValue: 'Product modules' })} />
                  <Facts icon={ShieldCheck} value={2} label={t('about.languagesCount', { defaultValue: 'Interface languages' })} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-5" style={{ background: '#eef0f4' }}>
        <div className="container">
          <h2 className="h4 fw-bold mb-4" style={{ color: '#130c2d' }}>{t('about.valuesTitle', { defaultValue: 'What we optimise for' })}</h2>
          <div className="row g-3">
            {VALUES.map((v) => (
              <div className="col-12 col-md-6 col-lg-4" key={v.key}>
                <div className="card-soft p-3 h-100">
                  <div className="fw-semibold mb-2 d-flex align-items-center gap-2">
                    <v.icon size={17} style={{ color: BRAND }} />
                    {t(`about.values.${v.key}.title`, { defaultValue: v.title })}
                  </div>
                  <div className="small text-muted">{t(`about.values.${v.key}.body`, { defaultValue: v.body })}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="public-section">
        <div className="container">
          <h2 className="h4 fw-bold mb-4" style={{ color: '#130c2d' }}>{t('about.timelineTitle', { defaultValue: 'How the platform came together' })}</h2>
          <div className="row g-3">
            {MILESTONES.map((m, i) => (
              <div className="col-12 col-md-6 col-lg-3" key={m.key}>
                <div className="card-soft p-3 h-100">
                  <div className="stat-icon mb-2">{i + 1}</div>
                  <div className="fw-semibold mb-1">{t(`about.milestones.${m.key}.title`, { defaultValue: m.title })}</div>
                  <div className="small text-muted">{t(`about.milestones.${m.key}.body`, { defaultValue: m.body })}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="card-soft p-4 mt-4">
            <h3 className="h6 fw-bold mb-3">{t('about.principlesTitle', { defaultValue: 'Platform principles' })}</h3>
            <ol className="mb-0 small text-muted ps-3">
              {[
                'One school, one tenant — isolation is the default, never a setting to remember.',
                'The interface shows a role only what its permissions allow, and the API enforces the same rule.',
                'Money and marks need approvals: no result or fee waiver is final until a second person signs it off.',
                'Paper still matters: report cards, receipts and certificates print cleanly.',
                'Trials and plans are enforced by real limits, so a school knows exactly when to grow.',
                'Somali is a first-class language, not a translation added after launch.',
              ].map((line, i) => (
                <li key={line.slice(0, 16)} className="mb-2">{t(`about.principles.${i}`, { defaultValue: line })}</li>
              ))}
            </ol>
          </div>

          <div className="d-flex flex-wrap gap-2 mt-4">
            <Link to="/features" className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1">
              {t('public.features', { defaultValue: 'Features' })} <ArrowRight size={14} />
            </Link>
            <Link to="/contact" className="btn btn-sm btn-primary">{t('public.contact', { defaultValue: 'Contact' })}</Link>
            <Link to="/contact" className="btn btn-sm btn-outline-primary">{t('public.contact', { defaultValue: 'Contact' })}</Link>
          </div>
        </div>
      </section>
    </>
  );
}

function Facts({ icon: Icon, value, label }) {
  return (
    <div className="col-4">
      <div className="stat-icon mb-1"><Icon size={16} /></div>
      <div className="fw-bold fs-5">{value}</div>
      <div className="small text-muted">{label}</div>
    </div>
  );
}
