/** Aktionen, blog, downloads, Instagram and FAQ of the mock API. */
import type {
  Aktion,
  BlogImage,
  BlogPost,
  BlogPostSummary,
  DownloadFile,
  InstagramPost,
  StaffBlogListItem,
  StaffBlogPost,
  StaffDownload,
  StaffQuestionAndAnswer,
} from '../../src/lib/types';
import { campflowEvents } from './campflow';
import {
  MOCK_NOW,
  AKTION_DATES,
  dayFromToday,
  isoFromNow,
  newEtag,
  plainText,
  plusDays,
} from './util';

// ---------------------------------------------------------------------------------------------
// Aktionen (SharePoint calendar)

/** A calendar entry as stored in SharePoint; `campflowId` links it to a CampFlow event. */
export interface MockAktion extends Aktion {
  campflowId?: string;
}

/** All Aktionen including the ones only for Leitende (hidden on the public site). */
export const aktionen: MockAktion[] = [
  {
    id: '201',
    stufen: ['Wölflinge', 'Jungpfadfinder', 'Pfadfinder', 'Rover'],
    title: 'Stammesversammlung mit Wahl des Vorstands',
    description:
      '<div class="ExternalClass9C1"><p>Alle Mitglieder ab den Pfadfindern sind stimmberechtigt. Eltern sind herzlich als Gäste eingeladen.</p><p><strong>Ort:</strong> Pfarrheim Feldkirchen</p></div>',
    start: AKTION_DATES.stavo,
    end: AKTION_DATES.stavo,
  },
  {
    id: '202',
    campflowId: 'evt_WoeHerbst',
    stufen: ['Wölflinge'],
    title: 'Wölflings-Herbstwochenende im Haus am Wendelstein',
    campflow_link: 'https://campflow.de/anmeldung/stamm-phoenix/woe-herbst',
    description:
      '<p>Zwei Tage voller Spiele, Lagerfeuer und Nachtwanderung. Für alle Wölflinge von 7 bis 10 Jahren.</p><ul><li>Anreise Freitag 17 Uhr</li><li>Abholung Sonntag 14 Uhr</li><li>Kosten: 45 € (Geschwister 35 €)</li></ul>',
    start: AKTION_DATES.woe,
    end: plusDays(AKTION_DATES.woe, 2),
  },
  {
    id: '203',
    stufen: ['Leitende'],
    title: 'Leiterrunde',
    description: '<p>Planung Nikolausdienst und Jahresprogramm 2027.</p>',
    start: AKTION_DATES.leiterrunde,
    end: AKTION_DATES.leiterrunde,
  },
  {
    id: '204',
    campflowId: 'evt_HikeMangfall',
    stufen: ['Jungpfadfinder', 'Pfadfinder'],
    title: 'Hike durchs Mangfalltal',
    campflow_link: 'https://campflow.de/anmeldung/stamm-phoenix/hike-mangfall',
    description:
      '<p>Mit Karte, Kompass und Rucksack von Feldkirchen bis Bad Aibling – Übernachtung im Zelt.</p>',
    start: AKTION_DATES.hike,
    end: plusDays(AKTION_DATES.hike, 1),
  },
  {
    id: '205',
    stufen: ['Rover'],
    title: 'Roverrunde: Kochabend',
    start: AKTION_DATES.kochabend,
    end: AKTION_DATES.kochabend,
  },
  {
    id: '206',
    stufen: ['Wölflinge', 'Jungpfadfinder', 'Pfadfinder', 'Rover'],
    title: 'Friedenslicht aus Betlehem – Aussendungsfeier',
    description:
      '<p>Wir holen das Friedenslicht gemeinsam in München ab und verteilen es anschließend in der Pfarrkirche St. Laurentius. Bitte Kluft und eine Laterne mitbringen.</p>',
    start: AKTION_DATES.friedenslicht,
    end: AKTION_DATES.friedenslicht,
  },
  {
    id: '207',
    campflowId: 'evt_PfadiWinter',
    stufen: ['Pfadfinder'],
    title: 'Pfadi-Winterlager auf der Hütte',
    campflow_link: 'https://campflow.de/anmeldung/stamm-phoenix/pfadi-winter',
    description:
      '<p>Schneeschuhwandern, Iglu bauen und gemütliche Abende am Kachelofen. Plätze sind begrenzt (max. 20 Teilnehmende).</p>',
    start: AKTION_DATES.winter,
    end: plusDays(AKTION_DATES.winter, 3),
  },
  {
    id: '208',
    stufen: ['Wölflinge', 'Jungpfadfinder'],
    title: 'Faschingsgruppenstunde',
    description: '',
    start: AKTION_DATES.fasching,
    end: AKTION_DATES.fasching,
  },
  {
    id: '209',
    stufen: ['Wölflinge', 'Jungpfadfinder', 'Pfadfinder', 'Rover'],
    title: 'Georgsfest des Bezirks Rosenheim',
    campflow_link: 'https://campflow.de/anmeldung/stamm-phoenix/georgsfest',
    description:
      '<p>Zum Georgstag treffen sich alle Stämme des Bezirks zu einem großen Fest mit Gottesdienst, Stationenlauf und Grillen. Gemeinsame Anreise mit dem Zug ab Bahnhof Westerham.</p>',
    start: AKTION_DATES.georg,
    end: AKTION_DATES.georg,
  },
  {
    id: '210',
    stufen: ['Wölflinge', 'Jungpfadfinder', 'Pfadfinder', 'Rover'],
    title: 'Pfingstlager 2027 am Chiemsee',
    campflow_link: 'https://campflow.de/anmeldung/stamm-phoenix/pfingstlager-2027',
    description:
      '<p>Unser großes Stammeslager! Eine Woche Zeltlager mit allen Stufen, Lagerfeuer, Baden im See und einem großen Geländespiel.</p><p>Infos zur Packliste folgen per Mail.</p>',
    start: AKTION_DATES.pfingst,
    end: plusDays(AKTION_DATES.pfingst, 6),
  },
];

