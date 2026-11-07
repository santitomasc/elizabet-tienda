import {backupRuntime} from '../../lib/runtime.mjs';
import {safe} from '../../lib/shop.mjs';
export default request => safe(() => backupRuntime()(request));
export const config = {path:'/api/backup/*'};
