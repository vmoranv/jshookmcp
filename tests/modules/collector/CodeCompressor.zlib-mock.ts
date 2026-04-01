import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';

export const gzipAsync = promisify(gzip);
export const gunzipAsync = promisify(gunzip);
