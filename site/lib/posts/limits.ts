// The longest post body, in UTF-16 code units (String.length). The API schema, the forms, stored drafts and the server
// checks all use it. No imports, so client components can too.
export const MAX_BODY = 4000;

/** MAX_BODY as messages show it: 4,000. */
export const MAX_BODY_SHOWN = MAX_BODY.toLocaleString('en-US');
