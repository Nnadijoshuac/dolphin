const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

/* ---------------------------------------------------------------------------
 * Keep the Next.js site's own dependency tree out of Metro's file watcher.
 * ---------------------------------------------------------------------------
 * The website under web/ is a separate app that happens to live inside this
 * project root, so its node_modules and .next sit under the directory Metro
 * watches. It shares nothing with the Expo bundle - the two frontends only
 * share hand-mirrored SOURCE files (AGENTS.md SS9), never modules - and nothing
 * in src/ or convex/ imports across the boundary.
 *
 * WHY THIS IS NOT COSMETIC. Metro has no Watchman on Windows and
 * NativeWatcher.isSupported() is `platform() === 'darwin'`, so it falls back to
 * FallbackWatcher, which walks the whole root and calls fs.watch on EVERY
 * directory before it resolves. Watcher.js rejects with "Failed to start watch
 * mode." after MAX_WAIT_TIME = 240000 ms, and the failure surfaces as a
 * confusing downstream crash in react-native-css-interop
 * ("Cannot read properties of undefined (reading 'getSha1')").
 *
 * Measured on this machine with metro's own FallbackWatcher, not estimated:
 *
 *     no ignore                          104,109 ms
 *     web/{node_modules,.next} pruned     54,792 ms
 *
 * web/node_modules alone is 11,766 of the ~27,600 directories under this root.
 * 104s is under the limit on an idle machine but not by much, which is why the
 * failure is intermittent - it tips over whenever something else is hitting the
 * disk (a concurrent `next build`, an antivirus sweep).
 *
 * WHY THE PATTERN LOOKS LIKE THAT. `[\\/]` matches either separator because
 * this regex is tested against paths in two different shapes: the directory
 * prune in FallbackWatcher goes through posixPathMatchesPattern, which
 * normalizes to forward slashes on Windows, while metro-file-map tests raw
 * absolute paths. The trailing `([\\/]|$)` is required so the pruned directory
 * itself matches, not only files beneath it.
 *
 * THE REAL FIX IS WATCHMAN. Installing it makes Metro pick WatchmanWatcher and
 * removes the crawl entirely. This keeps the tree small enough not to need it.
 *
 * Appended to the default blockList rather than replacing it - getIgnorePattern
 * in metro/src/node-haste/DependencyGraph/createFileMap.js accepts an array and
 * combines the entries.
 */
const WEB_BUILD_ARTIFACTS = /[\\/]web[\\/](node_modules|\.next)([\\/]|$)/;

const defaultBlockList = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(defaultBlockList)
    ? defaultBlockList
    : defaultBlockList
      ? [defaultBlockList]
      : []),
  WEB_BUILD_ARTIFACTS,
];

module.exports = withNativeWind(config, {
  input: "./global.css",
});
