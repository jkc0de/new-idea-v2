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
  /** Rooms this service is limited to. Empty = any room. (Owner endpoints only.) */
  roomIds?: number[];
}

export interface Room { id: number; name: string; active: boolean; sort: number; serviceIds: number[] }

/** A scheduling problem, e.g. { code: 'outside_hours', message: "Outside Maya's working hours" }. */
export interface Issue { code: string; message: string }

export interface Hours { weekday: number; startMin: number; endMin: number }

export interface Therapist {
  id: number;
  name: string;
  bio: string;
  active: boolean;
  serviceIds: number[];
  hours?: Hours[];
  maxSessionsPerDay?: number | null;
  maxConsecutiveMin?: number | null;
  minBreakMin?: number;
}

export interface Override { date: string; note: string; blocks: { startMin: number; endMin: number }[] }

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
  roomId?: number | null;
  roomName?: string | null;
  createdAt?: string;
  updatedAt?: string | null;
  /** Present when a booked appointment no longer fits the therapist's schedule. */
  issues?: Issue[];
}

export interface AppointmentEvent {
  id: number;
  at: string; // UTC "YYYY-MM-DD HH:MM:SS"
  actor: 'client' | 'staff' | 'system';
  type: 'created' | 'rescheduled' | 'status' | 'notes';
  detail: any;
}

/** Per-therapist capacity for one day. Minutes are massage time. */
export interface DayInventory {
  date?: string;
  availableMin: number;
  bookedMin: number;
  freeMin: number;
  sessions: number;
  maxSessions: number | null;
  utilization: number; // 0..1
  working: boolean;
  overridden: boolean;
  hasTimeOff: boolean;
}

export interface Inventory {
  today: string;
  from: string;
  days: string[];
  therapists: { id: number; name: string; active: boolean; days: DayInventory[] }[];
  rooms: { id: number; name: string }[];
  totals: { date: string; availableMin: number; bookedMin: number; freeMin: number; sessions: number; utilization: number; rooms: { roomId: number; bookedMin: number }[] }[];
}

export interface ScheduleDay {
  date: string;
  today: string;
  therapists: {
    id: number; name: string; active: boolean;
    hours: { startMin: number; endMin: number }[];
    overridden: boolean;
    timeOff: { id: number; startMin: number; endMin: number; reason: string }[];
    maxSessionsPerDay: number | null;
    inventory: (DayInventory & { therapistId: number }) | null;
  }[];
  appointments: Appointment[];
  rooms: { id: number; name: string }[];
}

export interface Report {
  from: string; to: string;
  revenueCents: number; expectedCents: number;
  bookings: number; completed: number; cancelled: number; noShows: number; upcoming: number;
  noShowRate: number; cancellationRate: number; avgTicketCents: number;
  utilization: number; availableMin: number; bookedMin: number;
  clients: { total: number; new: number; returning: number };
  daily: { date: string; revenueCents: number; sessions: number; utilization: number }[];
  byTherapist: { id: number; name: string; sessions: number; completed: number; noShows: number; revenueCents: number; availableMin: number; bookedMin: number; utilization: number }[];
  byService: { id: number; name: string; count: number; revenueCents: number }[];
  byWeekday: { weekday: number; sessions: number }[];
  byHour: { hour: number; sessions: number }[];
}

export interface ClientStats {
  visits: number; spentCents: number; noShows: number; cancellations: number;
  firstVisit: string | null; lastVisit: string | null; avgGapDays: number | null;
  favoriteTherapist: { id: number; name: string; count: number } | null;
  favoriteService: { id: number; name: string; count: number } | null;
  rebook: { serviceId: number; therapistId: number; serviceName: string; therapistName: string } | null;
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
