// POST /api/v1/records/<prefix>/<suffix>/source-checks {"urls": [...]}: check up to five public sources (checkPublicSources).
import { sourceCheckOperation } from '../../../../../../../lib/moderation/source-check-api.ts';
export const POST = sourceCheckOperation();
