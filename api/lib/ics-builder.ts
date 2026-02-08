import {Aktion} from "./aktionen-list";

function formatDateToICS(dateStr: string): string {
    return dateStr.replace(/-/g, "");
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
        if (!aktion.start || !aktion.end) continue;

        const start = formatDateToICS(aktion.start);
        
        // ICS all-day events: DTEND is exclusive (day after the last day)
        const endDate = new Date(aktion.end);
        endDate.setDate(endDate.getDate() + 1);
        const end = endDate.toISOString().split("T")[0].replace(/-/g, "");

        icsContent.push("BEGIN:VEVENT");
        icsContent.push(`UID:${aktion.id}@dpsg-phoenix.de`);
        icsContent.push(`DTSTAMP:${now}`);
        icsContent.push(`DTSTART;VALUE=DATE:${start}`);
        icsContent.push(`DTEND;VALUE=DATE:${end}`);
        icsContent.push(`SUMMARY:${escapeICS(aktion.title)}`);
        
        if (aktion.campflow_link) {
            icsContent.push(`URL:${aktion.campflow_link}`);
        }
        
        icsContent.push("END:VEVENT");
    }

    icsContent.push("END:VCALENDAR");

    return icsContent.join("\r\n");
}