/** Calendar entries as the API returns them: linked entries show the CampFlow data live. */
export function calendarAktionen(): Aktion[] {
  return aktionen.map(({ campflowId, ...aktion }) => {
    const event = campflowEvents.find((e) => e.id === campflowId);
    if (!event?.start_date) return aktion;
    return {
      ...aktion,
      title: event.title,
      start: event.start_date,
      end: event.end_date ?? event.start_date,
      campflow_link: event.url ?? undefined,
    };
  });
}

export function publicAktionen(): Aktion[] {
  return calendarAktionen().filter((a) => !(a.stufen.length === 1 && a.stufen[0] === 'Leitende'));
}

function icsEscape(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function icsDate(date: string, plusDays = 0): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + plusDays);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

/** iCalendar file with all-day events, like `api/lib/ics-builder.ts` (plus descriptions). */
export function buildIcs(list: Aktion[], calendarName: string): string {
  const stamp = new Date(MOCK_NOW).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DPSG Stamm Phoenix//Mock API//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${calendarName}`,
    'X-WR-TIMEZONE:Europe/Berlin',
  ];
  for (const aktion of list) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${aktion.id}@dpsg-phoenix.de`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(aktion.start)}`,
      `DTEND;VALUE=DATE:${icsDate(aktion.end, 1)}`,
      `SUMMARY:${icsEscape(aktion.title)}`,
      `CATEGORIES:${aktion.stufen.map(icsEscape).join(',')}`
    );
    const description = plainText(aktion.description ?? '');
    if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
    if (aktion.campflow_link) lines.push(`URL:${aktion.campflow_link}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------------------------
// Blog

export interface MockBlogEntry {
  id: string;
  etag: string;
  title: string;
  date: string;
  published: boolean;
  /** Canonical HTML with `<img data-bild="…">` placeholders. */
  content: string;
  images: BlogImage[];
}

const BLOG_IMAGE_WIDTHS = [800, 1600];

export const blogEntries: MockBlogEntry[] = [
  {
    id: '14',
    etag: newEtag('blog-14'),
    title: 'Sommerlager 2026: Zehn Tage Abenteuer im Allgäu',
    date: dayFromToday(-9),
    published: true,
    images: [
      {
        file: 'bild-1001.jpg',
        alt: 'Zeltplatz mit Bergen im Hintergrund',
        width: 1600,
        height: 1067,
      },
      { file: 'bild-1002.jpg', alt: 'Kinder beim Lagerfeuer', width: 1600, height: 1067 },
      { file: 'bild-1003.jpg', alt: 'Wanderung über eine Almwiese', width: 1200, height: 1600 },
    ],
    content:
      '<p>Was für ein Lager! Mit 64 Kindern, Jugendlichen und Leitenden waren wir zehn Tage lang auf dem Zeltplatz in Oberjoch.</p><h2>Aufbau im Regen</h2><p>Der erste Tag hatte es in sich: Kaum waren die Jurten ausgepackt, öffnete der Himmel seine Schleusen. Doch mit vereinten Kräften stand das Lager am Abend – und die Sonne kam pünktlich zum ersten <strong>Lagerfeuer</strong> zurück.</p><img data-bild="bild-1002.jpg"><h2>Highlights</h2><ul><li>Zweitägiger Hike der Pfadis über den Iseler</li><li>Wölflings-Olympiade mit Gummistiefelweitwurf</li><li>Versprechensfeier unter Sternenhimmel</li></ul><img data-bild="bild-1003.jpg"><p>Ein riesiges Dankeschön an das Küchenteam, das uns täglich dreimal satt bekommen hat! Mehr Fotos gibt es auf <a href="https://www.instagram.com/stamm_phoenix">Instagram</a>.</p>',
  },
  {
    id: '13',
    etag: newEtag('blog-13'),
    title: 'Neue Leiterinnen und Leiter für die Wölflinge',
    date: dayFromToday(-24),
    published: true,
    images: [
      {
        file: 'bild-1301.jpg',
        alt: 'Gruppenfoto des neuen Leitungsteams',
        width: 1600,
        height: 900,
      },
    ],
    content:
      '<p>Wir freuen uns sehr: Lena, Jonas und Sophie übernehmen ab diesem Herbst gemeinsam die Wölflingsmeute. Alle drei waren selbst lange Pfadis in unserem Stamm und haben im Sommer ihre Modulausbildung abgeschlossen.</p><p>Die Gruppenstunde findet weiterhin <em>freitags um 16 Uhr</em> im Pfarrheim statt.</p>',
  },
  {
    id: '11',
    etag: newEtag('blog-11'),
    title: 'Altkleidersammlung: Danke für 4,2 Tonnen!',
    date: dayFromToday(-51),
    published: true,
    images: [],
    content:
      '<p>Bei unserer Altkleidersammlung im Frühjahr sind unglaubliche 4,2 Tonnen Kleidung zusammengekommen. Der Erlös geht vollständig in die Zuschüsse für unsere Lager, damit alle Kinder mitfahren können – unabhängig vom Geldbeutel der Eltern.</p><p>Ein großer Dank geht an alle Spenderinnen und Spender, an den Bauhof Feldkirchen-Westerham für den Lkw und an alle Helferinnen und Helfer, die bei strömendem Regen die Säcke geschleppt haben.</p><p>Die nächste Sammlung findet im Herbst statt. Den Termin findet ihr wie immer im Kalender.</p>',
  },
  {
    id: '9',
    etag: newEtag('blog-9'),
    title: 'Jupfis bauen ein Floß',
    date: dayFromToday(-80),
    published: true,
    images: [
      {
        file: 'bild-901.jpg',
        alt: 'Selbstgebautes Floß auf dem Weiher',
        width: 1600,
        height: 1067,
      },
      { file: 'bild-902.jpg', alt: 'Jungpfadfinder beim Knoten', width: 1600, height: 1067 },
    ],
    content:
      '<p>Aus Fässern, Rundhölzern und viel Seil haben unsere Jungpfadfinder an einem Wochenende ein schwimmfähiges Floß gebaut. Die Jungfernfahrt auf dem Weiher war ein voller Erfolg – nur zwei Leiter sind nass geworden.</p><img data-bild="bild-902.jpg">',
  },
  {
    id: '6',
    etag: newEtag('blog-6'),
    title: 'Kurz notiert: Hütte frisch gestrichen',
    date: dayFromToday(-130),
    published: true,
    images: [],
    content:
      '<p>Die Roverrunde hat an zwei Samstagen unsere Hütte in Westerham neu gestrichen. Danke!</p>',
  },
  {
    id: '3',
    etag: newEtag('blog-3'),
    title: 'Entwurf: Rückblick Nikolausdienst',
    date: dayFromToday(-2),
    published: false,
    images: [{ file: 'bild-301.jpg', alt: '', width: 1600, height: 1067 }],
    content:
      '<p>Noch in Arbeit – hier kommt der Rückblick auf den Nikolausdienst hin.</p><img data-bild="bild-301.jpg">',
  },
];

/** Uploaded blog images (JPEG bytes) by `postId/file`; others are drawn as SVG. */
export const blogUploads = new Map<string, Uint8Array>();

function publicImageUrl(postId: string, file: string, width: number): string {
  return `/api/blog/${postId}/bilder/${file}?w=${width}`;
}

function escapeAttribute(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function renderContent(entry: MockBlogEntry): string {
  const byFile = new Map(entry.images.map((image) => [image.file, image]));
  return entry.content.replace(/<img data-bild="([^"]+)">/g, (_match, file: string) => {
    const image = byFile.get(file);
    if (!image) return '';
    const widths = [...new Set(BLOG_IMAGE_WIDTHS.map((w) => Math.min(w, image.width)))];
    const srcset = widths.map((w) => `${publicImageUrl(entry.id, file, w)} ${w}w`).join(', ');
    const src = publicImageUrl(entry.id, file, widths[widths.length - 1]);
    return (
      `<img src="${src}" srcset="${srcset}" sizes="(min-width: 768px) 720px, 100vw"` +
      ` alt="${escapeAttribute(image.alt)}" width="${image.width}" height="${image.height}"` +
      ` loading="lazy" decoding="async">`
    );
  });
}

function excerpt(content: string, maxLength: number): string {
  const text = plainText(content);
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : maxLength)} …`;
}

