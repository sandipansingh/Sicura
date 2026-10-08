import Link from 'next/link';
import { ArrowRight, ShieldAlert, KeyRound, Database, FileCheck } from 'lucide-react';
import { Header } from './ui/Header';
import { Footer } from './ui/Footer';
import styles from './landing.module.css';

const features = [
  {
    title: 'Find exposed credentials',
    description:
      'Analyze source and configuration files for credential exposure. Findings are redacted; credential validity is not tested.',
    Icon: ShieldAlert,
  },
  {
    title: 'Review access expectations',
    description:
      'Define who should be able to read or change each table before comparing policy behavior with your intended permissions.',
    Icon: KeyRound,
  },
  {
    title: 'Verify RLS policies',
    description:
      'Run controlled scenarios in a disposable local PostgreSQL replica using synthetic rows and low-privilege identities.',
    Icon: Database,
  },
  {
    title: 'Review and export repairs',
    description:
      'Review advisory AI analysis and suggested migrations, approve a replica retest, and export the migration file.',
    Icon: FileCheck,
  },
];

export default function LandingPage() {
  return (
    <div className={styles.page}>
      <div className="grid-overlay" />
      <div className="noise-overlay" />
      <Header isAppView={false} />
      <main className={`container ${styles.main}`}>
        <section className={styles.hero}>
          <h1>Investigate your project’s security.</h1>
          <p>
            Find exposed credentials and review Supabase and PostgreSQL access policies. Sicura
            brings findings, access expectations, and local verification into one workbench.
          </p>
          <Link href="/app" className="primary-cta">
            Open workbench <ArrowRight size={20} aria-hidden="true" />
          </Link>
        </section>
        <section aria-labelledby="features-heading">
          <h2 id="features-heading" className={styles.sectionTitle}>
            From findings to a reviewed repair
          </h2>
          <div className={styles.features}>
            {features.map(({ title, description, Icon }) => (
              <article key={title} className={`action-card accent-border-green ${styles.feature}`}>
                <Icon size={24} aria-hidden="true" />
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
