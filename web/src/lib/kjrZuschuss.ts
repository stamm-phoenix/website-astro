// The KJR grant rules are shared with the API. Edit them in api/lib/kjr-zuschuss.ts.
export {
  KJR_BETREUER_AGE,
  KJR_MAX_TEILNEHMENDE_PER_BETREUER,
  KJR_RATE_MULTI_DAY_CENT,
  KJR_RATE_SINGLE_DAY_CENT,
  betreuungsschluessel,
  countNights,
  kjrZuschuss,
} from '../../../api/lib/kjr-zuschuss';
export type {
  Betreuungsschluessel,
  KjrZuschuss,
  KjrZuschussInput,
} from '../../../api/lib/kjr-zuschuss';
