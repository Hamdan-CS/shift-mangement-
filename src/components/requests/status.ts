import type { WChipTone } from '@/components/app/ui';
import type { RequestStatus } from '@/types';

/** Status chips for corrections and leave requests. */
export const STATUS_CHIP: Record<RequestStatus, { label: string; tone: WChipTone }> = {
  pending: { label: 'Waiting', tone: 'accent' },
  approved: { label: 'Approved', tone: 'ok' },
  declined: { label: 'Declined', tone: 'danger' },
};
