// The support address as a link, or the owner's placeholder until there is one (lib/contact.ts).
import { SUPPORT, SUPPORT_EMAIL } from '../lib/contact.ts';

export const Mail = () => (SUPPORT_EMAIL ? <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> : <b>{SUPPORT}</b>);
