import {Aktion} from "./aktionen-list";

function formatDateToICS(dateStr: string): string {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "";
    return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function escapeICS(str: string | undefined): string {
    if (!str) return "";
    return str
        .replace(/\\/g, "\\\\")
        .replace(/;/g, "\\;")
        .replace(/,/g, "\\,")
        .replace(/\n/g, "\\n");
}

export function buildIcs(aktionen: Aktion[], calendarName: string): string {
    let icsContent = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//DPSG Stamm Phoenix//DE",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        `X-WR-CALNAME:${calendarName}`,
        "X-WR-TIMEZONE:Europe/Berlin",
    ];

    const now = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

    for (const aktion of aktionen) {
        const start = formatDateToICS(aktion.start);
        const end = formatDateToICS(aktion.end);
        
        if (!start || !end) continue;

        icsContent.push("BEGIN:VEVENT");
        icsContent.push(`UID:${aktion.id}@dpsg-phoenix.de`);
        icsContent.push(`DTSTAMP:${now}`);
        icsContent.push(`DTSTART:${start}`);
        icsContent.push(`DTEND:${end}`);
        icsContent.push(`SUMMARY:${escapeICS(aktion.title)}`);
        
        if (aktion.campflow_link) {
            icsContent.push(`URL:${aktion.campflow_link}`);
        }
        
        icsContent.push("END:VEVENT");
    }

    icsContent.push("END:VCALENDAR");

    return icsContent.join("\r\n");
}
