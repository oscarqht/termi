import fs from 'node:fs';
import { execSync } from 'node:child_process';

const isDryRun = process.argv.includes('--dry-run');

// 1. Check if the last commit was an automated release commit
try {
  const lastCommitMsg = execSync('git log -1 --pretty=%B', { encoding: 'utf8' });
  if (lastCommitMsg.includes('[skip ci]') || lastCommitMsg.includes('chore(release):')) {
    console.log('Automated release commit detected. Skipping version bump.');
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, 'should_release=false\n');
    }
    process.exit(0);
  }
} catch (e) {
  console.warn('Could not read git log:', e.message);
}

// 2. Determine current version from latest tag or package.json
let currentVersion = JSON.parse(fs.readFileSync('package.json', 'utf8')).version || '0.1.0';
try {
  const latestTag = execSync('git describe --tags --abbrev=0 2>/dev/null', { encoding: 'utf8' }).trim();
  const cleanTag = latestTag.replace(/^v/, '');
  if (/^\d+\.\d+\.\d+$/.test(cleanTag)) {
    currentVersion = cleanTag;
  }
} catch {
  // No git tags exist yet, fallback to package.json version
}

// 3. Bump minor version: major.(minor + 1).0
const parts = currentVersion.split('.').map(Number);
const major = isNaN(parts[0]) ? 0 : parts[0];
const minor = isNaN(parts[1]) ? 1 : parts[1];
const nextVersion = `${major}.${minor + 1}.0`;
const nextTag = `v${nextVersion}`;

console.log(`Current: ${currentVersion} -> Next: ${nextVersion} (${nextTag})`);

if (isDryRun) {
  console.log('[dry-run] Version bump verified successfully.');
  process.exit(0);
}

// 4. Update package.json & package-lock.json
execSync(`npm version ${nextVersion} --no-git-tag-version`, { stdio: 'inherit' });

// 5. Commit and tag
execSync('git config user.name "github-actions[bot]"');
execSync('git config user.email "github-actions[bot]@users.noreply.github.com"');
execSync('git add package.json package-lock.json');
execSync(`git commit -m "chore(release): ${nextTag} [skip ci]"`);
execSync(`git tag ${nextTag}`);

// 6. Push to repository
execSync('git push origin main');
execSync(`git push origin ${nextTag}`);

// 7. Write outputs to GITHUB_OUTPUT
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `tag=${nextTag}\nversion=${nextVersion}\nshould_release=true\n`);
}