function toSummary(entry: MockBlogEntry): BlogPostSummary {
  const cover = entry.images[0];
  const words = plainText(entry.content).split(' ').filter(Boolean).length;
  return {
    id: entry.id,
    title: entry.title,
    date: entry.date,
    excerpt: excerpt(entry.content, cover ? 200 : 600),
    readingMinutes: Math.max(1, Math.round(words / 200)),
    cover: cover
      ? {
          url: publicImageUrl(entry.id, cover.file, Math.min(1600, cover.width)),
          alt: cover.alt,
          width: cover.width,
          height: cover.height,
        }
      : undefined,
  };
}

function sortedEntries(): MockBlogEntry[] {
  return [...blogEntries].sort(
    (a, b) => b.date.localeCompare(a.date) || Number(b.id) - Number(a.id)
  );
}

export function publicBlogList(): BlogPostSummary[] {
  return sortedEntries()
    .filter((e) => e.published)
    .map(toSummary);
}

export function publicBlogPost(id: string): BlogPost | undefined {
  const entry = blogEntries.find((e) => e.id === id && e.published);
  return entry ? { ...toSummary(entry), content: renderContent(entry) } : undefined;
}

export function staffBlogList(): StaffBlogListItem[] {
  return sortedEntries().map((e) => ({
    id: e.id,
    title: e.title,
    date: e.date,
    published: e.published,
    cover: e.images[0] ?? null,
    imageCount: e.images.length,
    textLength: plainText(e.content).length,
  }));
}

