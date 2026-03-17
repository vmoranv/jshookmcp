import type { DetailedDataManager } from '@utils/DetailedDataManager';
import { argString } from '@server/domains/shared/parse-args';

interface DetailedDataHandlersDeps {
  detailedDataManager: DetailedDataManager;
}

export class DetailedDataHandlers {
  constructor(private deps: DetailedDataHandlersDeps) {}

  async handleGetDetailedData(args: Record<string, unknown>) {
    try {
      const detailId = argString(args, 'detailId', '');
      const path = argString(args, 'path');

      const data = this.deps.detailedDataManager.retrieve(detailId, path);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                detailId,
                path: path || 'full',
                data,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                hint: 'DetailId may have expired (TTL: 10 minutes) or is invalid',
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }
}
