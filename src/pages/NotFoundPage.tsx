import { Link } from 'react-router-dom';
import { WPageHeader } from '@/components/app/ui';

export function NotFoundPage() {
  return (
    <>
      <WPageHeader title="Page not found" subtitle="That link doesn't go anywhere." />
      <Link to="/" className="sc-btn sc-btn-primary">Back to overview</Link>
    </>
  );
}
