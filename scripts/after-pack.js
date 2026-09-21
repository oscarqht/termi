import { execSync } from 'node:child_process';
import path from 'node:path';

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  console.log(`[afterPack] Applying clean ad-hoc codesign to ${appPath}...`);
  try {
    execSync(`codesign --force --deep -s - "${appPath}"`, { stdio: 'inherit' });
    console.log('[afterPack] Ad-hoc codesign applied successfully!');
  } catch (err) {
    console.warn('[afterPack] Warning: codesign failed:', err.message);
  }
}
