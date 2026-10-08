import { redirect } from 'next/navigation';
import LandingPage from '../components/LandingPage';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ project?: string | string[] }>;
}) {
  const { project } = await searchParams;
  if (typeof project === 'string' && /^project_[a-f0-9]{32}$/.test(project))
    redirect(`/app?project=${project}`);
  return <LandingPage />;
}