export function staffBlogPost(entry: MockBlogEntry): StaffBlogPost {
  return {
    id: entry.id,
    etag: entry.etag,
    title: entry.title,
    date: entry.date,
    published: entry.published,
    content: entry.content,
    images: entry.images,
  };
}

// ---------------------------------------------------------------------------------------------
// Downloads

export interface MockDownload extends DownloadFile {
  hasPreview: boolean;
}

function download(
  id: string,
  fileName: string,
  size: number,
  mimeType: string,
  daysAgo: number,
  by: string,
  hasPreview: boolean
): MockDownload {
  const created = isoFromNow(-daysAgo - 30);
  return {
    id,
    fileName,
    size,
    mimeType,
    createdAt: created,
    createdBy: by,
    lastModifiedAt: isoFromNow(-daysAgo),
    lastModifiedBy: by,
    hasPreview,
  };
}

export const downloads: MockDownload[] = [
  download(
    '01MOCKANMELDUNG',
    'Mitgliedsantrag DPSG.pdf',
    284_311,
    'application/pdf',
    40,
    'Katharina Huber',
    true
  ),
  download(
    '01MOCKPACKLISTE',
    'Packliste Sommerlager.pdf',
    96_120,
    'application/pdf',
    3,
    'Theresa Lechner',
    true
  ),
  download(
    '01MOCKEINVERST',
    'Einverständniserklärung Fotos und Veröffentlichungen 2026.docx',
    41_872,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    120,
    'Maximilian Gruber',
    true
  ),
  download(
    '01MOCKGESUND',
    'Gesundheitsbogen.pdf',
    158_004,
    'application/pdf',
    200,
    'Katharina Huber',
    true
  ),
  download(
    '01MOCKBEITRAG',
    'Beitragsordnung.xlsx',
    18_560,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    300,
    'Magdalena Strasser',
    true
  ),
  download(
    '01MOCKKLUFT',
    'Kluftordnung Aufnäher.jpg',
    1_482_993,
    'image/jpeg',
    15,
    'Anna-Lena Schwaiger',
    true
  ),
  download(
    '01MOCKLIEDER',
    'Liederbuch Stamm Phoenix.zip',
    23_811_002,
    'application/zip',
    410,
    'Unbekannt',
    false
  ),
];

