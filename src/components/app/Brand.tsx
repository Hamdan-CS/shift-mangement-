import { Link } from 'react-router-dom';
import { Clock3 } from 'lucide-react';

/** Logo mark + product name + company line (Amplo top-left). */
export function Brand({ company }: { company?: string | null }) {
  return (
    <Link to="/" className="sc-brand" aria-label="ShiftClock home">
      <span className="sc-brand-mark"><Clock3 size={19} strokeWidth={2.2} /></span>
      <span>
        <b>ShiftClock</b>
        {company && <small>{company}</small>}
      </span>
    </Link>
  );
}
