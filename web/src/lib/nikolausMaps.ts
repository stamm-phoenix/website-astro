import { NIKOLAUS_SLOT_MINUTES } from './nikolausConfig';
import { minutesToTime, timeToMinutes } from './nikolausDispo';
import type { StaffNikolausBooking } from './types';
const MAPS_MAX_WAYPOINTS = 9;

export function mapsPoint(
  booking: Pick<StaffNikolausBooking, 'location' | 'street' | 'postalCode' | 'city'>
): string {
  return booking.location && !booking.location.approximate
    ? `${booking.location.lat},${booking.location.lon}`
    : `${booking.street}, ${booking.postalCode} ${booking.city}`;
}

/** Google Maps links for a route, split into parts if it has too many stops. */
export function mapsLinks(
  ids: string[],
  base: { lat: number; lon: number },
  stopsById: ReadonlyMap<string, StaffNikolausBooking>
): string[] {
  const home = `${base.lat},${base.lon}`;
  const points = [
    home,
    ...ids.flatMap((id) => {
      const booking = stopsById.get(id);
      return booking ? [mapsPoint(booking)] : [];
    }),
    home,
  ];
  const links: string[] = [];
  for (let start = 0; start < points.length - 1; start += MAPS_MAX_WAYPOINTS + 1) {
    const part = points.slice(start, start + MAPS_MAX_WAYPOINTS + 2);
    const params: Record<string, string> = {
      api: '1',
      origin: part[0],
      destination: part[part.length - 1],
      travelmode: 'driving',
    };
    if (part.length > 2) params.waypoints = part.slice(1, -1).join('|');
    const query = Object.entries(params)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');
    links.push(`https://www.google.com/maps/dir/?${query}`);
  }
  return links;
}

export function slotLabel(slotKey: string): string {
  const time = slotKey.split('T')[1] ?? '';
  return time ? `${time}–${minutesToTime(timeToMinutes(time) + NIKOLAUS_SLOT_MINUTES)}` : '';
}

/** Google Maps navigation from the current position to the given destination. */
export function navigationLink(destination: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}
