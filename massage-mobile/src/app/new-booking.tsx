import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { BookingFlow } from '@/components/booking-flow';
import { useAuth } from '@/lib/auth';

const num = (v?: string) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined);

/**
 * Staff booking for phone calls and walk-ins.
 * Optional params pre-fill the flow: serviceId, therapistId, date, startMin, clientName, clientEmail, clientPhone.
 */
export default function NewBooking() {
  const { business } = useAuth();
  const p = useLocalSearchParams<{
    serviceId?: string; therapistId?: string; date?: string; startMin?: string;
    clientName?: string; clientEmail?: string; clientPhone?: string;
  }>();
  const initial = useMemo(() => ({
    serviceId: num(p.serviceId),
    therapistId: num(p.therapistId),
    date: p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : undefined,
    startMin: num(p.startMin),
    client: { name: p.clientName, email: p.clientEmail, phone: p.clientPhone },
  }), [p.serviceId, p.therapistId, p.date, p.startMin, p.clientName, p.clientEmail, p.clientPhone]);
  if (!business) return null;
  return (
    <BookingFlow
      slug={business.slug}
      mode="staff"
      initial={initial}
      onClose={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      onBooked={({ appointment }) => {
        const target = { pathname: '/appointment/[id]' as const, params: { id: String(appointment.id) } };
        if (router.canGoBack()) { router.back(); router.push(target); } else router.replace(target);
      }}
    />
  );
}
