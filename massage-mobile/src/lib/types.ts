export type Status = 'booked' | 'completed' | 'cancelled' | 'no_show';

export interface Business {
  id?: number;
  name: string;
  slug: string;
  email?: string;
  phone: string;
  address: string;
  timezone: string;
  currency: string;
  leadTimeMin: number;
  bookingWindowDays: number;
  cancelCutoffHours: number;
  slotStepMin?: number;
}

export interface Service {
  id: number;
  name: string;
  description: string;
  durationMin: number;
  priceCents: number;
  bufferMin: number;
  active: boolean;
}

export interface Hours { weekday: number; startMin: number; endMin: number }

export interface Therapist {
  id: number;
  name: string;
  bio: string;
  active: boolean;
  serviceIds: number[];
  hours?: Hours[];
}

export interface Appointment {
  id: number;
  ref: string;
  date: string;
  startMin: number;
  endMin: number;
  status: Status;
  priceCents: number;
  therapistId: number;
  therapistName: string;
  serviceId: number;
  serviceName: string;
  clientNotes: string;
  clientName: string;
  clientId?: number;
  clientEmail?: string;
  clientPhone?: string;
  internalNotes?: string;
  source?: 'online' | 'staff';
}

export interface Client {
  id: number;
  name: string;
  email: string;
  phone: string;
  notes: string;
  visits?: number;
  lastVisit?: string | null;
}

export interface Slot { startMin: number; therapistIds: number[] }

export interface Stats {
  today: string;
  todayCount: number;
  next7Count: number;
  next7RevenueCents: number;
  last30RevenueCents: number;
  clientCount: number;
}
