import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const tagArg = args.find((a) => !a.startsWith('--'));

if (!tagArg) {
  console.error('Usage: node scripts/generate-updater-json.js <tag> [--dry-run]');
  process.exit(1);
}

const tag = tagArg.trim();
const version = tag.replace(/^v/, '');

console.log(`Generating updater JSON for release ${tag} (version ${version})...`);

// 1. Fetch release info and repo name
const repo =
  process.env.GITHUB_REPOSITORY ||
  execSync('gh repo view --json nameWithOwner -q .nameWithOwner', {
    encoding: 'utf8',
  }).trim();

const releaseJson = execSync(`gh release view "${tag}" --json assets,body`, {
  encoding: 'utf8',
});
const releaseData = JSON.parse(releaseJson);
const assets = releaseData.assets || [];

const assetNames = new Set(assets.map((a) => a.name));
console.log(`Found ${assets.length} assets on release ${tag}:`, Array.from(assetNames));

// 2. Identify .sig files and corresponding bundle archives
const sigFiles = assets.filter((a) => a.name.endsWith('.sig'));
if (sigFiles.length === 0) {
  console.warn('No signature (.sig) files found on the release.');
  process.exit(0);
}

const platforms = {};

for (const sigAsset of sigFiles) {
  const sigName = sigAsset.name;
  const targetAssetName = sigName.slice(0, -4); // Remove .sig

  if (!assetNames.has(targetAssetName)) {
    console.warn(`Target asset ${targetAssetName} for signature ${sigName} not found on release, skipping...`);
    continue;
  }

  // Download signature content
  const signature = execSync(`gh release download "${tag}" -p "${sigName}" -O -`, {
    encoding: 'utf8',
  }).trim();

  const downloadUrl = `https://github.com/${repo}/releases/download/${tag}/${targetAssetName}`;

  // Match platform according to Tauri v2 conventions
  // macOS .app.tar.gz
  if (targetAssetName.endsWith('.app.tar.gz')) {
    if (targetAssetName.includes('aarch64') || targetAssetName.includes('arm64')) {
      platforms['darwin-aarch64'] = { signature, url: downloadUrl };
      platforms['darwin-aarch64-app'] = { signature, url: downloadUrl };
    } else if (targetAssetName.includes('x86_64') || targetAssetName.includes('x64')) {
      platforms['darwin-x86_64'] = { signature, url: downloadUrl };
      platforms['darwin-x86_64-app'] = { signature, url: downloadUrl };
    } else if (targetAssetName.includes('universal')) {
      platforms['darwin-universal'] = { signature, url: downloadUrl };
      platforms['darwin-universal-app'] = { signature, url: downloadUrl };
      if (!platforms['darwin-aarch64']) {
        platforms['darwin-aarch64'] = { signature, url: downloadUrl };
        platforms['darwin-aarch64-app'] = { signature, url: downloadUrl };
      }
      if (!platforms['darwin-x86_64']) {
        platforms['darwin-x86_64'] = { signature, url: downloadUrl };
        platforms['darwin-x86_64-app'] = { signature, url: downloadUrl };
      }
    }
  }

  // Windows NSIS (setup.exe)
  if (targetAssetName.endsWith('-setup.exe') || targetAssetName.endsWith('.nsis.zip')) {
    if (targetAssetName.includes('x64') || targetAssetName.includes('x86_64')) {
      platforms['windows-x86_64'] = { signature, url: downloadUrl };
      platforms['windows-x86_64-nsis'] = { signature, url: downloadUrl };
    } else if (targetAssetName.includes('x86') || targetAssetName.includes('i686')) {
      platforms['windows-i686'] = { signature, url: downloadUrl };
      platforms['windows-i686-nsis'] = { signature, url: downloadUrl };
    } else if (targetAssetName.includes('arm64') || targetAssetName.includes('aarch64')) {
      platforms['windows-aarch64'] = { signature, url: downloadUrl };
      platforms['windows-aarch64-nsis'] = { signature, url: downloadUrl };
    }
  }

  // Windows MSI (.msi)
  if (targetAssetName.endsWith('.msi') || targetAssetName.endsWith('.msi.zip')) {
    if (targetAssetName.includes('x64') || targetAssetName.includes('x86_64')) {
      platforms['windows-x86_64-msi'] = { signature, url: downloadUrl };
    } else if (targetAssetName.includes('x86') || targetAssetName.includes('i686')) {
      platforms['windows-i686-msi'] = { signature, url: downloadUrl };
    } else if (targetAssetName.includes('arm64') || targetAssetName.includes('aarch64')) {
      platforms['windows-aarch64-msi'] = { signature, url: downloadUrl };
    }
  }

  // Linux AppImage (.AppImage.tar.gz)
  if (targetAssetName.endsWith('.AppImage.tar.gz') || targetAssetName.endsWith('.AppImage')) {
    if (targetAssetName.includes('amd64') || targetAssetName.includes('x86_64')) {
      platforms['linux-x86_64'] = { signature, url: downloadUrl };
    } else if (targetAssetName.includes('aarch64') || targetAssetName.includes('arm64')) {
      platforms['linux-aarch64'] = { signature, url: downloadUrl };
    }
  }
}

const latestJson = {
  version,
  notes: releaseData.body || `Termi release ${tag}`,
  pub_date: new Date().toISOString(),
  platforms,
};

console.log('Constructed updater manifest:');
console.log(JSON.stringify(latestJson, null, 2));

const outputPath = path.resolve(process.cwd(), 'latest.json');
fs.writeFileSync(outputPath, JSON.stringify(latestJson, null, 2) + '\n');
console.log(`Wrote ${outputPath}`);

if (isDryRun) {
  console.log('[dry-run] Skipping upload.');
  process.exit(0);
}

// 3. Upload latest.json using gh release upload with --clobber
console.log(`Uploading latest.json to release ${tag}...`);
execSync(`gh release upload "${tag}" "${outputPath}" --clobber`, {
  stdio: 'inherit',
});
console.log('Successfully uploaded latest.json!');
