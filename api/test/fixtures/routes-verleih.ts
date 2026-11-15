import type { RegisteredRoute } from './routes';

export const VERLEIH_ROUTES: RegisteredRoute[] = [
  {
    name: 'internPflegeVerleih',
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    route: 'intern/pflege/verleih',
  },
  {
    name: 'internPflegeVerleihItem',
    methods: ['PATCH', 'POST'],
    authLevel: 'anonymous',
    route: 'intern/pflege/verleih/{id:int}',
  },
  {
    name: 'internPflegeVerleihVersand',
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'intern/pflege/verleih/{id:int}/versand',
  },
  {
    name: 'internPflegeVerleihEinstellung',
    methods: ['GET', 'PATCH'],
    authLevel: 'anonymous',
    route: 'intern/pflege/verleih/einstellung',
  },
];
