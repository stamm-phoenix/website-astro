import { NIKOLAUS_SLOT_MINUTES, formatNikolausDate } from './nikolausConfig';
import { timeToMinutes } from './nikolausDispo';
import type { NikolausSettings } from './nikolausConfig';
export interface DayForm {
  /** Stable key for the list while dates are being edited. */
  key: number;
  date: string;
  start: string;
  end: string;
  teams: number;
}

export interface Form {
  publicActive: boolean;
  staffActive: boolean;
  maintenance: boolean;
  /** Bound to number inputs, which give a number, or `null` while empty. */
  pendingHoldMinutes: string | number | null;
  changeDeadlineHours: string | number | null;
  days: DayForm[];
  baseName: string;
  baseLat: string;
  baseLon: string;
  postalCodes: string;
  farDistanceKm: string;
  contactName: string;
  contactPhone: string;
}

/** Settings as text with a fixed order of keys, to tell whether the form was changed. */
export function canonical(s: NikolausSettings): string {
  return JSON.stringify([
    s.publicActive,
    s.staffActive,
    s.maintenance,
    s.pendingHoldMinutes,
    s.changeDeadlineHours,
    [...s.days]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((day) => [day.date, day.start, day.end, day.teams]),
    [s.area.base.name, s.area.base.lat, s.area.base.lon],
    s.area.servicePostalCodes,
    s.area.farDistanceKm,
    [s.dayContact?.name ?? '', s.dayContact?.phone ?? ''],
  ]);
}

export function toNumber(value: string | number | null): number {
  if (typeof value === 'number') return value;
  const text = (value ?? '').trim();
  return text === '' ? Number.NaN : Number(text.replace(',', '.'));
}

export function toSettings(f: Form): NikolausSettings {
  return {
    publicActive: f.publicActive,
    pendingHoldMinutes: toNumber(f.pendingHoldMinutes),
    changeDeadlineHours: toNumber(f.changeDeadlineHours),
    days: [...f.days]
      .map(({ date, start, end, teams }) => ({ date, start, end, teams }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    area: {
      base: { name: f.baseName.trim(), lat: toNumber(f.baseLat), lon: toNumber(f.baseLon) },
      servicePostalCodes: f.postalCodes
        .split(/[\s,;]+/)
        .map((code) => code.trim())
        .filter(Boolean),
      farDistanceKm: toNumber(f.farDistanceKm),
    },
    staffActive: f.staffActive,
    maintenance: f.maintenance,
    dayContact:
      f.contactName.trim() || f.contactPhone.trim()
        ? { name: f.contactName.trim(), phone: f.contactPhone.trim() }
        : null,
  };
}

export function slotCount(day: DayForm): number {
  const minutes = timeToMinutes(day.end) - timeToMinutes(day.start);
  return Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes / NIKOLAUS_SLOT_MINUTES) : 0;
}

export function formatDay(date: string | null): string {
  return date ? formatNikolausDate(date) : '–';
}
