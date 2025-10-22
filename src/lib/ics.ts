function slugifyUid(uid: string): string {
    // Cut off anything after '@' (remove email domain part)
    uid = uid.split("@")[0];
  
    // Lowercase
    uid = uid.toLowerCase();
  
    // Replace dots with dashes
    uid = uid.replace(/\./g, "-");
  
    // Replace invalid chars with dashes (keep alnum, dash, underscore)
    uid = uid.replace(/[^a-z0-9-_]+/g, "-");
  
    // Collapse multiple dashes
    uid = uid.replace(/-+/g, "-");
  
    // Trim leading/trailing dashes
    uid = uid.replace(/^-|-$/g, "");
  
    return uid;
  }


// Unfold folded lines per RFC 5545 (continuation lines start with a single space)
export function unfold(lines: string[]): string[] {
    const out: string[] = [];
    for (const line of lines) {
        if (line.startsWith(' ') && out.length) {
            out[out.length - 1] += line.slice(1);
        } else {
            out.push(line);
        }
    }
    return out;
}

export type IcsEvent = {
    uid?: string;
    start?: Date;
    end?: Date;
    allDay?: boolean;
    summary?: string;
    location?: string;
    description?: string;
    url?: string;
};

export function parseIcsDate(value: string): { date: Date; allDay: boolean } | null {
    // All-day date: YYYYMMDD
    const allDayMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
    if (allDayMatch) {
        const [, y, m, d] = allDayMatch;
        // Create date at local midnight
        return { date: new Date(Number(y), Number(m) - 1, Number(d)), allDay: true };
    }
    // Date-time UTC: YYYYMMDDTHHMMSSZ
    const utcMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
    if (utcMatch) {
        const [, y, m, d, hh, mm, ss] = utcMatch;
        return {
            date: new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss))),
            allDay: false
        };
    }
    // Local date-time (no timezone): YYYYMMDDTHHMMSS
    const localMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(value);
    if (localMatch) {
        const [, y, m, d, hh, mm, ss] = localMatch;
        return {
            date: new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)),
            allDay: false
        };
    }
    return null;
}

export function parseIcs(text: string): IcsEvent[] {
    const lines = unfold(text.split(/\r?\n/));
    const events: IcsEvent[] = [];
    let current: IcsEvent | null = null;

    for (const raw of lines) {
        if (!raw) continue;
        if (raw === 'BEGIN:VEVENT') {
            current = {};
            continue;
        }
        if (raw === 'END:VEVENT') {
            if (current) events.push(current);
            current = null;
            continue;
        }
        if (!current) continue;

        const sep = raw.indexOf(':');
        if (sep === -1) continue;
        const nameAndParams = raw.slice(0, sep);
        const value = raw.slice(sep + 1);
        const [name, ...params] = nameAndParams.split(';');
        const NAME = name.toUpperCase();

        switch (NAME) {
            case 'UID':
                current.uid = slugifyUid(value);
                break;
            case 'SUMMARY':
                current.summary = value.replace(/\\n/g, '\n').replace(/\\,/g, ',');
                break;
            case 'LOCATION':
                current.location = value.replace(/\\n/g, '\n').replace(/\\,/g, ',');
                break;
            case 'DESCRIPTION':
                current.description = value.replace(/\\n/g, '\n').replace(/\\,/g, ',');
                break;
            case 'URL':
                current.url = value;
                break;
            case 'DTSTART':
            case 'DTEND': {
                // detect VALUE=DATE for all-day
                const isAllDay = params.some((p) => p.toUpperCase() === 'VALUE=DATE');
                const parsed = parseIcsDate(value);
                if (parsed) {
                    const d = parsed.date;
                    const allDay = isAllDay || parsed.allDay;
                    if (NAME === 'DTSTART') {
                        current.start = d;
                        current.allDay = allDay;
                    } else {
                        current.end = d;
                        // keep allDay flag if already set
                        current.allDay = current.allDay ?? allDay;
                    }
                }
                break;
            }
        }
    }

    return events;
}