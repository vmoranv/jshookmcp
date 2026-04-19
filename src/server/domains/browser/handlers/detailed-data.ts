import type { DetailedDataManager } from '@utils/DetailedDataManager';
import { argString } from '@server/domains/shared/parse-args';
import { R, type ToolResponse } from '@server/domains/shared/ResponseBuilder';

interface DetailedDataHandlersDeps {
  detailedDataManager: DetailedDataManager;
}

export class DetailedDataHandlers {
  constructor(private deps: DetailedDataHandlersDeps) {}

  async handleGetDetailedData(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const detailId = argString(args, 'detailId', '');
      const path = argString(args, 'path');

      const data = this.deps.detailedDataManager.retrieve(detailId, path);

      return R.ok().build({
        detailId,
        path: path || 'full',
        data,
      });
    } catch (error) {
      return R.fail(error)
        .set('hint', 'DetailId may have expired (TTL: 10 minutes) or is invalid')
        .build();
    }
  }
}
