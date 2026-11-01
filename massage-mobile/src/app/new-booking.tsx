import { router, useLocalSearchParams } from 'expo-router';

import { BookingFlow } from '@/components/booking-flow';
import { useAuth } from '@/lib/auth';

/** Staff booking for phone calls and walk-ins. */
export default function NewBooking() {
  const { business } = useAuth();
  const p = useLocalSearchParams<{ clientName?: string; clientEmail?: string; clientPhone?: string }>();
  if (!business) return null;
  return (
    <BookingFlow
      slug={business.slug}
      mode="staff"
      initialClient={{ name: p.clientName, email: p.clientEmail, phone: p.clientPhone }}
      onClose={() => router.back()}
      onBooked={({ appointment }) => {
        router.back();
        router.push({ pathname: '/appointment/[id]', params: { id: String(appointment.id) } });
      }}
    />
  );
}
