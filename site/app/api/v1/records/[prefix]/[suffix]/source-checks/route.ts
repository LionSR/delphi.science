// POST /api/v1/records/<prefix>/<suffix>/source-checks {"urls": [...]}: check up to five public sources (checkPublicSources).
import { sourceCheckOperation } from '../../../../../../../lib/api/source-check-operation.ts';
export const POST = sourceCheckOperation();
