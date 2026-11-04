import { SUPPORT_EMAIL } from '#lib/contact.ts';

export const Mail = () => <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>;