export function publicDownloads(): DownloadFile[] {
  return downloads.map((d) => ({
    id: d.id,
    fileName: d.fileName,
    size: d.size,
    mimeType: d.mimeType,
    createdAt: d.createdAt,
    createdBy: d.createdBy,
    lastModifiedAt: d.lastModifiedAt,
    lastModifiedBy: d.lastModifiedBy,
  }));
}

export function staffDownloads(): StaffDownload[] {
  return downloads.map((d) => ({
    id: d.id,
    fileName: d.fileName,
    size: d.size,
    mimeType: d.mimeType,
    lastModifiedAt: d.lastModifiedAt,
    lastModifiedBy: d.lastModifiedBy,
    hasPreview: d.hasPreview,
  }));
}

/** A minimal valid one-page PDF showing the file name. */
export function minimalPdf(title: string): string {
  const text = title.replace(/[()\\]/g, '').replace(/[^\x20-\x7e]/g, '?');
  const stream = `BT /F1 18 Tf 72 760 Td (${text}) Tj ET BT /F1 11 Tf 72 730 Td (Testdatei der Mock-API von Stamm Phoenix) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

// ---------------------------------------------------------------------------------------------
// Instagram

export const instagramPosts: InstagramPost[] = [
  {
    id: '18011',
    caption:
      'Sommerlager 2026 ☀️⛺ Zehn Tage, 64 Leute, unzählige Erinnerungen. Danke an alle, die dabei waren! #dpsg #pfadfinden #sommerlager',
    mediaType: 'CAROUSEL_ALBUM',
    permalink: 'https://www.instagram.com/p/MOCK18011/',
    timestamp: isoFromNow(-6),
    imageCount: 5,
    hasVideo: false,
  },
  {
    id: '18012',
    caption: 'Neue Gruppenstunde, neue Gesichter 🧡 Die Wölflinge starten ins Pfadfinderjahr.',
    mediaType: 'IMAGE',
    permalink: 'https://www.instagram.com/p/MOCK18012/',
    timestamp: isoFromNow(-15),
    imageCount: 1,
    hasVideo: false,
  },
  {
    id: '18013',
    caption: 'Floßbau mit den Jupfis 🛶 Ob es schwimmt? Swipe! 👉',
    mediaType: 'CAROUSEL_ALBUM',
    permalink: 'https://www.instagram.com/p/MOCK18013/',
    timestamp: isoFromNow(-33),
    imageCount: 3,
    hasVideo: false,
  },
  {
    id: '18014',
    caption: 'Timelapse vom Jurtenaufbau 🎥',
    mediaType: 'VIDEO',
    permalink: 'https://www.instagram.com/reel/MOCK18014/',
    timestamp: isoFromNow(-44),
    imageCount: 1,
    hasVideo: true,
  },
  {
    id: '18015',
    mediaType: 'IMAGE',
    permalink: 'https://www.instagram.com/p/MOCK18015/',
    timestamp: isoFromNow(-60),
    imageCount: 1,
    hasVideo: false,
  },
  {
    id: '18016',
    caption: 'Reel mit Musik – auf der Website nicht abspielbar 🎶',
    mediaType: 'VIDEO',
    permalink: 'https://www.instagram.com/reel/MOCK18016/',
    timestamp: isoFromNow(-75),
    imageCount: 1,
    hasVideo: false,
  },
  {
    id: '18017',
    caption:
      'Altkleidersammlung: 4,2 Tonnen! 💪 Ein riesiges Dankeschön an alle Spenderinnen und Spender in Feldkirchen-Westerham und Umgebung. Der Erlös fließt komplett in Lagerzuschüsse, damit alle mitfahren können.',
    mediaType: 'IMAGE',
    permalink: 'https://www.instagram.com/p/MOCK18017/',
    timestamp: isoFromNow(-95),
    imageCount: 1,
    hasVideo: false,
  },
];

// ---------------------------------------------------------------------------------------------
// Fragen und Antworten

export const QA_CATEGORIES = ['Allgemeines', 'Gruppenstunden', 'Lager und Fahrten', 'Kosten'];

export const questions: StaffQuestionAndAnswer[] = [
  {
    id: '1',
    question: 'Ab welchem Alter kann mein Kind mitmachen?',
    answer:
      '<p>Bei uns können Kinder ab <strong>7 Jahren</strong> bei den Wölflingen einsteigen. Ein Einstieg ist aber in jedem Alter möglich.</p>',
    category: 'Allgemeines',
    published: true,
    etag: newEtag('qa-1'),
  },
  {
    id: '2',
    question: 'Muss mein Kind katholisch sein?',
    answer:
      '<p>Nein. Die DPSG ist ein katholischer Verband, aber bei uns ist jede und jeder willkommen – unabhängig von Religion oder Herkunft.</p>',
    category: 'Allgemeines',
    published: true,
    etag: newEtag('qa-2'),
  },
  {
    id: '3',
    question: 'Kann mein Kind erst einmal unverbindlich schnuppern?',
    answer:
      '<p>Ja, sehr gerne! Kommt einfach zu einer Gruppenstunde vorbei. Die ersten drei Wochen sind ein Schnupperzeitraum, erst danach wird eine Mitgliedschaft fällig.</p>',
    category: 'Gruppenstunden',
    published: true,
    etag: newEtag('qa-3'),
  },
  {
    id: '4',
    question: 'Was passiert in den Schulferien?',
    answer: '<p>In den bayerischen Schulferien finden keine Gruppenstunden statt.</p>',
    category: 'Gruppenstunden',
    published: true,
    etag: newEtag('qa-4'),
  },
  {
    id: '5',
    question: 'Was muss mein Kind zum Lager mitnehmen?',
    answer:
      '<p>Vor jedem Lager verschicken wir eine Packliste. Die wichtigsten Dinge sind:</p><ul><li>Schlafsack und Isomatte</li><li>Feste Schuhe und Regenkleidung</li><li>Kluft und Halstuch</li><li>Taschenlampe</li></ul><p>Die aktuelle Packliste findest du auch im Downloadbereich.</p>',
    category: 'Lager und Fahrten',
    published: true,
    etag: newEtag('qa-5'),
  },
  {
    id: '6',
    question: 'Wer betreut die Kinder auf den Lagern?',
    answer:
      '<p>Alle unsere Leitenden sind ehrenamtlich tätig, haben eine Präventionsschulung absolviert, ein erweitertes Führungszeugnis vorgelegt und sind in Erster Hilfe ausgebildet. Auf jedem Lager ist außerdem eine erfahrene Lagerleitung dabei, die die Verantwortung trägt und für Eltern jederzeit erreichbar ist.</p>',
    category: 'Lager und Fahrten',
    published: true,
    etag: newEtag('qa-6'),
  },
  {
    id: '7',
    question: 'Wie hoch ist der Mitgliedsbeitrag?',
    answer:
      '<p>Der Jahresbeitrag beträgt derzeit 72 € für das erste Kind und 60 € für jedes weitere Geschwisterkind.</p>',
    category: 'Kosten',
    published: true,
    etag: newEtag('qa-7'),
  },
  {
    id: '8',
    question: 'Gibt es Zuschüsse, wenn wir uns ein Lager nicht leisten können?',
    answer:
      '<p>Ja. Sprecht uns einfach vertraulich an – kein Kind soll aus finanziellen Gründen zu Hause bleiben.</p>',
    category: 'Kosten',
    published: true,
    etag: newEtag('qa-8'),
  },
  {
    id: '9',
    question: 'Wo bekomme ich eine Kluft?',
    answer: '<p>Über unsere Sammelbestellung beim Rüsthaus – Infos kommen per Mail.</p>',
    category: 'Kosten',
    published: false,
    etag: newEtag('qa-9'),
  },
];
