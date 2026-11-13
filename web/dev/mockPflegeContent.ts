/** Pflege of Aktionen, Q&A, Gruppenstunden, Schnupperstunden, Postfach, Leitende and the blog. */
import { registerBlogRoutes } from './mockBlog';
import { registerAktionenRoutes } from './mockAktionen';
import { registerGruppenstundenRoutes } from './mockGruppenstunden';
import { registerSchnupperRoutes } from './mockSchnupper';
import { registerProtokollKorrekturRoutes } from './mockProtokollKorrektur';
import { registerPostfachRoutes } from './mockPostfach';
import { QA_CATEGORIES, questions } from './mock-data/content';
import { leitende, leitendePhotos, TEAMS } from './mock-data/people';
import { newEtag, newId } from './mock-data/util';
import { error, json, noContent, notFound, route, str, strings } from './mockCore';
import { PRINCIPAL } from './mockAuth';
import { blogImage } from './mockPublic';

// Pflege: FAQ, Gruppenstunden, Leitende, Downloads, Blog

registerAktionenRoutes(route);

route(['GET', 'POST'], '/api/intern/pflege/qa', (req) => {
  if (req.method === 'GET')
    return json({ items: questions, categories: QA_CATEGORIES, allowCustomCategories: true });
  const body = req.json ?? {};
  const id = newId();
  questions.push({
    id,
    etag: newEtag(`qa-${id}`),
    question: str(body.question),
    answer: str(body.answer),
    category: str(body.category, QA_CATEGORIES[0]),
    published: body.published === true,
  });
  return json({ id }, 201);
});

route(['PATCH', 'DELETE'], '/api/intern/pflege/qa/:id', (req) => {
  const index = questions.findIndex((q) => q.id === req.params.id);
  if (index < 0) return notFound();
  if (req.method === 'DELETE') {
    questions.splice(index, 1);
    return noContent();
  }
  const body = req.json ?? {};
  const q = questions[index];
  Object.assign(q, {
    question: str(body.question, q.question),
    answer: str(body.answer, q.answer),
    category: str(body.category, q.category),
    published: typeof body.published === 'boolean' ? body.published : q.published,
    etag: newEtag(`qa-${q.id}`),
  });
  return noContent();
});

// Stands in for Blob Storage: accepts the upload and forgets it
route('PUT', '/api/mock-upload/:id', () => ({ kind: 'empty', status: 201 }), true);

registerGruppenstundenRoutes(route);
registerSchnupperRoutes(route);
registerProtokollKorrekturRoutes(route);
registerPostfachRoutes(
  route,
  () => PRINCIPAL.userDetails,
  () => PRINCIPAL.userRoles
);

function applyLeitende(target: (typeof leitende)[number], body: Record<string, unknown>): void {
  target.name = str(body.name, target.name);
  target.teams = Array.isArray(body.teams) ? strings(body.teams) : target.teams;
  target.phone = str(body.phone, target.phone);
  target.street = str(body.street, target.street);
  target.postalCode = str(body.postalCode, target.postalCode);
  target.city = str(body.city, target.city);
  target.etag = newEtag(`leitende-${target.id}`);
}

route(['GET', 'POST'], '/api/intern/pflege/leitende', (req) => {
  if (req.method === 'GET') return json({ items: leitende, teams: TEAMS });
  const person = {
    id: newId(),
    etag: '',
    name: '',
    teams: [],
    phone: '',
    street: '',
    postalCode: '',
    city: '',
    hasImage: false,
  };
  applyLeitende(person, req.json ?? {});
  leitende.push(person);
  return json({ id: person.id }, 201);
});

route(['PATCH', 'DELETE'], '/api/intern/pflege/leitende/:id', (req) => {
  const index = leitende.findIndex((p) => p.id === req.params.id);
  if (index < 0) return notFound();
  if (req.method === 'DELETE') {
    leitende.splice(index, 1);
    return noContent();
  }
  applyLeitende(leitende[index], req.json ?? {});
  return noContent();
});

route(['PUT', 'DELETE'], '/api/intern/pflege/leitende/:id/foto', (req) => {
  const person = leitende.find((p) => p.id === req.params.id);
  if (!person) return notFound();
  if (req.method === 'DELETE') {
    leitendePhotos.delete(person.id);
    person.hasImage = false;
  } else {
    if (req.raw[0] !== 0xff || req.raw[1] !== 0xd8)
      return error(400, 'INVALID', 'Bitte ein Foto im JPEG-Format hochladen.');
    leitendePhotos.set(person.id, new Uint8Array(req.raw));
    person.hasImage = true;
  }
  person.etag = newEtag(`leitende-${person.id}`);
  return json({ hasImage: person.hasImage, etag: person.etag });
});

registerBlogRoutes(route, blogImage);
