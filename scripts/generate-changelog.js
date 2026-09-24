import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const isUpdateRelease = args.includes('--update-release');

const fromIndex = args.indexOf('--from');
const explicitFrom = fromIndex !== -1 && args[fromIndex + 1] ? args[fromIndex + 1] : null;

const outIndex = args.indexOf('--out');
const explicitOut = outIndex !== -1 && args[outIndex + 1] ? args[outIndex + 1] : null;

// Filter out flag args to find target tag
const targetTagArg = args.find(
  (a, i) =>
    !a.startsWith('--') &&
    (fromIndex === -1 || i !== fromIndex + 1) &&
    (outIndex === -1 || i !== outIndex + 1)
);

export function getPreviousTag(targetTag) {
  try {
    return execSync(`git describe --tags --abbrev=0 "${targetTag}^" 2>/dev/null`, {
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

export function generateChangelog(targetTag, fromTag = null) {
  const previousTag = fromTag || getPreviousTag(targetTag);
  const range = previousTag ? `"${previousTag}".."${targetTag}"` : `"${targetTag}"`;

  let rawLog = '';
  try {
    rawLog = execSync(`git log --format="%s" ${range}`, {
      encoding: 'utf8',
    }).trim();
  } catch (e) {
    console.warn(`[changelog] Failed to run git log for range ${range}:`, e.message);
    return 'Performance improvements and bug fixes.';
  }

  if (!rawLog) {
    return 'Performance improvements and bug fixes.';
  }

  const lines = rawLog.split('\n').map((l) => l.trim()).filter(Boolean);
  const filtered = lines.filter((msg) => {
    // Filter automated release commits
    if (/chore(\(release\))?:\s*v?\d+\.\d+\.\d+/i.test(msg)) return false;
    if (msg.includes('[skip ci]')) return false;

    // Filter merge commits
    if (/^Merge (branch|pull request|remote-tracking branch)/i.test(msg)) return false;

    return true;
  });

  if (filtered.length === 0) {
    return 'Performance improvements and bug fixes.';
  }

  return filtered.map((msg) => `- ${msg}`).join('\n');
}

// Direct CLI invocation
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  let targetTag = targetTagArg;
  if (!targetTag) {
    try {
      targetTag = execSync('git describe --tags --abbrev=0 2>/dev/null', {
        encoding: 'utf8',
      }).trim();
    } catch {
      targetTag = 'HEAD';
    }
  }

  const changelog = generateChangelog(targetTag, explicitFrom);

  if (explicitOut) {
    fs.writeFileSync(explicitOut, changelog + '\n', 'utf8');
    console.log(`Changelog written to ${explicitOut}`);
  }

  if (isUpdateRelease && targetTag !== 'HEAD') {
    console.log(`Updating release notes on GitHub for ${targetTag}...`);
    const tmpFile = path.join(os.tmpdir(), `release-notes-${Date.now()}.txt`);
    try {
      fs.writeFileSync(tmpFile, changelog + '\n', 'utf8');
      execSync(`gh release edit "${targetTag}" -F "${tmpFile}"`, {
        stdio: 'inherit',
      });
      console.log(`Release notes updated successfully for ${targetTag}!`);
    } catch (e) {
      console.error(`Failed to update release notes for ${targetTag}:`, e.message);
      process.exit(1);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  } else if (!explicitOut) {
    console.log(changelog);
  }

  if (process.env.GITHUB_OUTPUT) {
    const delimiter = 'CHANGELOG_DELIMITER_' + Date.now();
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `changelog<<${delimiter}\n${changelog}\n${delimiter}\n`
    );
  }
}
